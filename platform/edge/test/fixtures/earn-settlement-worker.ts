// Private local-only B07 acceptance Worker. No product route imports this file.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {measuredDriver,settlementAcceptance} from './earn-settlement-harness.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {method:string;nowMs:number;principal:{kind:'operator';id:string};fault?:string};
 const raw=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto();let fired=false;
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS fixture_settlement_clock(now_ms INTEGER NOT NULL)').run();
 await env.DB.batch([env.DB.prepare('DELETE FROM fixture_settlement_clock'),env.DB.prepare('INSERT INTO fixture_settlement_clock VALUES(?)').bind(body.nowMs)]);
 const m=measuredDriver({...raw,leaseNowSql:'(SELECT now_ms FROM fixture_settlement_clock)',async batch(statements:Parameters<typeof raw.batch>[0]){
  if(!fired&&body.fault==='lost-hold-response'&&statements.some(s=>s.sql.startsWith('WITH new_dependency'))){
   fired=true;await raw.batch(statements);throw Error('Synthetic lost held-job acknowledgement');
  }
  const board=statements.some(s=>/^INSERT INTO earn_boards\b/.test(s.sql));
  const allocation=statements.some(s=>/^INSERT INTO earn_allocations\b/.test(s.sql));
  if(!fired&&(board||allocation)){
   fired=true;
   if(body.fault==='omit-last-child'){
    const prefix=board?'INSERT INTO earn_streaks':'INSERT INTO earn_awards';
    let at=-1;statements.forEach((s,index)=>{if(s.sql.startsWith(prefix))at=index;});
    statements=statements.filter((_,index)=>index!==at);
   }
   if(body.fault==='omit-outbox')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_job_outbox'));
   if(body.fault==='wrong-publication-board')statements=statements.map(s=>{
    if(!s.sql.startsWith('INSERT INTO app_job_outbox'))return s;
    const command=JSON.parse(String(s.values[1]));command.input.payload.snapshotId='0'.repeat(64);
    return {...s,values:s.values.map((v,index)=>index===1?JSON.stringify(command):v)};
   });
   if(body.fault==='correction-race')await env.DB.prepare("UPDATE app_operator_scopes SET revision=revision+1 WHERE scope='earn-settlement'").run();
   if(body.fault==='expired-worker')await env.DB.prepare('UPDATE app_execution_fences SET expires_ms=?').bind(body.nowMs-1).run();
   const result=await raw.batch(statements);
   if(body.fault==='lost-committed-response')throw Error('Synthetic lost committed response');
   return result;
  }
  return raw.batch(statements);
 }});
 const acceptance=settlementAcceptance({driver:m.driver,store:r2ArtifactStore(env.MANIFESTS),crypto:cryptoPort,
  clock:{nowMs:()=>body.nowMs},ids:{next:()=>crypto.randomUUID()},principal:body.principal});
 try{return Response.json({result:await acceptance.call(body),measurements:m.measurements});}
 catch(error){return Response.json({error:String(error),measurements:m.measurements},{status:500});}
}};
