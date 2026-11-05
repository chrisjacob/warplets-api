// Local-only recovery fixture. It is never mounted by the application Worker.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createManifestCodec} from '../../../artifacts/manifest-codec.mjs';
import {createPublicRecovery,createPrivateRecovery} from '../../../recovery/restore.mjs';
import {createRecoveryExporter} from '../../../recovery/export.mjs';
import {readPublicRecoveredClaims} from '../../../recovery/reconcile.mjs';
import {createJobRepository} from '../../../jobs/repository.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {method:string;mode:'public'|'private';input:never;schema:never;query:never;nowMs:number;fault?:string};
 const raw=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto(),artifacts=r2ArtifactStore(env.MANIFESTS),measurements={batches:0,statements:0,maxBatchStatements:0};let fired=false;
 const driver={...raw,async batch(statements:Parameters<typeof raw.batch>[0]){
  measurements.batches++;measurements.statements+=statements.length;measurements.maxBatchStatements=Math.max(measurements.maxBatchStatements,statements.length);
  if(!fired&&statements.some(s=>s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=?'))){
   fired=true;
   if(body.fault==='omit-nonce-clear')statements=statements.filter(s=>!s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=NULL'));
   const result=await raw.batch(statements);if(body.fault==='lost-step-response')throw Error('Synthetic lost recovery acknowledgement');return result;
  }return raw.batch(statements);
 }};
 const ports={driver,artifacts,crypto:cryptoPort,codec:createManifestCodec({crypto:cryptoPort}),clock:{nowMs:()=>body.nowMs},ids:{next:()=>crypto.randomUUID()},schema:body.schema};
 try{
  let result;
  if(body.method==='capture-private'||body.method==='capture-public'){
   const exporter=createRecoveryExporter({...ports,sourceCommit:'0'.repeat(40)}),captured=await exporter[body.method==='capture-private'?'capturePrivate':'capturePublic']();
   if('bytes' in captured){const {bytes,...rest}=captured;result=rest;}else result=captured;
  }else if(body.method==='claims')result=await readPublicRecoveredClaims(driver,body.query);
  else if(body.method==='stale-finish')result=await createJobRepository(driver,{...ports,principal:{kind:'operator',id:'synthetic-recovery'}}).finish(body.query,{state:'completed',result:{stale:true}});
  else{
   const service=(body.mode==='public'?createPublicRecovery:createPrivateRecovery)(ports);
   if(!['start','step','finish','restore'].includes(body.method))throw Error('Unknown synthetic recovery method');
   result=await service[body.method as 'start'|'step'|'finish'|'restore'](body.input);
  }
  return Response.json({result,measurements});
 }catch(error){return Response.json({error:String(error),measurements},{status:500});}
}};
