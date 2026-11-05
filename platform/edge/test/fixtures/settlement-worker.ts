// Private fixture-only settlement seam. Not part of the application Worker.
import { createD1AtomicDriver } from '../../../storage/d1/atomic-driver';
import { createAtomicSettlementRepository } from '../../../storage/atomic-settlement.mjs';
import { createPrivateReferenceService } from '../../../artifacts/reference-service.mjs';
import { createArtifactReferenceRepository } from '../../../storage/atomic-artifacts.mjs';
import { r2ArtifactStore } from '../../../artifacts/r2';
import { createWebCrypto } from '../../../security/web-crypto.mjs';
import type { ArtifactIdentity } from '../../../application/ports';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {method:'sealBoardInput'|'commitBoard'|'commitAllocation'|'store';command:never;lease:never;
  identity:ArtifactIdentity;bytes:number[];nowMs:number;fault?:'omit-last-child'|'expire-during-hash'|'expire-during-transport';useDatabaseClock?:boolean};
 const driver=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto(),measurements:unknown[]=[];
 let nowMs=body.nowMs;
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS fixture_clock(now_ms INTEGER NOT NULL)').run();
 await env.DB.batch([env.DB.prepare('DELETE FROM fixture_clock'),env.DB.prepare('INSERT INTO fixture_clock VALUES(?)').bind(nowMs)]);
 const wrapped={...driver,leaseNowSql:body.useDatabaseClock?undefined:'(SELECT now_ms FROM fixture_clock)',async batch(statements:Parameters<typeof driver.batch>[0]){
  if(body.fault==='expire-during-transport'&&statements.some(s=>s.sql.startsWith('INSERT INTO earn_boards')))await env.DB.prepare('UPDATE fixture_clock SET now_ms=now_ms+20000').run();
  if(body.fault==='omit-last-child'&&statements[0].sql.startsWith('INSERT INTO app_command_receipts'))statements=statements.filter((_,index)=>index!==statements.length-2);
  return driver.batch(statements);
 }};
 const ports={crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()}};
 if(body.method==='store'){
  const service=createPrivateReferenceService({store:r2ArtifactStore(env.MANIFESTS),repository:createArtifactReferenceRepository(driver,ports),crypto:cryptoPort,clock:{nowMs:()=>nowMs}});
  return Response.json(await service.persist({kind:'operator',id:'synthetic'},{identity:body.identity,bytes:new Uint8Array(body.bytes),requestKey:'input-object'}));
 }
 const cryptoWithClock={...cryptoPort,async sha256(bytes:Uint8Array){const value=await cryptoPort.sha256(bytes);if(body.fault==='expire-during-hash')nowMs+=100000;return value;}};
 const repository=createAtomicSettlementRepository(wrapped,{...ports,crypto:cryptoWithClock,clock:{nowMs:()=>nowMs},telemetry:{record:(_name,m)=>measurements.push(m)}});
 try{return Response.json({result:await repository[body.method](body.command,body.lease),measurements});}
 catch(error){return Response.json({error:String(error)},{status:500});}
}};
