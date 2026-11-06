import worker from '../../src/worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createGovernanceRepository} from '../../../governance/repository.mjs';
import {createGovernanceReadModel} from '../../../governance/read-model.mjs';
import {createGovernanceService,GovernanceError} from '../../../application/governance-service.mjs';
import type {Statement} from '../../../storage/d1/atomic-driver';
// Synthetic local-only transport fault seam. Production routes use their real
// runtime clock and never accept a request principal, timestamp or fault mode.
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture/vote')return worker.fetch(request,env,ctx);
 const body=await request.json() as {wallet:string;ballotId:string;choice:'ASAP'|'7'|'14'|'30';nowMs:number;fault?:'omit'|'lost-ack'|'close'};
 let at=body.nowMs,once=true;const base=createD1AtomicDriver(env.DB);
 await env.DB.prepare('UPDATE governance_test_clock SET now_ms=?').bind(at).run();
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM governance_test_clock)',async batch(statements:readonly Statement[]){
  const claim=statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'));
  if(claim&&once){once=false;
   if(body.fault==='close'){at=Number((await env.DB.prepare('SELECT closes_ms FROM genesis_ballots WHERE id=?').bind(body.ballotId).first<{closes_ms:number}>())!.closes_ms);await env.DB.prepare('UPDATE governance_test_clock SET now_ms=?').bind(at).run();}
   if(body.fault==='omit')return base.batch(statements.filter(s=>!s.sql.startsWith('INSERT INTO genesis_votes')));
   if(body.fault==='lost-ack'){await base.batch(statements);throw Error('Synthetic acknowledgement loss after commit.');}
  }
  return base.batch(statements);
 }};
 const cryptoPort=createWebCrypto(),service=createGovernanceService({repository:createGovernanceRepository(driver,{crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()}}),reads:createGovernanceReadModel(driver),crypto:cryptoPort,clock:{nowMs:()=>at}});
 try{return Response.json(await service.castVote({kind:'wallet',wallet:body.wallet},{ballotId:body.ballotId,choice:body.choice}));}
 catch(error){return Response.json({error:{code:error instanceof GovernanceError?error.code:'fixture_error',message:String(error)}},{status:error instanceof GovernanceError?error.status:500});}
}};
