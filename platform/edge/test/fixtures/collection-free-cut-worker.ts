import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import type {Statement} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {dispatchCollectionCut} from '../../../collect/free-cut-test-harness.mjs';
import {createCollectionCutRepository} from '../../../collect/free-cut-repository.mjs';
import {buildCollectionCutCommand,BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT} from '../../../collect/free-cut-service.mjs';
import type {CollectionCutCommandInput} from '../../../collect/free-cut-service.mjs';
type Body={nowMs:number;method:'stageRecord'|'beginCut'|'validatePage'|'sealCut';input:CollectionCutCommandInput&{requestKey:string;expectedRevisions?:{earn:string;source:string;control:string}};idPrefix:string;preview?:boolean;auditFault?:'omit'|'alter'|'lost-response'};
// Private local fixture only; no public cut or free mint authority is mounted.
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as Body;if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)return new Response('Invalid fixture clock',{status:400});
 const base=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto();let auditInjected=false;
 const driver={...base,leaseNowSql:String(body.nowMs),async batch(statements:readonly Statement[]){
  const selected=statements.flatMap(s=>{if(!s.sql.startsWith('INSERT INTO ops_config_audit')||!body.auditFault||body.auditFault==='lost-response')return [s];auditInjected=true;if(body.auditFault==='omit')return [];const values=[...s.values];values[7]='synthetic-wrong-operator';return [{...s,values}];});
  const result=await base.batch(selected);if(body.auditFault==='lost-response'&&!auditInjected&&statements.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit'))){auditInjected=true;throw Error('Synthetic cut acknowledgement loss');}return result;
 }};
 if(body.preview){const kinds={beginCut:BEGIN_COLLECTION_FREE_CUT,validatePage:VALIDATE_COLLECTION_CUT_PAGE,sealCut:SEAL_COLLECTION_FREE_CUT};if(body.method==='stageRecord')return new Response('Preview fixture supports named cut steps only',{status:400});const repository=createCollectionCutRepository(driver,{crypto:cryptoPort,clock:{nowMs:()=>body.nowMs},ids:{next:()=>crypto.randomUUID()}}),command=await buildCollectionCutCommand(kinds[body.method],{kind:'operator',id:'synthetic-cut-operator'},body.input,cryptoPort);return Response.json({status:200,result:await repository.previewCommand!(command)});}
 const result=await dispatchCollectionCut({driver,crypto:cryptoPort,request:body});return Response.json({...result,...(auditInjected&&result.status===500?{error:'mandatory-cut-audit'}:{}),auditInjected});
}};
