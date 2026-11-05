import {requireValue} from '../earn/validation.mjs';
import {createHandlerRegistry} from './handlers.mjs';
export function retryDelay(attempt,jitter=()=>0.5){
 const sample=jitter();requireValue(Number.isFinite(sample)&&sample>=0&&sample<=1,'Invalid jitter.');
 return Math.min(60000,1000*2**Math.min(attempt-1,6))+Math.floor(sample*250);
}
export async function runTick({repository,clock,handlers=createHandlerRegistry(),outbox,limit=20,deadlineMs=2000,leaseMs=30000,jitter=()=>0.5}){
 requireValue(Number.isInteger(limit)&&limit>=1&&limit<=20,'Tick limit must be1–20.');
 requireValue(Number.isInteger(deadlineMs)&&deadlineMs>=1&&deadlineMs<=5000,'Tick deadline must be1–5000ms.');
 const deadline=clock.nowMs()+deadlineMs,wallDeadline=Date.now()+deadlineMs,items=[],expired=Symbol('deadline');
 const summary=()=>({mode:'local-validation',processed:items.length,items,deadlineReached:clock.nowMs()>=deadline||Date.now()>=wallDeadline,financialExecution:false});
 async function bounded(action){
  const remaining=Math.min(deadline-clock.nowMs(),wallDeadline-Date.now());if(remaining<=0)return expired;
  let timer;try{return await Promise.race([Promise.resolve().then(action),new Promise(resolve=>{timer=setTimeout(()=>resolve(expired),remaining);})]);}
  finally{clearTimeout(timer);}
 }
 async function io(action,reason){try{const value=await bounded(action);return value===expired?{kind:'pending',reason}:value;}catch{return {kind:'pending',reason};}}
 if(outbox){const result=await io(()=>outbox({limit}),'outbox-outcome-unknown');if(result?.kind==='pending'){items.push(result);return summary();}}
 for(let index=0;index<limit&&clock.nowMs()<deadline&&Date.now()<wallDeadline;index++){
  const acquired=await io(()=>repository.acquireJob({leaseMs}),'acquire-outcome-unknown');
  if(acquired.kind==='idle')break;
  if(acquired.kind!=='acquired'){items.push(acquired);break;}
  const job=acquired.job,abort=new AbortController();let checkpointSeq=job.checkpointSeq;
  const context={job,lease:job.lease,payload:job.payload,signal:abort.signal,deadlineMs:deadline,
   checkpoint:async(value,sequence=checkpointSeq)=>{
    if(abort.signal.aborted)return {kind:'pending',reason:'handler-aborted'};
    const result=await io(()=>repository.checkpoint(job.lease,{sequence,value}),'checkpoint-outcome-unknown');
    if(result.kind==='checkpointed')checkpointSeq=result.job.checkpointSeq;return result;
   }};
  let outcome;
  try{outcome=await bounded(()=>handlers[job.type](context));}
  catch(error){
   outcome=error?.effect==='read-only'&&error?.retryable===true
    ?{state:'retry',reason:'read-transport',dependency:null,readyMs:clock.nowMs()+retryDelay(job.attempt,jitter)}
    :{state:'held',reason:'handler-outcome-unknown',dependency:'reconciliation',readyMs:null};
  }
  if(outcome===expired){abort.abort();items.push({kind:'pending',reason:'handler-outcome-unknown'});break;}
  const finished=await io(()=>repository.finish(job.lease,outcome),'finish-outcome-unknown');items.push(finished);
  abort.abort();if(finished.kind==='pending')break;
 }
 // A timed-out write may still commit. Preserve the lease/outbox and reconcile
 // its durable identity on a later invocation; never report an assumed rollback.
 return summary();
}
