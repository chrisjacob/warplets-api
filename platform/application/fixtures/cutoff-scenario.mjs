// Synthetic local transcripts only. No network, provider or financial execution.
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {DAY_MS} from '../../domain/earn/index.mjs';
import {recordSamplePrice} from '../../pricing/fixtures.mjs';
import {createFreezeCommand,createCutoffFreezeRepository} from '../../storage/cutoff-freeze.mjs';
import {createCutoffSnapshotRepository} from '../../storage/cutoff-snapshot.mjs';
import {createAtomicSettlementRepository} from '../../storage/atomic-settlement.mjs';
import {createArtifactReferenceRepository} from '../../storage/atomic-artifacts.mjs';
import {createPrivateReferenceService} from '../../artifacts/reference-service.mjs';
import {prepareArtifact,verifiedBytes} from '../../artifacts/identity.mjs';
import {createEvidenceRepository} from '../../evidence/repository.mjs';
import {createEvidenceService} from '../../evidence/service.mjs';
import {evidenceFixture} from '../../evidence/fixtures.mjs';
import {createCutoffSnapshotService} from '../../earn/snapshot.mjs';
import {registerPosition,recordPositionEvent,reconcilePosition} from '../../earn/positions.mjs';
import {DAMM_V2_PROGRAM} from '../../pricing/policy.mjs';
export async function cutoffScenario({complete=true,post=true,position=false,store:providedStore,beforeFreeze,historyStartMs}={}){
 const db=openDatabase(),crypto=createNodeCrypto(),principal={kind:'operator',id:'synthetic-snapshot'},epoch=20,start=epoch*DAY_MS,cutoff=start+DAY_MS-1;
 let now=cutoff+1;const clock={nowMs:()=>now};db.function('fixture_snapshot_clock',()=>now);
 const driver={...createNodeAtomicDriver(db),leaseNowSql:'fixture_snapshot_clock()'},ports={crypto,ids:{next:randomUUID},clock};
 for(const scope of ['earn-snapshot','evidence-ingest','earn-settlement'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,scope);
 db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('A',start,'1000000');
 if(post){
  const entry=recordSamplePrice(db,{wallet:'w',tokenId:'A',asOfMs:start,stakedUnits:'10000000',validUntilMs:start+100});
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('fixture-post','w','A',epoch,'https://example.test/post',start+1,entry.receipt,'fixture-key');
  db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run('fixture-post',7,'fixture-moderator','synthetic review',start+2,'synthetic-review');
  recordSamplePrice(db,{wallet:'w',tokenId:'A',asOfMs:cutoff,stakedUnits:'10000000'});
  db.prepare('INSERT INTO earn_owner_snapshots VALUES(?,?,?,?)').run(epoch,'w','[]','synthetic-owner');
  if(position){
   registerPosition(db,{wallet:'w',tokenId:'A',enrolledMs:start});
   recordPositionEvent(db,{wallet:'w',tokenId:'A',sequence:1,type:'verified-buy-and-stake',signature:'synthetic-buy',instructionIndex:2,atMs:start+1,confirmed:true,sourceRef:'synthetic-journal',
    swap:{wallet:'w',tokenId:'A',signature:'synthetic-buy',instructionIndex:1,netBoughtUnits:'10000000'},deposit:{wallet:'w',tokenId:'A',signature:'synthetic-buy',instructionIndex:2,depositedUnits:'10000000'}});
   reconcilePosition(db,{epoch,wallet:'w',tokenId:'A',asOfMs:cutoff,reconciledSequence:1,sourceRef:'synthetic-history'});
  }
 }
 if(beforeFreeze)await beforeFreeze({db,epoch,start,cutoff,advance:ms=>now+=ms});
 const objects=new Map(),store=providedStore??{async putIfAbsent(i,b){const {identity,bytes}=await prepareArtifact(i,b),exists=objects.has(i.key);if(!exists)objects.set(i.key,bytes);
  const check=await verifiedBytes(identity,objects.get(i.key));if(check.status!=='verified')throw Error('Fixture object conflict');return {status:exists?'exists':'created'};},
  async getVerified(i){return objects.has(i.key)?verifiedBytes(i,objects.get(i.key)):{status:'missing',identity:i};}};
 const artifactRepository=createArtifactReferenceRepository(driver,ports),privateReferences=createPrivateReferenceService({store,repository:artifactRepository,...ports});
 const repository=createCutoffSnapshotRepository(driver,ports),settlementRepository=createAtomicSettlementRepository(driver,ports);
 const service=createCutoffSnapshotService({repository,settlementRepository,privateReferences,...ports});
 await createCutoffFreezeRepository(driver,ports).freezeEpoch(await createFreezeCommand({principal,epoch,nowMs:now},crypto));
 const query={epoch,historyStartMs:historyStartMs??start,sourceBindings:[]},readers=new Map(),evidenceRepository=createEvidenceRepository(driver,ports);
 const evidenceService=createEvidenceService({repository:evidenceRepository,artifactRepository,store,...ports,readers});
 const fixtures=[];
 if(complete){
  const inventory=await repository.loadInventory({...query,nowMs:now});
  let index=0;
  for(const requirement of inventory.inputs.filter(i=>i.authority==='evidence')){
   const pricing=['entry-stake','closing-stake'].includes(requirement.kind),history=requirement.kind==='position-history',at=requirement.cutoffMs;
   const [wallet,tokenId]=pricing||history?JSON.parse(requirement.subject.id):[];
   const marketPolicy=pricing||history?JSON.parse(db.prepare('SELECT policy FROM price_sources WHERE token_id=?').get(tokenId).policy):null;
   const policy=pricing?marketPolicy:history?{wallet,tokenId,enrolledAtMs:requirement.coverage.fromMs,farmProgram:marketPolicy.farmProgram,swapProgram:DAMM_V2_PROGRAM}:{kind:requirement.kind,fromMs:requirement.coverage.fromMs};
   const field={'campaign-registry':'campaigns',ownership:'assets','position-inventory':'positions','action-completions':'completions'}[requirement.kind];
   const payload=pricing?JSON.parse(db.prepare('SELECT raw_evidence FROM price_observations WHERE wallet=? AND token_id=? AND as_of_ms=? ORDER BY revision DESC LIMIT 1').get(wallet,tokenId,at).raw_evidence):history?
    {network:'local-solana',wallet,tokenId,enrolledAtMs:policy.enrolledAtMs,throughMs:at,complete:true,pages:[{cursor:null,nextCursor:null,events:requirement.value.events.map(e=>({
     ...e,program:policy.farmProgram,finality:'finalized',...(e.type==='verified-buy-and-stake'?{
      swap:{program:policy.swapProgram,wallet:e.wallet,tokenId:e.tokenId,signature:e.signature,instructionIndex:e.swapIndex,netBoughtUnits:e.netBoughtUnits},
      deposit:{wallet:e.wallet,tokenId:e.tokenId,signature:e.signature,instructionIndex:e.instructionIndex,depositedUnits:e.depositedUnits}}:{})
    }))}]}:
    {version:1,network:'local-solana',kind:requirement.kind,subject:requirement.subject,fromMs:requirement.coverage.fromMs,toMs:at,complete:true,pages:[{cursor:null,nextCursor:null,items:requirement.value[field]}]};
   const f=await evidenceFixture({crypto,payload,policy,subject:requirement.subject,decoderVersion:pricing?'synthetic-pricing-v1':history?'synthetic-position-history-v2':'synthetic-cutoff-facts-v1',now:at,
    records:[{id:'fixture',subject:requirement.subject,contextSlot:pricing?'100':'10',blockTimeMs:at,retrievedAtMs:at,finality:'finalized',bytes:utf8(canonicalJson(payload))}]});
   f.source.sourceId='cutoff-fixture-'+index++;f.request.sourceId=f.source.sourceId;
   readers.set(canonicalJson([f.source.sourceId,f.source.sourceRevision]),f.reader);
   const registered=await evidenceService.registerSource(principal,f.source);if(registered.kind!=='committed')throw Error(JSON.stringify(registered));
   const receipt=await evidenceService.ingest(principal,f.request);if(receipt.value?.decision.status!=='verified')throw Error(JSON.stringify(receipt));
   query.sourceBindings.push({kind:requirement.kind,subject:requirement.subject,cutoffMs:at,sourceId:f.source.sourceId,sourceRevision:f.source.sourceRevision,decoderVersion:f.source.decoderVersion});
   fixtures.push({...f,requirement,receipt:receipt.value});
  }
 }
 return {db,crypto,driver,ports,principal,epoch,start,cutoff,clock,advance:ms=>now+=ms,query,service,repository,settlementRepository,privateReferences,artifactRepository,store,objects,fixtures,evidenceService,evidenceRepository,readers};
}
