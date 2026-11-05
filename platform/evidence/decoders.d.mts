import type {EvidenceEnvelope} from '../application/ports';
import type {EvidenceSource,RecordedResult,EvidenceDecision} from './types';
export function decodeRecorded(source:EvidenceSource,record:RecordedResult,envelope:EvidenceEnvelope):EvidenceDecision;
