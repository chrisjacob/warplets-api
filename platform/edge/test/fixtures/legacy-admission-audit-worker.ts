import {auditLegacyAdmission,startLegacyAdmissions,finishLegacyAdmissions} from '../../../collect/legacy-admission-audit.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
// Private local acceptance only. Original stage/control/prefix audit facts are
// fixture-owned prerequisites, not public request or authorization interfaces.
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as any,crypto=createWebCrypto();let metrics:any=null,sqlStatements=0;
 const raw=(r:any)=>({id:r.id,size:r.size,bytes:Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0))});
 try{let result;if(body.method==='start')result=await startLegacyAdmissions(raw(body.record),{crypto});else if(body.method==='finish')result=await finishLegacyAdmissions(raw(body.record),body.prefix,{crypto});else if(body.method==='audit'){
  const input=body.input;sqlStatements++;const operation=await env.DB.prepare('SELECT * FROM collect_operations WHERE id=?').bind(input.operation.id).first();if(!operation)throw new TypeError('synthetic-original-operation-missing');
  result=await auditLegacyAdmission({...input,operation,sourceRoot:raw(input.sourceRoot),admissionPage:raw(input.admissionPage),membership:input.membership?{seal:input.membership.seal,page:raw(input.membership.page)}:null},{crypto,onMeasure:m=>{metrics=m;}});
 }else return new Response('Not found',{status:404});return Response.json({result,metrics,sqlStatements});}catch(error){return Response.json({error:String(error),code:(error as {code?:string}).code??null,metrics,sqlStatements},{status:409});}
}};
