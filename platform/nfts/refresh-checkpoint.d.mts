import type {CanonicalCrypto,ArtifactIdentity} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {RefreshWorkflowState} from './refresh-workflow.mjs';
export const REFRESH_CHECKPOINT_LIMIT:32768;
export interface RefreshCheckpointPin {readonly identity:ArtifactIdentity;readonly requestDigest:string;readonly stateDigest:string}
export type RefreshCheckpointResult=Readonly<{kind:'saved'|'restored';pin:RefreshCheckpointPin;state:RefreshWorkflowState;authority:'unverified-rehearsal';isAuthorization:false}>|Readonly<{kind:'pending';reason:string;pin?:RefreshCheckpointPin}>;
export function createRefreshCheckpoints(ports:{crypto:CanonicalCrypto;store:ArtifactStore}):Readonly<{save(state:RefreshWorkflowState):Promise<RefreshCheckpointResult>;restore(pin:RefreshCheckpointPin):Promise<RefreshCheckpointResult>}>;
