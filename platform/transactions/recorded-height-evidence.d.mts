import type {CanonicalCrypto,EvidenceEnvelope} from '../application/ports';
import type {EvidenceSource,EvidenceDecision} from '../evidence/types';
export const RECORDED_HEIGHT_DECODER:'synthetic-transaction-height-v1';
export const RECORDED_HEIGHT_MAX_BYTES:4096;
export type RecordedHeightEvent=Readonly<{eventId:string;intentId:string;attemptId:string;owner:string;planHash:string;messageHash:string;genesisHash:string;blockHeight:number;observedMs:number}>;
export function inspectRecordedTransactionHeight(source:EvidenceSource,payload:unknown,envelope:EvidenceEnvelope):RecordedHeightEvent;
export function verifyRecordedTransactionHeight(value:{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;bytes:Uint8Array},crypto:CanonicalCrypto):Promise<Readonly<{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;event:RecordedHeightEvent;byteDigest:string;sourceConfigDigest:string;streamKey:string}>>;
