import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
import {ScoreResearchDetailSchema} from "../discovery/src/score-research-model";
import {replayScoreCohort,replayScoreOutcome} from "../discovery/src/score-research-analysis";
const path=process.argv[2];assert.ok(path,"Provide a saved score-research detail JSON file");assert.ok(statSync(path).size<=2_500_000,"Research artifact exceeds verification bound");
const detail=ScoreResearchDetailSchema.parse(JSON.parse(readFileSync(path,"utf8"))),cohort=await replayScoreCohort(detail.cohort);
if(detail.outcome)await replayScoreOutcome(detail.outcome,cohort.summary);
console.log(JSON.stringify({replay:"verified",address:cohort.summary.address,captured_at:cohort.summary.captured_at,score:cohort.summary.score.value,evidence_coverage:cohort.summary.score.evidence_coverage,cohort_hash:cohort.summary.cohort_hash,outcome:detail.outcome?.result.status??"pending",provider_requests:0},null,2));
