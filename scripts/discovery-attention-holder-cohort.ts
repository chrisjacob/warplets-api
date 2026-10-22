import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sqliteD1 } from "../app/functions/_lib/sqliteTestDb";
import { readAttentionQueue } from "../discovery/src/attention-queue";
import { ATTENTION_HOLDER_COHORT_POLICY, planAttentionHolderCohort, readAttentionHolderReadiness, assessAttentionHolderCohort } from "../discovery/src/attention-holder-cohort";
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function privateDirectory(value: string, create: boolean) {
  const target = path.resolve(value), root = realpathSync(".tmp"), parent = realpathSync(path.dirname(target)), relative = path.relative(root, parent);
  if (lstatSync(".tmp").isSymbolicLink() || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || create && existsSync(target)) throw Error("cohort_private_directory_required");
  if (create) mkdirSync(target, { mode: 0o700 });
  if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory() || realpathSync(target) !== path.join(parent, path.basename(target))) throw Error("cohort_private_directory_required");
  return target;
}
function write(file: string, value: unknown) {
  const data = Buffer.from(JSON.stringify(value) + "\n");
  writeFileSync(file, data, { flag: "wx", mode: 0o600 }); return sha(data);
}
export async function exportAttentionHolderCohort(database: string, cutoff: string, output: string) {
  const at = new Date(cutoff);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== cutoff || at.getTime() > Date.now()) throw Error("cohort_cutoff_invalid");
  if (!lstatSync(database).isFile() || lstatSync(database).isSymbolicLink()) throw Error("cohort_regular_database_required");
  const directory = privateDirectory(output, true), sqlite = new DatabaseSync(database, { readOnly: true });
  try {
    sqlite.exec("PRAGMA query_only=ON;PRAGMA busy_timeout=10000;BEGIN"); const db = sqliteD1(sqlite);
    const cohort = await planAttentionHolderCohort(await readAttentionQueue(db, at));
    // Retain the exact selection before observing candidate readiness. A later
    // failure leaves this original plan intact; never replace held members.
    const plan_sha256 = write(path.join(directory, "plan.json"), { policy: ATTENTION_HOLDER_COHORT_POLICY, ...cohort });
    const rows = await readAttentionHolderReadiness(db, cohort), report = await assessAttentionHolderCohort(cohort, rows);
    if (sqlite.prepare("SELECT total_changes() n").get()!.n !== 0) throw Error("cohort_source_changed");
    const assessment_sha256 = write(path.join(directory, "assessment.json"), { plan_hash: cohort.plan.plan_hash, rows, report });
    return { directory, plan_sha256, assessment_sha256, selected: cohort.plan.population.selected,
      returned: cohort.plan.population.returned, recorded_quality_matches: report.members.filter(m => m.recorded_quality_fields_match).length,
      rpc_dispatch_allowed: false, provider_requests: 0, database_writes: 0, scoring_effect: "none" };
  } finally { if (sqlite.isTransaction) sqlite.exec("ROLLBACK"); sqlite.close(); }
}
export async function verifyAttentionHolderCohort(output: string, planPin: string, assessmentPin: string) {
  const directory = privateDirectory(output, false);
  const read = (name: string, pin: string, limit: number) => {
    const file = path.join(directory, name), stat = lstatSync(file);
    if (!/^[a-f0-9]{64}$/.test(pin) || !stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw Error("cohort_pinned_artifact_required");
    const data = readFileSync(file); if (sha(data) !== pin) throw Error("cohort_artifact_pin_mismatch"); return JSON.parse(data.toString("utf8"));
  };
  const saved = read("plan.json", planPin, 9_000_000), assessment = read("assessment.json", assessmentPin, 5_500_000);
  if (Object.keys(saved).sort().join(",") !== "plan,policy,queue" || Object.keys(assessment).sort().join(",") !== "plan_hash,report,rows") throw Error("cohort_artifact_envelope");
  if (JSON.stringify(saved.policy) !== JSON.stringify(ATTENTION_HOLDER_COHORT_POLICY)) throw Error("cohort_policy_mismatch");
  const cohort = await planAttentionHolderCohort(saved.queue);
  if (JSON.stringify(saved.queue) !== JSON.stringify(cohort.queue) || JSON.stringify(saved.plan) !== JSON.stringify(cohort.plan) || assessment.plan_hash !== cohort.plan.plan_hash) throw Error("cohort_plan_mismatch");
  const report = await assessAttentionHolderCohort(cohort, assessment.rows);
  if (JSON.stringify(report) !== JSON.stringify(assessment.report)) throw Error("cohort_assessment_replay_mismatch");
  return report;
}
async function main(args: string[]) {
  if (args.length === 4 && args[0] === "export") console.log(JSON.stringify(await exportAttentionHolderCohort(args[1]!, args[2]!, args[3]!)));
  else if (args.length === 4 && args[0] === "verify") { const report = await verifyAttentionHolderCohort(args[1]!, args[2]!, args[3]!); console.log(JSON.stringify({ replay: "exact", members: report.members.length, rpc_dispatch_allowed: false, scoring_effect: "none" })); }
  else throw Error("cohort_arguments_invalid");
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) void main(process.argv.slice(2)).catch(() => { console.error("Holder cohort held. Check source, private output and artifact pins. Any retained plan remains intact; no provider request or dispatch was authorized."); process.exitCode = 1; });
