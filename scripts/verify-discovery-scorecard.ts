import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
import {ScoreRecordSchema} from "../discovery/src/discovery-score-model";
import {replayDiscoveryScore} from "../discovery/src/discovery-score";
const path=process.argv[2];assert.ok(path,"Provide the path to an exported scorecard JSON file");assert.ok(statSync(path).size<=2_000_000,"Scorecard file exceeds the verification bound");
const record=ScoreRecordSchema.parse(JSON.parse(readFileSync(path,"utf8"))),replay=await replayDiscoveryScore(record);
console.log(JSON.stringify({replay:replay.status,version:record.inputs.policy.version,address:record.inputs.candidate.address,as_of:record.result.as_of,score:record.result.value,evidence_coverage:record.result.evidence_coverage,ceiling:record.result.ceiling,record_hash:record.record_hash,source_requests:0},null,2));
