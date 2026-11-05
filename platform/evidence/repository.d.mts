import type {EvidenceRepository,EvidenceCommand,EvidencePorts,AtomicDriver} from './types';
export const REGISTER_SOURCE:'evidence.register-source.v1',RECORD_RECEIPT:'evidence.record-receipt.v1';
export function evidenceCommandBytes(command:EvidenceCommand):Uint8Array;
export function createEvidenceRepository(driver:AtomicDriver,ports:EvidencePorts):EvidenceRepository;
