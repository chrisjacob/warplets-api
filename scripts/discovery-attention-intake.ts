import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { Address } from "../discovery/src/model";
import { readVerifiedAttentionHolderCohort } from "./discovery-attention-holder-cohort";

const endpoint = "http://127.0.0.1:8794/api/10x/admin/mint-reviews";
const Reply = z.object({ address: Address, state: z.enum(["queued", "scanning", "admitted", "unsupported_quote", "not_found", "expired"]),
  duplicate: z.boolean(), provider_requests: z.literal(0), evidence_gates_changed: z.literal(false) }).strict();
function retain(file: string, value: unknown) {
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
async function boundedReply(response: Response) {
  if (!response.body) throw Error("intake_reply_missing");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 4096) throw Error("intake_reply_bytes"); chunks.push(part.value);
    }
    return Reply.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally { await reader.cancel(); reader.releaseLock(); }
}
// Queue submission only. The existing authenticated local Worker owns admission,
// pacing, shared quotas and proof verification; this command never calls an RPC.
export async function submitAttentionIntake(directory: string, planPin: string, assessmentPin: string,
  token: string, transport: typeof fetch = fetch, clock: () => Date = () => new Date()) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("intake_local_credentials_required");
  const saved = await readVerifiedAttentionHolderCohort(directory, planPin, assessmentPin);
  const fresh = () => { const age = clock().getTime() - Date.parse(saved.cohort.plan.cutoff_at);
    if (!Number.isFinite(age) || age < 0 || age > 7_200_000) throw Error("intake_plan_stale"); };
  fresh();
  // Fixed location belongs to the original pinned cohort. A partial/unknown
  // attempt cannot be reopened. Global mint identity deduplication also remains.
  const journal = path.join(saved.directory, "intake-v1"); mkdirSync(journal, { mode: 0o700 });
  const members = saved.cohort.plan.selected_addresses;
  retain(path.join(journal, "plan.json"), { version: "attention-mint-intake-v1", plan_sha256: planPin, assessment_sha256: assessmentPin,
    plan_hash: saved.cohort.plan.plan_hash, submitted_at: clock().toISOString(), members, endpoint,
    admission: "existing_bounded_mint_review", provider_requests: 0, scoring_effect: "none", evidence_gates_changed: false });
  const results = members.map(address => ({ address, submission: "not_attempted" as "not_attempted" | "uncertain_or_rejected" | "acknowledged",
    state: null as z.infer<typeof Reply>["state"] | null, duplicate: null as boolean | null }));
  for (let i = 0; i < members.length; i++) {
    const address = members[i]!;
    try {
      fresh();
      retain(path.join(journal, `${i + 1}-attempt.json`), { address, at: clock().toISOString(), plan_hash: saved.cohort.plan.plan_hash });
      results[i]!.submission = "uncertain_or_rejected";
      const response = await transport(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ address, reason: `Frozen attention cohort ${saved.cohort.plan.plan_hash}` }) });
      if (!response.ok) { await response.body?.cancel(); throw Error("intake_not_acknowledged"); }
      const reply = await boundedReply(response);
      if (reply.address !== address) throw Error("intake_reply_identity");
      retain(path.join(journal, `${i + 1}-ack.json`), reply);
      results[i] = { address, submission: "acknowledged", state: reply.state, duplicate: reply.duplicate };
    } catch { break; } // No retries, substitution or unbounded error/response logging.
  }
  const report = { version: "attention-mint-intake-result-v1", plan_hash: saved.cohort.plan.plan_hash, members: results,
    acknowledged: results.filter(r => r.submission === "acknowledged").length, selected: members.length,
    provider_requests: 0, queue_writes: "owned_by_existing_local_worker", rpc_dispatch_allowed: false,
    qualification_admitted: false, scoring_effect: "none", evidence_gates_changed: false } as const;
  retain(path.join(journal, "result.json"), report); return report;
}
async function main(args: string[]) {
  if (args.length !== 3) throw Error("intake_arguments_invalid");
  const token = readFileSync(new URL("../discovery/.dev.vars", import.meta.url), "utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1] ?? "";
  const report = await submitAttentionIntake(args[0]!, args[1]!, args[2]!, token);
  console.log(JSON.stringify({ selected: report.selected, acknowledged: report.acknowledged, provider_requests: 0, qualification_admitted: false }));
  if (report.acknowledged !== report.selected) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) void main(process.argv.slice(2)).catch(() => {
  console.error("Attention intake held. Preserve the original plan and any journal; do not retry an uncertain submission. Check existing mint-review status."); process.exitCode = 1;
});
