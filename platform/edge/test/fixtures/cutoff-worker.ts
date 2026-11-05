import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createCutoffFreezeRepository,type FreezeCommand} from '../../../storage/cutoff-freeze.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {command:FreezeCommand;fault?:'omit-freeze'|'lose-response'};
 const base=createD1AtomicDriver(env.DB);let fault=body.fault;
 const driver={...base,async batch(statements:Parameters<typeof base.batch>[0]){
  if(fault==='omit-freeze')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_epoch_freezes'));
  const result=await base.batch(statements);
  if(fault==='lose-response'&&statements[0].sql.startsWith('INSERT INTO app_command_receipts')){fault=undefined;throw Error('lost freeze response');}
  return result;
 }};
 const measurements:unknown[]=[],repo=createCutoffFreezeRepository(driver,{crypto:createWebCrypto(),ids:{next:()=>crypto.randomUUID()},telemetry:{record:(_name,m)=>measurements.push(m)}});
 try{return Response.json({result:await repo.freezeEpoch(body.command),measurements});}catch(error){return Response.json({error:String(error)},{status:500});}
}};
