import type {EvidenceSource,EvidenceDecision} from '../evidence/types';
import type {EvidenceEnvelope,CanonicalCrypto} from '../application/ports';
export const COLLECTION_OBSERVATION_DECODER:'synthetic-collection-observation-v1';
export const MAX_COLLECTION_OBSERVATION_BYTES:16384;
export interface CollectionObservationEvent {readonly inventoryId:string;readonly assetId:string;readonly kind:'reveal'|'transfer';readonly observedMs:number;readonly from:string|null;readonly to:string|null}
export function inspectCollectionObservation(source:EvidenceSource,payload:unknown,envelope:EvidenceEnvelope):CollectionObservationEvent;
export function verifyCollectionObservationEvidence(input:{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;bytes:Uint8Array},crypto:CanonicalCrypto):Promise<Readonly<{event:CollectionObservationEvent;source:EvidenceSource;envelope:EvidenceEnvelope;receiptDigest:string;byteDigest:string;sourceConfigDigest:string;streamKey:string}>>;
