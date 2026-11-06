/** Exact server-reviewed terms for local API acceptance fixtures. */
export function reviewedProgressionRequest(q){
 return {kind:q.kind,targetId:q.targetId,expectedTargetVersion:q.targetVersion,...(q.kind==='upgrade'?{materialId:q.materialId,expectedMaterialVersion:q.materialVersion}:{}),
  quoteId:q.quoteId,bindingDigest:q.bindingDigest,policyVersion:q.policyVersion,reviewedFeeLamports:q.feeLamports,reviewedMaxTotalLamports:q.maxTotalLamports,quoteExpiresMs:q.quoteExpiresMs};
}
