import type {CanonicalCrypto} from '../application/ports';
import type {EvidenceResult} from './types';
export type RequirementKind='campaign-registry'|'epoch-admissions'|'final-review'|'entry-stake'|'closing-stake'|'ownership'|'position-inventory'|
 'position-history'|'action-policy'|'action-completions'|'issuer-policy'|'previous-board'|'late-approvals'|'collection-policy'|'price-policy'|
 'position-checkpoints'|'application-history';
type Base={kind:RequirementKind;subject:{kind:string;id:string};cutoffMs:number;value:unknown;available?:boolean;pendingReason?:string;
 coverage:{fromMs:number;toMs:number;required:'point'|'interval'}};
export type RequirementInput=Base&({authority:'application';sourceId?:never;sourceRevision?:never;decoderVersion?:never}|
 {authority:'evidence';sourceId:string;sourceRevision:string;decoderVersion:string});
export type RequirementSpec=Omit<RequirementInput,'value'|'available'|'pendingReason'>&{id:string;expectedValueDigest:string;available:boolean;pendingReason:string};
export type Selection={kind:'ready'|'pending';requirements:(RequirementSpec&{receiptDigest:string|null;gaps:string[]})[];
 evidence:{requirementId:string;authority:'application'|'evidence';valueDigest:string|null;receiptDigest:string|null}[];
 dependencies:{id:string;reasons:string[]}[];requirementsDigest:string;evidenceDigest:string};
export const REQUIREMENT_KINDS:readonly RequirementKind[];
export function buildRequirementSpecs(inputs:readonly RequirementInput[],crypto:CanonicalCrypto):Promise<RequirementSpec[]>;
export function normalizeRequirementValue(kind:RequirementKind,decoderVersion:string,decoded:unknown):unknown;
/** Heads must come from the current pointer, never an arbitrary older receipt. */
export function selectRequirementReceipts(specs:readonly RequirementSpec[],heads:ReadonlyMap<string,EvidenceResult|null>,crypto:CanonicalCrypto):Promise<Selection>;
