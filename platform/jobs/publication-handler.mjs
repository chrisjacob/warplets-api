export function createPublicationHandler(service){return async context=>{
 if(context.signal.aborted)return {state:'held',reason:'publication-aborted',dependency:'publication-reconciliation',readyMs:null};
 let result;
 try{result=await service.run(context);}
 catch{return {state:'held',reason:'publication-outcome-unknown',dependency:'publication-reconciliation',readyMs:null};}
 if(result.kind==='published'){
  const {id,identity}=result.publication,summary={publicationId:id,byteDigest:identity.byteDigest,semanticDigest:identity.semanticDigest};
  const saved=await context.checkpoint(summary);
  return saved.kind==='checkpointed'?{state:'completed',result:summary}:{state:'held',reason:'publication-checkpoint-unknown',dependency:'publication-reconciliation',readyMs:null};
 }
 return {state:'held',reason:result.reason??result.code,dependency:'publication-reconciliation',readyMs:null};
};}
