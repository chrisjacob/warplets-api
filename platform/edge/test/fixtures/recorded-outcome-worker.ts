// Private local066 acceptance only. All observation bytes are retained synthetic fixtures.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {canonicalJson} from '../../../security/canonical.mjs';
import {createRecordedReader} from '../../../evidence/recorded.mjs';
import {createEvidenceService} from '../../../evidence/service.mjs';
import {createEvidenceRepository} from '../../../evidence/repository.mjs';
import {createArtifactReferenceRepository} from '../../../storage/atomic-artifacts.mjs';
import {createRecordedTransactionOutcomeRepository} from '../../../storage/recorded-transaction-outcomes.mjs';
import {createRecordedOutcomeService} from '../../../transactions/recorded-outcome-service.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as any,raw=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto(),baseStore=r2ArtifactStore(env.MANIFESTS),metrics={sqlStatements:0,maxBatchBytes:0,maxParameters:0,objectReads:0};let fired=0;
 const driver={...raw,leaseNowSql:String(body.nowMs+(body.fault==='clock'?30001:0)),async batch(statements:any[]){const commit=statements.some(s=>s.sql.startsWith('INSERT INTO app_recorded_transaction_outcomes'));
  if(commit){const starts:Record<string,string>={'omit-event':'INSERT INTO tx_receipts','omit-binding':'INSERT INTO app_recorded_transaction_outcomes','omit-intent':'UPDATE tx_intents','omit-attempt':'UPDATE tx_attempts'};
   if(starts[body.fault]){fired++;statements=statements.filter(s=>!s.sql.startsWith(starts[body.fault]));}
   if(body.fault==='alter-digest'){fired++;statements=statements.map(s=>s.sql.startsWith('INSERT INTO app_recorded_transaction_outcomes')?{...s,values:s.values.map((v:unknown,index:number)=>index===6?'0'.repeat(64):v)}:s);}
   if(body.fault==='scope'){fired++;await env.DB.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').bind(body.principal.id).run();}
   if(body.fault==='head'){fired++;await env.DB.prepare('DELETE FROM app_evidence_heads').run();}
   if(body.fault==='clock')fired++;
  }const m=measureBatch(statements);metrics.sqlStatements+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);const result=await raw.batch(statements);if(commit&&body.fault==='lose'){fired++;throw Error('Synthetic committed response lost');}return result;
 }};
 const store={...baseStore,async getVerified(identity:any){metrics.objectReads++;return baseStore.getVerified(identity);}},ports={crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()},clock:{nowMs:()=>body.nowMs}};
 try{let result;if(body.method==='record')result=await createRecordedOutcomeService({repository:createRecordedTransactionOutcomeRepository(driver,{...ports,store}),crypto:cryptoPort}).record(body.principal,body.input);
 else{const reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:body.fixture.source.chainGenesis,records:body.fixture.records.map((r:any)=>({...r,bytes:new Uint8Array(r.bytes)})),crypto:cryptoPort}),source=body.fixture.source,evidence=createEvidenceService({...ports,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),store,readers:new Map([[canonicalJson([source.sourceId,source.sourceRevision]),reader]])});result=body.method==='register'?await evidence.registerSource(body.principal,source):await evidence.ingest(body.principal,body.input);}
 return Response.json({result,metrics,faultInjected:fired});}catch(error){return Response.json({error:String((error as Error).message),metrics,faultInjected:fired});}
}};
