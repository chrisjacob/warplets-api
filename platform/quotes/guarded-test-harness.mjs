// Private acceptance harness only. It is never mounted by the application.
import {canonicalJson} from '../security/canonical.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {createRecordedReader} from '../evidence/recorded.mjs';
import {createEvidenceService} from '../evidence/service.mjs';
import {createEvidenceRepository} from '../evidence/repository.mjs';
import {createArtifactReferenceRepository} from '../storage/atomic-artifacts.mjs';
import {createQuoteRepository} from './repository.mjs';
import {createQuoteService} from './service.mjs';
export const QUOTE_TEST_PRINCIPAL=Object.freeze({kind:'operator',id:'synthetic-quote-acceptance'});
export async function quoteTestDispatch({driver:raw,store:baseStore,crypto:baseCrypto,ids,fixture,request}){
 let nowMs=request.nowMs,fired=false;const measurement={sqlStatements:0,batches:0,objectReads:0,objectWrites:0};
 const driver={...raw,async batch(statements){measurement.sqlStatements+=statements.length;measurement.batches++;
  if(request.fault==='omit-input')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_quote_inputs'));
  const result=await raw.batch(statements);
  if(!fired&&request.fault==='lose-response'&&statements.some(s=>s.sql.startsWith('INSERT INTO app_quote_inputs'))){fired=true;throw Error('Synthetic lost quote receipt response');}
  return result;
 }};
 const crypto={...baseCrypto,async sha256(bytes){const result=await baseCrypto.sha256(bytes);
  if(!fired&&['change-head','expire-during-hash'].includes(request.fault)&&new TextDecoder().decode(bytes).includes('"quotedAt"')){
   fired=true;if(request.fault==='expire-during-hash')nowMs+=30001;
   else await driver.batch([sql('UPDATE app_evidence_heads SET receipt_digest=? WHERE stream_key=?',request.nextReceipt,request.streamKey)]);
  }return result;
 }};
 const store={async getVerified(identity){measurement.objectReads++;return baseStore.getVerified(identity);},async putIfAbsent(identity,bytes){measurement.objectWrites++;return baseStore.putIfAbsent(identity,bytes);}};
 const ports={crypto,ids,clock:{nowMs:()=>nowMs}},repository=createQuoteRepository(driver,ports);
 const selected=request.method==='materialize-command'?{...repository,recordInput:async command=>({kind:'command',command})}:repository;
 const service=createQuoteService({...ports,repository:selected,store}),principal=request.principal??QUOTE_TEST_PRINCIPAL;
 try{
  let result;
  if(['register','ingest'].includes(request.method)){
   const records=fixture.records.map(r=>({...r,bytes:new Uint8Array(r.bytes)})),reader=await createRecordedReader({mode:fixture.source.mode,chainGenesis:fixture.source.chainGenesis,records,crypto});
   const evidence=createEvidenceService({...ports,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),store,
    readers:new Map([[canonicalJson([fixture.source.sourceId,fixture.source.sourceRevision]),reader]])});
   result=request.method==='register'?await evidence.registerSource(principal,fixture.source):await evidence.ingest(principal,request.input);
  }else if(request.method==='bind')result=await service.bind(principal,request.input);
  else if(request.method==='materialize'||request.method==='materialize-command')result=await service.materialize(principal,request.marketId);
  else if(request.method==='record-command')result=await repository.recordInput(request.command);
  else if(request.method==='quote')result=await service.quote(request.input);
  else if(request.method==='availability')result=await service.availability(request.marketId);
  else throw Error('Unknown private quote test method');
  return {status:200,result,measurement,faultInjected:fired};
 }catch(error){return {status:error.status??500,result:{error:{code:error.code??'internal_error',message:String(error.message)}},measurement,faultInjected:fired};}
}
