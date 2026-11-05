// Test-only local endpoint. No provider or production HTTP exposure.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {loadCutoffInventory} from '../../../storage/cutoff-inventory.mjs';
import type {CutoffInventoryQuery} from '../../../storage/cutoff-inventory.mjs';
import {createFreezeCommand,createCutoffFreezeRepository} from '../../../storage/cutoff-freeze.mjs';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).hostname!=='localhost')return new Response('fixture only',{status:403});
 const body=await request.json() as {action:'freeze'|'load';query:CutoffInventoryQuery;fault?:'review-race'|'journal-race'};
 const cryptoPort=createWebCrypto(),base=createD1AtomicDriver(env.DB);let changed=false;
 const driver={...base,async batch(statements:Parameters<typeof base.batch>[0]){
  const result=await base.batch(statements);
  if(body.fault==='review-race'&&!changed&&statements.some(s=>s.sql.includes('FROM price_observations'))){
   changed=true;await base.batch([{sql:"UPDATE earn_reviews SET reason='corrected-during-inventory' WHERE submission_id='post'",values:[]}]);
  }
  if(body.fault==='journal-race'&&!changed&&statements.some(s=>s.sql.includes('FROM earn_position_events'))){
   changed=true;await base.batch([{sql:"UPDATE earn_position_events SET evidence=json_set(evidence,'$.sourceRef','corrected-during-inventory') WHERE wallet='w'",values:[]}]);
  }
  return result;
 }};
 try{
  const result=body.action==='freeze'?await createCutoffFreezeRepository(driver,{crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()}}).freezeEpoch(
   await createFreezeCommand({principal:{kind:'operator',id:'cutoff-fixture'},epoch:body.query.epoch,nowMs:body.query.nowMs},cryptoPort)):
   await loadCutoffInventory(driver,cryptoPort,body.query);
  return Response.json(result);
 }catch(error){return Response.json({error:String(error)},{status:500});}
}};
