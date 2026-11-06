// Private disposable acceptance control only. No member/operator HTTP mount.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRefreshRepository} from '../../../nfts/refresh-repository.mjs';
import {createPrivateReferenceService} from '../../../artifacts/reference-service.mjs';
import {createArtifactReferenceRepository} from '../../../storage/atomic-artifacts.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
import {verifyRecoveredNftRefresh} from '../../../recovery/v2-reconcile-nft-refresh.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body:any=await request.json(),base=createD1AtomicDriver(env.DB),crypto=createWebCrypto(),store=r2ArtifactStore(env.MANIFESTS);let seq=0,injected=false;
 const metrics={sql:0,objectReads:0,objectWrites:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0};
 const driver={...base,leaseNowSql:String(body.nowMs),async batch(statements:any[]){const writing=statements.some(s=>s.sql.startsWith('INSERT INTO app_nft_refresh_revisions'));if(writing&&body.fault==='scope'){await env.DB.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='nft-refresh'").run();injected=true;}
  if(writing&&['omit-artifact','omit-revision'].includes(body.fault)){const name=body.fault==='omit-artifact'?'app_private_artifacts':'app_nft_refresh_revisions';statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO '+name));injected=true;}
  const m=measureBatch(statements);metrics.sql+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);const result=await base.batch(statements);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);
  if(writing&&body.fault==='lost'){injected=true;throw Error('Synthetic lost committed response');}return result;}};
 const artifacts={async getVerified(identity:any){metrics.objectReads++;return store.getVerified(identity);},async putIfAbsent(identity:any,bytes:Uint8Array){metrics.objectWrites++;if(body.fault==='unknown-missing'&&identity.semanticDigest!==null){injected=true;return {status:'unknown' as const,identity};}return store.putIfAbsent(identity,bytes);}};
 const ports={crypto,artifacts,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++seq)}},repo=createRefreshRepository(driver,ports);
 try{let result;if(body.method==='register'){const service=createPrivateReferenceService({store:artifacts,repository:createArtifactReferenceRepository(driver,ports),crypto,clock:ports.clock});result=await service.persist(body.principal,{identity:body.identity,bytes:Uint8Array.from(body.bytes),requestKey:body.identity.byteDigest});}
 else if(body.method==='verify'){const row=await env.DB.prepare("SELECT * FROM app_command_receipts WHERE operation_kind='nfts.refresh.v1' AND request_key=? AND principal_key=?").bind(body.requestKey,body.principalKey).first();result=await verifyRecoveredNftRefresh(row,{read:async(statements:any[])=>(await driver.batch(statements)).map(r=>r.rows),artifacts,crypto});}
 else if(body.method==='read')result=await repo.read(body.principal,{requestId:body.requestId});else result=await repo.execute(body.command);
 return Response.json({result,metrics,injected});}catch(error:any){return Response.json({error:error.message,metrics,injected},{status:500});}
}};
