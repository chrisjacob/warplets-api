import {createOperationalEvent} from './events.mjs';
/** Only these bounded local mutation responses are observed. Never inspect a
 * request body, wallet, cookie, signature, URL query or arbitrary error text. */
const operations={'/api/v1/earn/submissions':'earn-admission','/api/v1/notifications/subscriptions':'notice-consent'};
async function responseKind(response){
 const outcome=response.headers.get('x-10x-local-outcome');
 if(outcome==='pending')return {outcome:'pending',reason:'dependency'};
 if(outcome==='refused')return {outcome:'refused',reason:'validation'};
 if(response.status===202)return {outcome:'pending',reason:'dependency'};
 if(response.status>=500)return {outcome:'unknown',reason:'transport-unknown'};
 if(response.status>=400)return {outcome:'refused',reason:response.status===409?'stale-revision':response.status===401||response.status===403?'scope-required':'validation'};
 if(outcome==='accepted'||outcome==='replayed')return {outcome,reason:'none'};
 return {outcome:'unknown',reason:'transport-unknown'};
}
export function createMutationEventObserver({runtime,crypto,clock,write=line=>console.info(line)}){
 if(typeof write!=='function')throw new TypeError('Operational event sink must be a function.');
 return async(request,run)=>{
  const operation=request.method==='POST'?operations[new URL(request.url).pathname]:null;
  if(!operation)return run();const started=clock.nowMs();
  const emit=async result=>{try{const durationMs=Math.max(0,clock.nowMs()-started),event=await createOperationalEvent({runtime,kind:operation==='earn-admission'?'command':'notice',operation,...result,durationMs},{crypto,clock});await write(JSON.stringify(event));}catch{/* Observability failure cannot alter a committed response or invent retry authority. */}};
  let response;try{response=await run();}catch(error){await emit({outcome:'unknown',reason:'transport-unknown'});throw error;}
  await emit(await responseKind(response));return response;
 };
}
