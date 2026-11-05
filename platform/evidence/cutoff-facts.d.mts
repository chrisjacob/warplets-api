import type {EvidenceEnvelope} from '../application/ports';
import type {EvidenceSource,EvidenceDecision} from './types';
export const CUTOFF_FACT_KINDS:readonly ['campaign-registry','ownership','position-inventory','action-completions'];
export function decodeCutoffFacts(source:EvidenceSource,payload:unknown,envelope:EvidenceEnvelope):EvidenceDecision;
