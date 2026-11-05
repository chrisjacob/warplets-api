const deferred=Object.freeze({availability:'not-implemented'});
export const deferredPort=()=>deferred;
function port(value,label) {
  if(!value||typeof value!=='object')throw new TypeError('Missing application '+label+' port.');
  return Object.freeze({...value});
}
export function createApplicationContext(input) {
  if(input?.executionPolicy?.mode!=='local-validation'||input.executionPolicy.financialExecution!==false)
    throw new TypeError('Only local validation without financial execution is supported.');
  const context={};
  for(const name of ['clock','ids','crypto','evidence','artifacts','jobs','telemetry'])context[name]=port(input[name],name);
  if(typeof context.clock.nowMs!=='function'||typeof context.ids.next!=='function'
    ||typeof context.crypto.sha256!=='function'||typeof context.crypto.verifyEd25519!=='function')
    throw new TypeError('Invalid clock, ID or crypto port.');
  context.repositories=Object.freeze(Object.fromEntries(Object.entries(input.repositories??{}).map(([key,value])=>[key,port(value,key)])));
  context.executionPolicy=Object.freeze({mode:'local-validation',financialExecution:false});
  return Object.freeze(context);
}
