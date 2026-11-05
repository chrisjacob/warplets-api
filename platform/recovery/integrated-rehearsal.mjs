import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {sign} from 'node:crypto';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
import {mediaType} from '../contracts/transport.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {verifyPinnedInventory,hashJson} from './inventory.mjs';
import {readRecoveryPage,fenceRow} from './reconcile.mjs';
import {objectRow} from './schema.mjs';

const comparedTables=['earn_boards','earn_allocations','earn_awards','earn_fixture_campaigns','app_jobs','app_job_attempts','app_job_events','app_job_outbox',
 'app_settlement_dependencies','app_command_receipts','app_artifact_publications','app_execution_fences','app_epoch_inputs','app_complete_inputs','app_snapshot_attempts','app_settlement_incidents','app_revisions'];
const sorted=rows=>rows.map(row=>JSON.parse(canonicalJson(row))).sort((a,b)=>{const x=canonicalJson(a),y=canonicalJson(b);return x<y?-1:x>y?1:0;});
const sortClaims=rows=>rows.sort((a,b)=>a.tokenId<b.tokenId?-1:a.tokenId>b.tokenId?1:a.day-b.day);
const operationCount=m=>(m?.sqlStatements??0)+(m?.objectReads??0)+(m?.objectWrites??0);
const measured=runtime=>({totals:runtime.measurements??null,maxSqlStatements:Math.max(0,...(runtime.measurementLog??[]).map(m=>m.sqlStatements??0)),
 maxCombinedPortOperations:Math.max(0,...(runtime.measurementLog??[]).map(operationCount))});
const value=result=>{assert.equal(result.success??true,true);return result.results;};
async function rows(runtime,table){assert.ok(comparedTables.includes(table));return value(await runtime.db.prepare('SELECT * FROM '+table).all());}
function bucketReader(bucket){return {async getVerified(identity){
 const object=await bucket.get(identity.key);if(!object)return {status:'missing',identity};
 if(object.size!==identity.size||object.httpMetadata?.contentType!==identity.contentType)return {status:'conflict',identity,reason:'metadata'};
 return {status:'verified',identity,bytes:new Uint8Array(await object.arrayBuffer())};
}};}
async function authenticate(runtime,account){
 const post=(path,body)=>runtime.mf.dispatchFetch(runtime.origin+'/api/v1'+path,{method:'POST',headers:{origin:runtime.origin,'content-type':'application/json',accept:mediaType},body:JSON.stringify(body)});
 const response=await post('/auth/challenges',{wallet:account.wallet});assert.equal(response.status,201,'new message challenge must be accepted');const {data:challenge}=await response.json();
 const proof={nonce:challenge.nonce,signature:encode58(sign(null,Buffer.from(challenge.message),account.privateKey))};
 const verified=await post('/auth/verify',proof);assert.equal(verified.status,200,'new wallet message must verify');
 const cookie=verified.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie?.startsWith('tenx_edge_local_session='));
 const me=await runtime.mf.dispatchFetch(runtime.origin+'/api/v1/me',{headers:{cookie,accept:mediaType}});assert.equal(me.status,200);assert.equal((await me.json()).data.wallet,account.wallet);return cookie;
}
async function capabilities(runtime){
 const response=await runtime.mf.dispatchFetch(runtime.origin+'/api/v1/capabilities',{headers:{accept:mediaType}});assert.equal(response.status,200);
 const {data:c}=await response.json();assert.equal(c.runtime,'workerd-local');assert.equal(c.walletAuthentication,'message-only');assert.equal(c.externalNotifications,false);
 for(const [name,enabled] of Object.entries(c.production))assert.equal(enabled,false,'financial capability '+name+' must remain disabled');return c.runtime;
}
async function pinnedRows(inventory,store,crypto){
 const tables=new Map();
 for(const name of comparedTables){const table=inventory.tables.find(t=>t.name===name);assert.ok(table,'actual private snapshot must include '+name);const captured=[];
  for(let n=0;n<table.pages.length;n++){const page=await readRecoveryPage(store,table.pages[n],table,n,crypto);assert.equal(page.kind,'verified',JSON.stringify(page));captured.push(...page.rows);}
  assert.equal(captured.length,table.rowCount);assert.equal(await hashJson(crypto,captured),table.rowsDigest);tables.set(name,{table,rows:captured});
 }return tables;
}
const objectsOf=(tables,name)=>{const t=tables.get(name);return t.rows.map(row=>objectRow(t.table,row));};
function assertConservation(allocations,awards){
 const identities=new Set();for(const a of allocations){const id=canonicalJson([a.token_id,a.day]);assert.equal(identities.has(id),false);identities.add(id);
  const paid=awards.filter(w=>w.token_id===a.token_id&&w.day===a.day).reduce((sum,w)=>sum+BigInt(w.amount),0n);
  assert.equal(paid+BigInt(a.burn),BigInt(a.budget),'declared burn plus awards must equal each original budget');
 }
}
async function verifyPublicHttp(runtime,pins,codec){
 const boards=new Map(),allocations=new Map();
 for(const pin of pins){
  const response=await runtime.mf.dispatchFetch(runtime.origin+'/api/v1/manifests/'+pin.identity.byteDigest);assert.equal(response.status,200,'retained public artifact must remain available');
  const artifact=await codec.verify(new Uint8Array(await response.arrayBuffer()),{semanticDigest:pin.semanticDigest,byteDigest:pin.identity.byteDigest});assert.equal(artifact.boardId,pin.boardId);
  const previous=boards.get(pin.epoch);if(previous)assert.equal(previous.boardId,pin.boardId);boards.set(pin.epoch,artifact);
  for(const a of artifact.manifest.allocations){const key=canonicalJson([a.tokenId,a.day]),old=allocations.get(key);if(old)assert.equal(canonicalJson(old),canonicalJson(a));allocations.set(key,a);}
 }return {boards,allocations};
}
async function copyPinnedObjects(source,target,inventory,crypto){
 let bytesCopied=0;
 for(const identity of inventory.objects){
  const object=await source.bucket.get(identity.key);assert.ok(object,'independently pinned object is required: '+identity.key);
  assert.equal(object.size,identity.size);assert.equal(object.httpMetadata?.contentType,identity.contentType);const bytes=new Uint8Array(await object.arrayBuffer());assert.equal(await crypto.sha256(bytes),identity.byteDigest);
  // Each destination runtime/bucket is fresh. Use the same create-once
  // condition as ArtifactStore; an existing result still requires verification.
  await target.bucket.put(identity.key,bytes,{onlyIf:{etagDoesNotMatch:'*'},sha256:identity.byteDigest,httpMetadata:{contentType:identity.contentType}});
  const stored=await target.bucket.get(identity.key);assert.ok(stored);assert.equal(stored.size,identity.size);assert.equal(await crypto.sha256(new Uint8Array(await stored.arrayBuffer())),identity.byteDigest);bytesCopied+=identity.size;
 }return bytesCopied;
}
async function restore(runtime,mode,input,schema){
 await runtime.call({method:'set-clock',nowMs:input.inventory.createdMs});
 const start=await runtime.call({method:'recovery-start',mode,input,schema});assert.equal(start.kind,'started',JSON.stringify(start));
 let progress,steps=0;
 for(let n=0;n<=start.units;n++){
  progress=await runtime.call({method:'recovery-step',mode,input,schema});if(progress.kind==='imported')break;
  assert.ok(['progress','replayed'].includes(progress.kind),JSON.stringify(progress));steps++;
  const m=runtime.lastMeasurements;if(m)assert.ok(m.sqlStatements+m.objectReads+m.objectWrites<=1000,'recovery step exceeds the local combined operation budget');
 }
 assert.equal(progress.kind,'imported');assert.equal(steps,start.units);
 const finished=await runtime.call({method:'recovery-finish',mode,input,schema});assert.equal(finished.kind,'restored',JSON.stringify(finished));assert.equal(finished.report.financialExecution,false);assert.equal(finished.report.chainStatus,'unproven');
 const m=runtime.lastMeasurements;if(m)assert.ok(m.sqlStatements+m.objectReads+m.objectWrites<=1000,'recovery reconciliation exceeds the local combined operation budget');
 return {steps,report:finished.report};
}

/** Recover the ACTUAL B20 runtime. This helper never substitutes a golden fixture
 * or seeds missing ledger rows. The caller supplies the already running runtime,
 * its signed-message account and a captured live job lease. */
export async function rehearseIntegratedRecovery({source,createFreshRuntime,schema,sourceCommit,pinDirectory,account,principal,lease,sourceCookie}){
 assert.ok(isAbsolute(pinDirectory),'pinDirectory must be an explicit absolute local path');assert.match(sourceCommit,/^[a-f0-9]{40}$/);
 assert.equal(principal?.kind,'operator');assert.ok(account?.wallet&&account.privateKey);assert.ok(lease?.jobId&&lease.token,'pass an actual acquired job lease');
 const began=performance.now(),crypto=createNodeCrypto(),codec=createManifestCodec({crypto}),targets=[];
 await mkdir(resolve(pinDirectory),{recursive:true});const retained=await mkdtemp(join(resolve(pinDirectory),'integrated-recovery-'));
 try{
  await capabilities(source);
  const cookie=sourceCookie??await authenticate(source,account),sourceMe=await source.mf.dispatchFetch(source.origin+'/api/v1/me',{headers:{cookie,accept:mediaType}});
  assert.equal(sourceMe.status,200,'the session being revoked must be valid in the source runtime');assert.equal((await sourceMe.json()).data.wallet,account.wallet);
  const captures={};
  for(const mode of ['public','private']){
   const result=await source.call({method:'recovery-capture',mode,schema,sourceCommit});assert.equal(result.kind,'captured',JSON.stringify(result));
   captures[mode]=source.lastMeasurements??null;if(captures[mode])assert.ok(operationCount(captures[mode])<=1000,'recovery capture exceeds local combined operation budget');
   await verifyPinnedInventory(result.inventory,result.digest,crypto);
   await writeFile(join(retained,mode+'.inventory.json'),utf8(canonicalJson(result.inventory)),{flag:'wx'});
   await writeFile(join(retained,mode+'.sha256'),result.digest+'\n',{flag:'wx'});
  }
  // Subsequent recovery reads the separately retained files, not mutable live
  // database pointers or freshly computed hashes of allegedly recovered bytes.
  const load=async mode=>({inventory:JSON.parse(await readFile(join(retained,mode+'.inventory.json'),'utf8')),pinnedDigest:(await readFile(join(retained,mode+'.sha256'),'utf8')).trim()});
  const publicInput=await load('public'),privateInput=await load('private');assert.ok(publicInput.inventory.publications.length,'actual B20 work must have published at least one bundle');
  const publicBaseline=await verifyPublicHttp(source,publicInput.inventory.publications,codec),privateBaseline=await pinnedRows(privateInput.inventory,bucketReader(source.bucket),crypto);
  const allocations=objectsOf(privateBaseline,'earn_allocations'),awards=objectsOf(privateBaseline,'earn_awards'),jobs=objectsOf(privateBaseline,'app_jobs');assert.ok(allocations.length,'actual B20 allocations required');assertConservation(allocations,awards);
  const running=jobs.find(j=>j.id===lease.jobId);assert.ok(running);assert.equal(running.state,'running');assert.equal(running.lease_token,lease.token);assert.equal(String(running.revision),lease.revision);assert.equal(running.principal,principal.id);
  const pending=jobs.filter(j=>['queued','retry','held','running'].includes(j.state));assert.ok(pending.length,'pending work must be present in the real captured runtime');
  const futureNowMs=Math.max(...allocations.map(a=>a.vests_through_ms))+10*365*86400000;

  const publicTarget=await createFreshRuntime({mode:'public'});targets.push(publicTarget);await capabilities(publicTarget);
  const publicBytes=await copyPinnedObjects(source,publicTarget,publicInput.inventory,crypto),publicRestored=await restore(publicTarget,'public',publicInput,schema);
  const publicAfter=await verifyPublicHttp(publicTarget,publicInput.inventory.publications,codec);assert.deepEqual([...publicAfter.allocations], [...publicBaseline.allocations]);
  assert.equal(await publicTarget.db.prepare('SELECT COUNT(*) n FROM earn_submissions').first('n'),0);assert.equal(await publicTarget.db.prepare('SELECT COUNT(*) n FROM sessions').first('n'),0);
  await assert.rejects(()=>publicTarget.db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').bind('synthetic-forbidden-recovery-write',0,'1000000').run(),/mutation-disabled|read-only/);
  const publicAwards=[...publicBaseline.allocations.values()].flatMap(a=>a.awards.map(w=>({wallet:w.wallet,tokenId:a.tokenId,day:a.day,awardUnits:w.amountUnits,vestsFromMs:a.vestsFromMs,vestsThroughMs:a.vestsThroughMs,vestedUnits:w.amountUnits})));
  for(const wallet of new Set([...publicAwards.map(a=>a.wallet),account.wallet])){
   const actual=[];let after=0;
   for(let page=0;page<100;page++){const result=await publicTarget.call({method:'recovery-claims',query:{wallet,nowMs:futureNowMs,after}});assert.equal(result.executionEnabled,false);actual.push(...result.items);if(result.nextCursor===null)break;assert.ok(result.nextCursor>after);after=result.nextCursor;if(page===99)assert.fail('claim pagination did not terminate');}
   assert.deepEqual(sortClaims(actual),sortClaims(publicAwards.filter(a=>a.wallet===wallet).map(({wallet,...row})=>row)));
  }
  for(const a of publicBaseline.allocations.values())for(const award of a.awards){const proof=await codec.proof(a,award.wallet);assert.ok(proof);assert.equal(await codec.verifyProof(proof,a.awardRoot),true);}

  const privateTarget=await createFreshRuntime({mode:'private'});targets.push(privateTarget);await capabilities(privateTarget);
  const privateBytes=await copyPinnedObjects(source,privateTarget,privateInput.inventory,crypto),privateRestored=await restore(privateTarget,'private',privateInput,schema);
  const state=await privateTarget.db.prepare('SELECT * FROM app_recovery_state WHERE id=1').first();assert.equal(state.status,'ready');assert.equal(state.write_nonce,null);
  const compared={};
  for(const name of comparedTables){const baseline=privateBaseline.get(name),expected=baseline.rows.map(row=>objectRow(baseline.table,fenceRow(baseline.table,row,{generation:state.generation,createdMs:privateInput.inventory.createdMs}))),actual=await rows(privateTarget,name);
   assert.deepEqual(sorted(actual),sorted(expected),'private recovered '+name+' must retain its captured economic/receipt/checkpoint identity');compared[name]=actual.length;
  }
  assertConservation(await rows(privateTarget,'earn_allocations'),await rows(privateTarget,'earn_awards'));await verifyPublicHttp(privateTarget,privateInput.inventory.publications,codec);
  for(const table of ['sessions','auth_challenges','edge_proof_consumptions'])assert.equal(await privateTarget.db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),0);
  const oldCookie=await privateTarget.mf.dispatchFetch(privateTarget.origin+'/api/v1/me',{headers:{cookie}});assert.equal(oldCookie.status,401);
  // Also use the original session origin against the fresh Worker, so a changed
  // loopback port cannot be the only reason the old session is rejected.
  const matchedOriginCookie=await privateTarget.mf.dispatchFetch(source.origin+'/api/v1/me',{headers:{cookie}});assert.equal(matchedOriginCookie.status,401);
  const stale=await privateTarget.call({method:'recovery-stale-finish',principal,lease});assert.equal(stale.kind,'conflict');
  await authenticate(privateTarget,account);await capabilities(privateTarget);
  assert.equal((await source.mf.dispatchFetch(source.origin+'/api/v1/me',{headers:{cookie}})).status,200,'source session is unchanged');
  assert.equal(await source.db.prepare('SELECT state FROM app_jobs WHERE id=?').bind(lease.jobId).first('state'),'running','source lease/state is unchanged');

  const report={mode:'synthetic-integrated-recovery',sourceCommit,pinDirectory:retained,sourceRuntime:'workerd-local',sourcePreserved:true,
   public:{...publicRestored,bytesCopied:publicBytes,retainedBundles:publicInput.inventory.publications.length,allocations:publicBaseline.allocations.size,yearsLaterClaimsPreserved:true,mutationsDisabled:true},
   private:{...privateRestored,bytesCopied:privateBytes,comparedTables:compared,pendingJobs:pending.length,oldSessionRejected:true,oldLeaseRejected:true,newSessionAuthenticated:true},
   measurements:{captures,public:measured(publicTarget),private:measured(privateTarget),elapsedMs:Math.round(performance.now()-began)},
   financialExecution:false,chainStatus:'unproven'};
  await writeFile(join(retained,'report.json'),canonicalJson(report)+'\n',{flag:'wx'});return report;
 }finally{await Promise.all(targets.map(runtime=>runtime.close()));}
}
