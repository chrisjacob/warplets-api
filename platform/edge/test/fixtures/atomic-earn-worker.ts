// Test-only entry point. Never imported by the application Worker.
import { createD1AtomicDriver } from '../../../storage/d1/atomic-driver';
import { createAtomicEarnRepository } from '../../../storage/atomic-earn.mjs';
import { createWebCrypto } from '../../../security/web-crypto.mjs';
export default {
  async fetch(request:Request,env:Env) {
    const body=await request.json() as {method:'admitSubmission'|'recordFinalReview';command:never;fault?:'skip-child'|'skip-audit'|'alter-audit'|'pause'|'revoke'|'lost-response'};
    const driver=createD1AtomicDriver(env.DB);let injected=false;
    const wrapped={...driver,async batch(statements:Parameters<typeof driver.batch>[0]) {
      if(!injected&&statements[0].sql.startsWith('INSERT INTO app_command_receipts')) {
        injected=true;
        if(body.fault==='skip-child')statements=[statements[0],...statements.slice(2)];
        if(body.fault==='skip-audit')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO ops_config_audit'));
        if(body.fault==='alter-audit')statements=statements.map(s=>s.sql.startsWith('INSERT INTO ops_config_audit')?{...s,values:s.values.map((v,i)=>i===7?'wrong-operator':v)}:s);
        if(body.fault==='pause')await env.DB.prepare("INSERT INTO ops_scope_log VALUES('r','earn-admission',1,NULL,0,'synthetic','race','synthetic','race')").run();
        if(body.fault==='revoke')await env.DB.prepare("UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator='synthetic-operator'").run();
        if(body.fault==='lost-response'){await driver.batch(statements);throw Error('synthetic lost response');}
      }
      return await driver.batch(statements);
    }};
    const measurements:unknown[]=[];
    const repository=createAtomicEarnRepository(wrapped,{crypto:createWebCrypto(),ids:{next:()=>crypto.randomUUID()},telemetry:{record:(_name:string,m:unknown)=>measurements.push(m)}});
    try {return Response.json({result:await repository[body.method](body.command),measurements,bookmark:repository.getBookmark()});}
    catch(error){return Response.json({error:String(error)}, {status:500});}
  },
};
