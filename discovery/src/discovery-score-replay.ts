import {AnyScoreRecordSchema,type AnyScoreRecord} from "./discovery-score-models";
import {replayAnyDiscoveryScore as replayV1V2} from "./discovery-score-v2";
import {freezeDiscoveryScoreV3} from "./discovery-score-v3";
import {freezeDiscoveryScoreV4} from "./discovery-score-v4";
import {DiscoveryScoreError} from "./discovery-score";
import {hashJson} from "./solana";
export async function replayAnyDiscoveryScore(raw:AnyScoreRecord){const r=AnyScoreRecordSchema.parse(raw);if(r.version!=="discovery-scorecard-v3"&&r.version!=="discovery-scorecard-v4")return replayV1V2(r);const regenerated=r.version==="discovery-scorecard-v4"?await freezeDiscoveryScoreV4(r.inputs):await freezeDiscoveryScoreV3(r.inputs);if(await hashJson(regenerated)!==await hashJson(r))throw new DiscoveryScoreError("discovery_score_replay_mismatch");return {status:"verified" as const,provider_requests:0 as const};}
