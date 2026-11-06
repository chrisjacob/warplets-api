// Offline measurement fixtures only. These functions do not change recovery
// limits, source authority, schema or the accepted backup format.
import {governanceOperatorFixture,governanceWallets} from '../governance/operator-test-fixture.mjs';
import {createRecoveryExporter} from './export.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {readSchema,rowExpression,rowOrder,quote} from './schema.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {RECOVERY_LIMITS} from './inventory.mjs';
import {createGovernanceService} from '../application/governance-service.mjs';
import {createGovernanceRepository} from '../governance/repository.mjs';
import {createCollectionStateCodec} from '../collect/state-codec.mjs';
import {prepareCollectionRecord} from '../collect/source-intake.mjs';
import {createInventory,publishStage,admitMint,applyVerifiedMintDraw} from '../domain/collections/inventory.mjs';
import {encode58} from '../server/base58.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
export async function governanceCapacityFixture(t){
 const wallets=governanceWallets(10000),f=await governanceOperatorFixture(t,{holders:wallets.slice(0,6000),nextWhitelist:wallets.slice(4000),union:wallets});
 const published=await f.publish();if(published.kind!=='committed')throw Error(JSON.stringify(published));return {...f,published};
}
export async function castCapacityVotes(f){
 const service=createGovernanceService({...f.ports,repository:createGovernanceRepository(f.base,f.ports)});
 for(const wallet of f.union)await service.castVote({kind:'wallet',wallet},{ballotId:f.input.ballotId,choice:'7'});
}
/** The existing maximum source-closure fixture, measured without staging or
 * pretending its historical declarations are economic authority. Payload-only
 * sizes are a strict lower bound: SQL envelopes and command receipts add more. */
export async function maximumSourceBundle(){
 const crypto=createNodeCrypto(),codec=createCollectionStateCodec({crypto}),wallets=(count,offset=0)=>Array.from({length:count},(_,n)=>{const b=Buffer.alloc(32,127);b.writeUInt32BE(offset+n,28);return encode58(b);}).sort();
 const initial=wallets(1000);let state=createInventory({id:'synthetic-capacity-source',kind:'genesis',tranche:1});
 for(let n=0;n<32;n++)state=publishStage(state,{id:'stage-'+n,type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets:initial,walletLimit:1});
 for(let n=0;n<1000;n++)state=admitMint(state,{operationId:'op-'+n,wallet:initial[n],stageId:'stage-0',at:180000000,drawCommitment:'commit-'+n,costLamports:5000n});
 state=structuredClone(state);state.stages=state.stages.map((s,n)=>({...s,id:String(n).padStart(3,'0')+'s'.repeat(125),wallets:wallets(10000,n*10000),inventoryOverrideReason:'漢'.repeat(500),ballotId:'b'.repeat(128),termsDigest:'a'.repeat(64)}));
 state.admissions=state.admissions.map((r,n)=>({...r,stageId:state.stages[0].id,operationId:String(n).padStart(4,'0')+'o'.repeat(124),drawCommitment:String(n).padStart(4,'0')+'c'.repeat(124),costLamports:(1n<<64n)-1n}));
 for(const [n,row] of state.admissions.entries())state=applyVerifiedMintDraw(state,{operationId:row.operationId,drawCommitment:row.drawCommitment,proofId:String(n).padStart(4,'0')+'p'.repeat(124),ticket:0});
 const bundle=await codec.encodeReferenceInventory(state),records=new Map([...bundle.pages,...bundle.listManifests,bundle.root].map(r=>[r.id,r]));return {crypto,codec,bundle,records};
}
export async function maximumSourcePayloadFootprint(){
 const {crypto,codec,bundle,records}=await maximumSourceBundle();let rawBytes=0,storedBase64Bytes=0,indexEntryBytes=0,indexPages=0;
 for(const record of records.values()){const verified=await prepareCollectionRecord(record,crypto);rawBytes+=record.size;storedBase64Bytes+=utf8(verified.bodyBase64).length;if(verified.kind==='eligibility'){const page=await codec.verifyRecord(record);indexEntryBytes+=utf8(canonicalJson(page.entries)).length;indexPages++;}}
 return {classification:'Synthetic source closure; payload-only lower bound excludes SQL envelopes/receipts',records:records.size,lists:bundle.listManifests.length,admissionPages:bundle.pages.length-indexPages,indexPages,rawBytes,storedBase64Bytes,indexEntryBytes,minimumStoredPayloadBytes:storedBase64Bytes+indexEntryBytes,currentTotalBytesLimit:RECOVERY_LIMITS.totalBytes};
}
/** Simulate the current v1 page packer for a measured source. This is diagnostic
 * sizing, not a replacement exporter or a statement that capture is permitted. */
export async function inspectRecoveryFootprint(db,driver){
 const descriptor=await readSchema(driver),tables=[];
 for(const table of descriptor.tables){
  const rows=db.prepare(`SELECT ${rowExpression(table)} row_json FROM ${quote(table.name)} ORDER BY ${rowOrder(table)}`).all().map(r=>JSON.parse(r.row_json));
  const limit=table.name==='app_collection_records'?192*1024:128*1024;let index=0,pageRows=[],pageBytes=0,pages=0,maxPageBytes=0;
  const page=()=>({format:'10x.local.recovery.table.v1',table:table.name,index,columns:table.columns,hasRowid:table.hasRowid,rows:pageRows});
  const flush=()=>{const bytes=utf8(canonicalJson(page())).length;pageBytes+=bytes;maxPageBytes=Math.max(maxPageBytes,bytes);pages++;index++;pageRows=[];};
  for(const row of rows){if(pageRows.length===100||utf8(canonicalJson({...page(),rows:[...pageRows,row]})).length>limit)flush();pageRows.push(row);}if(pageRows.length)flush();
  tables.push({name:table.name,rowCount:rows.length,rowBytes:rows.reduce((sum,row)=>sum+utf8(canonicalJson(row)).length,0),pages,pageBytes,maxPageBytes});
 }
 const pages=tables.reduce((sum,t)=>sum+t.pages,0),pageBytes=tables.reduce((sum,t)=>sum+t.pageBytes,0),rowBytes=tables.reduce((sum,t)=>sum+t.rowBytes,0);
 const referencedPrivate=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(size),0) bytes FROM app_private_artifacts').get(),catalog=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(size_bytes),0) bytes FROM manifest_catalog').get();
 if(referencedPrivate.n||catalog.n)throw Error('Diagnostic currently requires a synthetic collection-only source without artifact references.');
 return {tableCount:tables.length,tables,rows:tables.reduce((sum,t)=>sum+t.rowCount,0),rowBytes,pageBytes,pages,maxPageBytes:Math.max(...tables.map(t=>t.maxPageBytes)),estimatedCaptureOperations:3+4*tables.length+3*pages,estimatedFinishOperations:16+2*pages+tables.length,currentLimits:RECOVERY_LIMITS};
}
export async function measureCurrentCapture(f){
 const metrics={sqlStatements:0,batches:0,maxParameters:0,maxBatchBytes:0,maximumRows:0,objectReads:0,objectWrites:0},artifacts=memoryArtifacts(),driver={...f.base,async batch(statements){const m=measureBatch(statements);metrics.sqlStatements+=m.statements;metrics.batches++;metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);const results=await f.base.batch(statements);metrics.maximumRows=Math.max(metrics.maximumRows,...results.map(r=>r.rows.length));return results;}},store={...artifacts,async getVerified(identity){metrics.objectReads++;return artifacts.getVerified(identity);},async putIfAbsent(identity,bytes){metrics.objectWrites++;return artifacts.putIfAbsent(identity,bytes);}};
 const schema=await readInstalledRecoverySchema(f.ports.crypto),ports={...f.ports,driver,artifacts:store,schema,codec:createManifestCodec(f.ports),sourceCommit:'0'.repeat(40)},start=performance.now(),result=await createRecoveryExporter(ports).capturePrivate();
 return {result,metrics,elapsedMs:performance.now()-start,footprint:await inspectRecoveryFootprint(f.db,f.base)};
}
