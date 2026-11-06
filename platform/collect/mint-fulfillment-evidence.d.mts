import type {EvidenceSource,EvidenceDecision} from '../evidence/types';
import type {EvidenceEnvelope,CanonicalCrypto} from '../application/ports';
import type {NormalizedMintEvent} from './mint-plan.mjs';
export const COLLECTION_MINT_DECODER:'synthetic-collection-mint-v1';
export const MAX_COLLECTION_MINT_BYTES:16384;
export type CollectionMintFulfillmentEvent=NormalizedMintEvent&{readonly kind:'mint'};
export function inspectCollectionMintFulfillment(source:EvidenceSource,payload:unknown,envelope:EvidenceEnvelope):CollectionMintFulfillmentEvent;
export function verifyCollectionMintFulfillmentEvidence(input:{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;bytes:Uint8Array},crypto:CanonicalCrypto):Promise<Readonly<{event:CollectionMintFulfillmentEvent;source:EvidenceSource;envelope:EvidenceEnvelope;receiptDigest:string;byteDigest:string;sourceConfigDigest:string;streamKey:string}>>;
