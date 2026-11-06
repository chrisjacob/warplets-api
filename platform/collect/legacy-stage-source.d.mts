import type {ArtifactIdentity,CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {CollectionListSeal} from './source-intake.mjs';
import type {LegacyStageAuditResult} from './legacy-stage-audit.mjs';
import type {RecoveryDigest} from '../recovery/v2-node-digest.mjs';
export interface LegacyStageSourcePin {readonly inventoryId:string;readonly sourceRevision:string;readonly generation:string;readonly watermark:number}
export interface LegacyStageSourceInput {readonly rootId:string;readonly stageIndex:number;readonly original:ArtifactIdentity|null;readonly source:LegacyStageSourcePin}
export interface LegacyStageSourceMetrics {readonly sql:number;readonly batches:number;readonly maxBatchBytes:number;readonly readBytes:number;readonly artifactReads:number;readonly artifactBytes:number;readonly walletChunks:number;readonly wallets:number;readonly maxChunkTransportBytes:number;readonly workingBytes:number;readonly phasePeaks:Readonly<Record<'root'|'artifact'|'lists'|'wallets'|'audit'|'final',number>>}
export type LegacyStageSourceResult=Readonly<{kind:'held';reason:string;metrics:LegacyStageSourceMetrics}>|Readonly<{kind:'verified';rootId:string;stageIndex:number;sourcePin:LegacyStageSourcePin;originalIdentity:ArtifactIdentity;stageAudit:Extract<LegacyStageAuditResult,{kind:'verified'}>;sourceDigest:string;provenance:'retained-private-preimage-and-committed-original-index';originalActorVerified:false;originalRetentionTimeVerified:false;sourceRelation:false;freeCutAuthority:false;economics:false;adoption:false;executable:false;metrics:LegacyStageSourceMetrics}>;
export interface LegacyStageSourceStatement {readonly sql:string;readonly values:readonly (string|number|null)[]}
/** The SQL predicates verify retained receipts. Callers independently fence the
 * source generation/header/watermark and current schema before using the rows. */
export function legacySealedListSql(ids:readonly string[]):LegacyStageSourceStatement;
export function legacyIndexedPagesSql(ids:readonly string[]):LegacyStageSourceStatement;
export function verifyLegacySealedLists(rows:readonly Record<string,unknown>[],ids:readonly string[],crypto:CanonicalCrypto):Promise<Readonly<{seals:readonly CollectionListSeal[];recordBytes:number;transportBytes:number}>>;
/** One exact named page only; does not prove absent membership or full closure. */
export function verifyLegacyIndexedPage(row:Record<string,unknown>,expected:Readonly<{id:string;index:number;count:number;ordinal:number}>,crypto:CanonicalCrypto):Promise<readonly string[]>;
/** Read-only bridge; caller must separately bind durable source relation and
 * original artifact selection. No catalog, actor, timing or adoption authority. */
export function createLegacyStageSource(ports:{driver:{batch(statements:readonly LegacyStageSourceStatement[]):Promise<{rows:Record<string,unknown>[];changes:number}[]>};crypto:CanonicalCrypto;createDigest():RecoveryDigest;artifacts:Pick<ArtifactStore,'getVerified'>}):Readonly<{read(input:LegacyStageSourceInput):Promise<LegacyStageSourceResult>}>;
