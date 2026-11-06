import type {ArtifactIdentity,CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {RecoveryV2Codec,RecoveryV2Pointer,RecoveryV2Index,RecoveryV2Branch,RecoveryV2Leaf} from './v2-codec.mjs';
export interface RecoveryV2TraversalCursor {kind:RecoveryV2Index['kind'];pointer:RecoveryV2Pointer;emitted:number;stack:Array<{identity:ArtifactIdentity;position:number;level:number|null;summary:RecoveryV2Branch|null}>}
export type RecoveryV2TraversalResult={kind:'done';cursor:RecoveryV2TraversalCursor}|{kind:'pending';reason:string}|({cursor:RecoveryV2TraversalCursor;metadata:{identity:ArtifactIdentity;bytes:Uint8Array}}&({kind:'progress'}|{kind:'entry';key:string;value:RecoveryV2Leaf['value']}));
export function createRecoveryV2IndexReader(ports:{artifacts:Pick<ArtifactStore,'getVerified'>;crypto:CanonicalCrypto;v2Codec:RecoveryV2Codec}):Readonly<{step(input:{kind:RecoveryV2Index['kind'];pointer:RecoveryV2Pointer;cursor?:RecoveryV2TraversalCursor|null}):Promise<RecoveryV2TraversalResult>}>;
