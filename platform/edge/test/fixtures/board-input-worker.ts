import { createD1AtomicDriver } from '../../../storage/d1/atomic-driver';
import { loadAtomicBoardInput } from '../../../storage/atomic-board-input.mjs';
import { createWebCrypto } from '../../../security/web-crypto.mjs';
import { computeBoard } from '../../../earn/settlement.mjs';
export default {async fetch(request:Request,env:Env){
  const query=await request.json() as {epoch:number;nowMs:number;sourceRef:string;race?:boolean};
  const driver=createD1AtomicDriver(env.DB);let changed=false;
  const wrapped={...driver,async batch(statements:Parameters<typeof driver.batch>[0]) {
    const result=await driver.batch(statements);
    if(query.race&&!changed&&statements[0].sql.includes('CASE WHEN length(assets)')){changed=true;await env.DB.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();}
    return result;
  }};
  const loaded=await loadAtomicBoardInput(wrapped,createWebCrypto(),query);
  return Response.json({...loaded,...(loaded.kind==='loaded'?{plan:computeBoard(loaded.input)}:{})});
}};
