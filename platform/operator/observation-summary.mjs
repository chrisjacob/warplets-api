/** An observation summary contains no retained asset state or owner projection. */
export function projectObservationResult(value){const keys=['sourceId','assetId','kind','observedMs','revealMs','assetVersion','resultKind','conflictId','operationId','evidenceReceiptId','source','executable'];return Object.fromEntries(keys.map(key=>[key,value[key]]));}
export function projectObservationOutcome(outcome){return ['committed','replayed'].includes(outcome?.kind)?{...outcome,value:projectObservationResult(outcome.value),projection:'safe-observation-summary-v1'}:outcome;}
