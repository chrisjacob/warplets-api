import type {EvidenceSource,EvidenceDecision} from '../evidence/types';
import type {EvidenceEnvelope,CanonicalCrypto} from '../application/ports';
import type {PinnedBeaconProof} from '../beacon/portable.mjs';
export const COLLECTION_PROGRESSION_DECODER:'synthetic-collection-progression-v1';
export const MAX_COLLECTION_PROGRESSION_BYTES:16384;
export interface CollectionProgressionEvent{readonly inventoryId:string;readonly operationId:string;readonly kind:'upgrade'|'visual';readonly commitment:string;readonly provenance:'manual-fixture'|'configured-offline-beacon';readonly atMs:number;readonly proof:PinnedBeaconProof|Readonly<{proofId:string;ticket:number|null;traits:Readonly<{model:string;backdrop:string;symbol:string}>|null}>}
export function inspectCollectionProgression(source:EvidenceSource,payload:unknown,envelope:EvidenceEnvelope):CollectionProgressionEvent;
export function verifyCollectionProgressionEvidence(input:{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;bytes:Uint8Array},crypto:CanonicalCrypto):Promise<Readonly<{event:CollectionProgressionEvent;source:EvidenceSource;envelope:EvidenceEnvelope;receiptDigest:string;byteDigest:string;sourceConfigDigest:string;streamKey:string}>>;
