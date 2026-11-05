// B20's private fixture dispatcher imports this module. The browser-facing
// loopback dispatcher never forwards /__fixture or any of these operations.
import {createRecoveryExporter} from '../../../recovery/export.mjs';
import {createPublicRecovery,createPrivateRecovery} from '../../../recovery/restore.mjs';
import {readPublicRecoveredClaims} from '../../../recovery/reconcile.mjs';
import {createJobRepository} from '../../../jobs/repository.mjs';
import type {AtomicDriver} from '../../../storage/atomic-earn.mjs';
import type {ArtifactStore} from '../../../artifacts/store';
import type {CanonicalCrypto,JobLease} from '../../../application/ports';
import type {RecoveryInput,RecoverySchema} from '../../../recovery/types';
import {createManifestCodec} from '../../../artifacts/manifest-codec.mjs';

type Ports={driver:AtomicDriver;artifacts:ArtifactStore;crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string}};
export async function handleRecoveryControl(body:Record<string,unknown>,_env:Env,ports:Ports):Promise<unknown|undefined>{
 const method=body.method;
 if(typeof method!=='string'||!method.startsWith('recovery-'))return undefined;
 if(method==='recovery-claims')return readPublicRecoveredClaims(ports.driver,body.query as {wallet:string;nowMs:number;after?:number});
 if(method==='recovery-stale-finish'){
  const p=body.principal as Record<string,unknown>|undefined;
  if(!p||p.kind!=='operator'||typeof p.id!=='string')throw Error('Synthetic recovery operator required.');
  return createJobRepository(ports.driver,{...ports,principal:{kind:'operator',id:p.id}}).finish(body.lease as JobLease,{state:'completed',result:{syntheticStaleLease:true}});
 }
 if(body.mode!=='public'&&body.mode!=='private')throw Error('Explicit synthetic recovery mode required.');
 const recoveryPorts={...ports,codec:createManifestCodec({crypto:ports.crypto}),schema:body.schema as RecoverySchema};
 if(method==='recovery-capture'){
  if(typeof body.sourceCommit!=='string')throw Error('Recorded source commit required.');
  const exporter=createRecoveryExporter({...recoveryPorts,sourceCommit:body.sourceCommit}),captured=await exporter[body.mode==='public'?'capturePublic':'capturePrivate']();
  if(captured.kind==='captured'){const {bytes,...result}=captured;return result;}return captured;
 }
 const service=(body.mode==='public'?createPublicRecovery:createPrivateRecovery)(recoveryPorts),input=body.input as RecoveryInput;
 if(method==='recovery-start')return service.start(input);
 if(method==='recovery-step')return service.step(input);
 if(method==='recovery-finish')return service.finish(input);
 return undefined;
}
