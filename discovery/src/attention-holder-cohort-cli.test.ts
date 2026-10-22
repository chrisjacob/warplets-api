import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { exportAttentionHolderCohort } from "../../scripts/discovery-attention-holder-cohort";
import { collectAttention } from "./attention-queue";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { key } from "./wallet-fixtures.test-helper";
const root = fileURLToPath(new URL("../../", import.meta.url)), temporary: string[] = [], at = "2026-10-20T12:00:00.000Z";
afterEach(() => { const parent = realpathSync(path.join(root, ".tmp")); for (const dir of temporary.splice(0)) { const resolved = realpathSync(dir); if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith("attention-cohort-test-") || lstatSync(dir).isSymbolicLink()) throw Error("Unsafe test cleanup"); rmSync(resolved, { recursive: true }); } });
const run = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", path.join(root, "scripts/discovery-attention-holder-cohort.ts"), ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
async function source(broken = false) {
  const directory = mkdtempSync(path.join(root, ".tmp/attention-cohort-test-")); temporary.push(directory); const file = path.join(directory, "source.sqlite"), sqlite = new DatabaseSync(file);
  try {
    for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
    const body = { code: 0, data: [{ chain: "sol", interval: "24h", tokens: Array.from({ length: 13 }, (_, i) => ({ address: key(i + 1), symbol: "SYNTHETIC", is_wash_trading: i === 1 })) }] };
    await collectAttention({ db: sqliteD1(sqlite), apiKey: "synthetic-only", permissionReference: GMGN_USE_AUTHORITY, marketDailyLimit: 600 }, { source: "gmgn", reason: "Synthetic cohort source" }, async () => Response.json(body), () => new Date(at));
    if (broken) sqlite.exec("DROP TABLE tenx_candidates");
  } finally { sqlite.close(); }
  return { directory, file, output: path.join(directory, "export") };
}
it("exports a fixed private plan and replays pinned readiness with no source changes or overwrite", async () => {
  expect(typeof exportAttentionHolderCohort).toBe("function"); const { file, output } = await source(), before = readFileSync(file);
  const result = JSON.parse(run("export", file, at, output)); expect(result).toMatchObject({ selected: 3, returned: 13, recorded_quality_matches: 0, rpc_dispatch_allowed: false, provider_requests: 0, database_writes: 0 });
  expect(JSON.parse(run("verify", output, result.plan_sha256, result.assessment_sha256))).toEqual({ replay: "exact", members: 3, rpc_dispatch_allowed: false, scoring_effect: "none" });
  expect(readFileSync(file)).toEqual(before); const plan = readFileSync(path.join(output, "plan.json"));
  expect(() => run("export", file, at, output)).toThrow(); expect(readFileSync(path.join(output, "plan.json"))).toEqual(plan);
  const assessment = path.join(output, "assessment.json"), raw = JSON.parse(readFileSync(assessment, "utf8")); raw.report.members[0].dispatch_admitted = true; writeFileSync(assessment, JSON.stringify(raw));
  expect(() => run("verify", output, result.plan_sha256, result.assessment_sha256)).toThrow();
  const newPin = createHash("sha256").update(readFileSync(assessment)).digest("hex"); expect(() => run("verify", output, result.plan_sha256, newPin)).toThrow();
}, 30000);
it("retains the original plan after readiness fails and never reuses that output for another attempt", async () => {
  const { file, output } = await source(true), before = readFileSync(file);
  expect(() => run("export", file, at, output)).toThrow(); expect(existsSync(path.join(output, "plan.json"))).toBe(true); expect(existsSync(path.join(output, "assessment.json"))).toBe(false);
  const original = readFileSync(path.join(output, "plan.json")); expect(() => run("export", file, at, output)).toThrow(); expect(readFileSync(path.join(output, "plan.json"))).toEqual(original); expect(readFileSync(file)).toEqual(before);
}, 30000);
