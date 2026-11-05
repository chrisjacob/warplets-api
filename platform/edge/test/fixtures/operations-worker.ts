// Test-only local entry point; never imported by the application Worker.
import { createD1AtomicDriver } from '../../../storage/d1/atomic-driver';
import { createAtomicOperationsRepository } from '../../../storage/atomic-operations.mjs';
import { createWebCrypto } from '../../../security/web-crypto.mjs';
export default {
 async fetch(request:Request,env:Env){
  const body=await request.json() as {method:'changeScope'|'configureWorkload'|'reserveOptionalCost'|'settleOptionalCost'|'meterProviderAttempt'|'costPressure'|'actionDecision'|'capacityAt';
   command:never;nowMs:number;scope:string;epoch:number;fault?:'skip-child'|'scope'|'cost'|'staff'|'revoke'|'lost-response'};
  const driver=createD1AtomicDriver(env.DB);let injected=false;
  const wrapped={...driver,async batch(statements:Parameters<typeof driver.batch>[0]){
   if(!injected&&statements[0].sql.startsWith('INSERT INTO app_command_receipts')){
    injected=true;
    if(body.fault==='skip-child')statements=[...statements.slice(0,-2),statements[statements.length-1]];
    if(body.fault==='revoke')await env.DB.prepare("UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator='fixture-operator' AND scope='operations'").run();
    if(body.fault==='scope')await env.DB.prepare("INSERT INTO ops_scope_log VALUES('race','optional-notifications',1,NULL,0,'fixture-operator','fixture pause','fixture','race')").run();
    if(body.fault==='cost')await env.DB.prepare("INSERT INTO ops_optional_spend VALUES('race','optional-notifications','2026-01',0,'4900000','fixture-operator','fixture','reserved',NULL,NULL,NULL)").run();
    if(body.fault==='staff')await env.DB.prepare("INSERT INTO earn_workload_policies VALUES('race',0,0,0,60,0,'fixture-operator','fixture')").run();
    if(body.fault==='lost-response'){await driver.batch(statements);throw Error('fixture lost response');}
   }
   return driver.batch(statements);
  }};
  const measurements:unknown[]=[];
  const repository=createAtomicOperationsRepository(wrapped,{crypto:createWebCrypto(),ids:{next:()=>crypto.randomUUID()},telemetry:{record:(_name:string,fields:unknown)=>measurements.push(fields)}});
  try{
   const result=body.method==='costPressure'?await repository.costPressure(body.nowMs):body.method==='actionDecision'?await repository.actionDecision(body.scope,body.nowMs):
    body.method==='capacityAt'?await repository.capacityAt(body.epoch,body.nowMs):await repository[body.method](body.command);
   return Response.json({result,measurements,bookmark:repository.getBookmark()});
  }catch(error){return Response.json({error:String(error)},{status:500});}
 }
};
