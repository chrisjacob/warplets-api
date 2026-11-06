import type {CanonicalCrypto,EvidenceEnvelope} from '../application/ports';
import type {EvidenceSource,EvidenceDecision} from '../evidence/types';
export const RECORDED_PACKET_DECODER:'synthetic-transaction-packet-v1';
export const RECORDED_PACKET_MAX_BYTES:32768;
export type RecordedUnsignedPacket=Readonly<{version:1;network:'solana-local';attemptId:string;planHash:string;genesisHash:string;messageBase64:string;messageHash:string;lifetime:Readonly<{kind:'recent-blockhash';blockhash:string;lastValidBlockHeight:number;contextSlot:number;observedAt:number}>;lookupTables:readonly unknown[]}>;
export type RecordedSimulation=Readonly<{genesisHash:string;ok:true;messageHash:string;blockhash:string;height:number;contextSlot:number;observedAt:number;lookupTables:readonly unknown[];feeUnits:string;outputUnits:string;ref:string}>;
export type RecordedPacketEvent=Readonly<{eventId:string;intentId:string;owner:string;planHash:string;packet:RecordedUnsignedPacket;simulation:RecordedSimulation;observedMs:number}>;
export function inspectRecordedTransactionPacket(source:EvidenceSource,payload:unknown,envelope:EvidenceEnvelope):RecordedPacketEvent;
export function verifyRecordedTransactionPacket(value:{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;bytes:Uint8Array},crypto:CanonicalCrypto):Promise<Readonly<{source:EvidenceSource;envelope:EvidenceEnvelope;decision:EvidenceDecision;receiptDigest:string;event:RecordedPacketEvent;byteDigest:string;sourceConfigDigest:string;streamKey:string}>>;
