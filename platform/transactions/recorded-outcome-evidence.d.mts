import type {CanonicalCrypto,EvidenceEnvelope} from '../application/ports';
import type {EvidenceSource,EvidenceDecision} from '../evidence/types';
import type {RecordedOutcomeState} from '../application/recorded-outcomes';
export const RECORDED_OUTCOME_DECODER:'synthetic-transaction-outcome-v1';
export const RECORDED_OUTCOME_MAX_BYTES:4096;
export const LOCAL_REHEARSAL_GENESIS:'8CBzMMmYAECcNqRdJvjM3N43pPYT1ez9yVdxdbDjwzv8';
export type RecordedTransactionEvent=Readonly<{eventId:string;intentId:string;attemptId:string;owner:string;planHash:string;signature:string;state:RecordedOutcomeState;genesisHash:string;messageHash:string;observedMs:number}>;
export function inspectRecordedTransactionOutcome(source:EvidenceSource,payload:unknown,envelope:EvidenceEnvelope):RecordedTransactionEvent;
export function verifyRecordedTransactionOutcome(value:{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;bytes:Uint8Array},crypto:CanonicalCrypto):Promise<Readonly<{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;event:RecordedTransactionEvent;byteDigest:string;sourceConfigDigest:string;streamKey:string;observationJson:string;observationDigest:string}>>;
