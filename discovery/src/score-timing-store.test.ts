import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fixtureCandidates } from "./fixtures";
import { defaultScoreInput, freezeDiscoveryScore } from "./discovery-score";
import { defaultScoreInputV2, freezeDiscoveryScoreV2 } from "./discovery-score-v2";
import { defaultScoreInputV3, freezeDiscoveryScoreV3 } from "./discovery-score-v3";
import { defaultScoreInputV4, freezeDiscoveryScoreV4 } from "./discovery-score-v4";
import { freezeScoreCohort, freezeScoreOutcome, replayScoreCohort, replayScoreOutcome, SCORE_OUTCOME_DELAY } from "./score-research-analysis";

const opened: DatabaseSync[] = [];
afterEach(() => opened.splice(0).forEach(db => db.close()));
it("widens only model admission, preserves nonempty v1/v2/v3 outcomes and rolls back an interrupted migration", async () => {
  const db = new DatabaseSync(":memory:"); opened.push(db); db.exec("PRAGMA foreign_keys=on");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter(file => file.endsWith(".sql") && file < "0040").sort())
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  const at = new Date("2026-10-21T01:00:00Z"), date = at.toISOString();
  const candidate = { ...(await fixtureCandidates(at))[0]!, mode: "live" as const };
  const originals = [await freezeDiscoveryScore(defaultScoreInput(candidate, at)), await freezeDiscoveryScoreV2(defaultScoreInputV2(candidate, at)), await freezeDiscoveryScoreV3(defaultScoreInputV3(candidate, at))];
  const cohorts = [], outcomes = [];
  for (const record of originals) {
    const cohort = await freezeScoreCohort(record), model = cohort.summary.score.version;
    const outcome = await freezeScoreOutcome({ version: "score-outcome-input-v1", cohort: cohort.summary, finalized_at: new Date(at.getTime() + SCORE_OUTCOME_DELAY).toISOString(), points: [], history_limited: false });
    cohorts.push(cohort); outcomes.push(outcome);
    db.prepare("INSERT INTO tenx_score_cohorts VALUES(?,?,?,?,?,?,?)").run(candidate.address, model, date, date.slice(0, 10), cohort.summary.cohort_hash, JSON.stringify(cohort).length, JSON.stringify(cohort));
    db.prepare("INSERT INTO tenx_score_outcomes VALUES(?,?,?,?,?)").run(candidate.address, model, cohort.summary.cohort_hash, outcome.result.finalized_at, JSON.stringify(outcome));
    db.prepare("INSERT INTO tenx_score_attempts VALUES(?,?,?,?)").run(candidate.address, model, date, "original_gap");
  }
  const snapshot = () => ["tenx_score_cohorts", "tenx_score_outcomes", "tenx_score_attempts"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY address,model`).all());
  const before = snapshot(), migration = readFileSync(new URL("../migrations/0040_score_launch_timing.sql", import.meta.url), "utf8");
  db.exec("BEGIN"); expect(() => db.exec(migration + "\nSELECT * FROM intentionally_missing;")).toThrow(); db.exec("ROLLBACK"); expect(snapshot()).toEqual(before);
  db.exec("BEGIN"); db.exec(migration); db.exec("COMMIT");
  expect(snapshot()).toEqual(before); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  for (let i = 0; i < cohorts.length; i++) {
    expect(await replayScoreCohort(cohorts[i]!)).toEqual(cohorts[i]);
    expect(await replayScoreOutcome(outcomes[i]!, cohorts[i]!.summary)).toEqual(outcomes[i]);
  }
  const current = await freezeScoreCohort(await freezeDiscoveryScoreV4(defaultScoreInputV4(candidate, at)));
  db.prepare("INSERT INTO tenx_score_cohorts VALUES(?,?,?,?,?,?,?)").run(candidate.address, current.summary.score.version, date, date.slice(0, 10), current.summary.cohort_hash, JSON.stringify(current).length, JSON.stringify(current));
  expect(db.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({ n: 4 });
});
