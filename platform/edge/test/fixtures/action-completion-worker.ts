import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createAtomicActionRepository,type AtomicActionCommand} from '../../../storage/atomic-actions.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
type Fault='omit-signed'|'omit-completion'|'lose-response'|'revoke-during-verify';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {command:AtomicActionCommand;fault?:Fault},base=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto();
 let fault=body.fault;
 const driver={...base,async batch(statements:Parameters<typeof base.batch>[0]){
  if(fault==='omit-signed')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO earn_signed_completions'));
  if(fault==='omit-completion')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO earn_action_completions'));
  const result=await base.batch(statements);
  if(fault==='lose-response'&&statements.some(s=>s.sql.startsWith('INSERT INTO earn_signed_completions'))){fault=undefined;throw Error('lost signed action response');}
  return result;
 }};
 const ports={ids:{next:()=>globalThis.crypto.randomUUID()},crypto:{...cryptoPort,async verifyEd25519(value:Parameters<typeof cryptoPort.verifyEd25519>[0]){
  if(fault==='revoke-during-verify'){
   fault=undefined;
   await env.DB.prepare('INSERT INTO earn_issuer_revocations VALUES(?,?,?)').bind(body.command.input.proof.issuerId,body.command.nowMs,'synthetic-racing-revocation').run();
  }
  return cryptoPort.verifyEd25519(value);
 }}};
 try{return Response.json(await createAtomicActionRepository(driver,ports).acceptCompletion(body.command));}
 catch(error){return Response.json({error:String(error)},{status:(error as {status?:number}).status??500});}
}};
