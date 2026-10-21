import {AnyScoreRecordSchema,type AnyScoreRecord} from "./discovery-score-models";
import {replayAnyDiscoveryScore as replayV1V2} from "./discovery-score-v2";
import {freezeDiscoveryScoreV3} from "./discovery-score-v3";
import {DiscoveryScoreError} from "./discovery-score";
import {hashJson} from "./solana";
export async function replayAnyDiscoveryScore(raw:AnyScoreRecord){const r=AnyScoreRecordSchema.parse(raw);if(r.version!=="discovery-scorecard-v3")return replayV1V2(r);if(await hashJson(await freezeDiscoveryScoreV3(r.inputs))!==await hashJson(r))throw new DiscoveryScoreError("discovery_score_replay_mismatch");return {status:"verified" as const,provider_requests:0 as const};}
