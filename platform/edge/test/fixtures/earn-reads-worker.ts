import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createEarnReadRepository} from '../../../storage/earn-reads.mjs';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).hostname!=='localhost')return new Response('fixture only',{status:403});
 const body=await request.json() as {method:'leaderboard'|'claims'|'submissions'|'capacity'|'actions';epoch:number;nowMs:number;wallet:string;after?:number;race?:boolean};
 const base=createD1AtomicDriver(env.DB);let changed=false;
 const repo=createEarnReadRepository({...base,async batch(statements){const rows=await base.batch(statements);
  if(body.race&&!changed&&statements.some(s=>s.sql.includes('FROM earn_awards'))){changed=true;await base.batch([{sql:"UPDATE earn_awards SET amount='1'",values:[]}]);}return rows;}});
 try{
  const principal={kind:'wallet' as const,wallet:body.wallet},result=body.method==='leaderboard'?await repo.readLeaderboard({epoch:body.epoch}):
   body.method==='claims'?await repo.readWalletClaims({principal,nowMs:body.nowMs,after:body.after}):
   body.method==='submissions'?await repo.readWalletSubmissions({principal,nowMs:body.nowMs,after:body.after}):
   body.method==='capacity'?await repo.readCapacity({nowMs:body.nowMs}):await repo.readActions({nowMs:body.nowMs});
  return Response.json(result);
 }catch(error){return Response.json({error:String(error)},{status:400});}
}};
