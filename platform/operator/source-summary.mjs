/** Safe local summaries retain the receipt's original full-result commitment.
 * They deliberately do not expose wallet bounds, record bytes or stage outcomes. */
export function projectCollectionSourceResult(kind,value){
 const v=value;
 if(kind==='collection.seal-list.v1')return {id:v.id,count:v.count,pageCount:v.pageIds.length,walletsDigest:v.walletsDigest,closureDigest:v.closureDigest,visibility:'private-staging'};
 if(kind==='collection.seal-source.v1'){const {id,inventoryId,sourceRevision,declaredStateDigest,stageCount,admissionCount,closureDigest,verification,semanticStateDigestVerified,economicsVerified,provenanceVerified}=v;return {id,inventoryId,sourceRevision,declaredStateDigest,stageCount,admissionCount,closureDigest,verification,semanticStateDigestVerified,economicsVerified,provenanceVerified};}
 if(kind==='collection.materialize-eligibility-page.v1')return {id:v.id,entryCount:v.entryCount,visibility:v.visibility};
 throw new TypeError('Unsupported source summary.');
}
export function projectCollectionSourceOutcome(kind,outcome){return ['committed','replayed'].includes(outcome?.kind)?{...outcome,value:projectCollectionSourceResult(kind,outcome.value),projection:'safe-source-summary-v1'}:outcome;}
