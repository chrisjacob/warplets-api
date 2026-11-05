import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {prepareArtifact,verifiedBytes} from '../../artifacts/identity.mjs';
import {quoteProvenanceFixture} from '../../application/fixtures/quote-provenance.mjs';
import {quoteTestDispatch,QUOTE_TEST_PRINCIPAL} from '../../quotes/guarded-test-harness.mjs';
import {quoteCommandBytes} from '../../quotes/repository.mjs';
import {createApp} from '../../server/application.mjs';
import {mediaType} from '../../contracts/transport.mjs';
import {createManifestCodec} from '../../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from '../../recovery/node-schema.mjs';
import {createRecoveryExporter} from '../../recovery/export.mjs';
import {createPrivateRecovery} from '../../recovery/restore.mjs';

const crypto=createNodeCrypto(),now=Date.UTC(2026,10,5,12),hash=value=>crypto.sha256(utf8(canonicalJson(value)));
function memoryStore(){const objects=new Map();return {objects,async putIfAbsent(identity,input){const {bytes}=await prepareArtifact(identity,input),exists=objects.has(identity.key);if(!exists)objects.set(identity.key,bytes);
 const read=await verifiedBytes(identity,objects.get(identity.key));assert.equal(read.status,'verified');return {status:exists?'exists':'created',identity};},async getVerified(identity){return objects.has(identity.key)?verifiedBytes(identity,objects.get(identity.key)):{status:'missing',identity};}};}
function recordsFor(base){
 const changed=(id,index,slot=base.contextSlot,mutate=()=>{})=>{const c=structuredClone(base),at=now+index,block=slot===base.contextSlot?now:at;
  Object.assign(c,{observedMs:at,contextSlot:slot,blockTimeMs:block,retrievedAtMs:at});
  for(const a of Object.values(c.accounts))Object.assign(a,{contextSlot:slot,blockTimeMs:block,retrievedAtMs:at});
  Object.assign(c.oracle,{publicationMs:at,publicationSlot:slot,retrievedAtMs:at});mutate(c);return {id,capture:c};};
 const poolChange=c=>{const bytes=Uint8Array.from(atob(c.accounts.pool.data),x=>x.charCodeAt(0));bytes[360]^=1;c.accounts.pool.data=btoa(String.fromCharCode(...bytes));};
 return [changed('good',0),changed('oracle-bad',1,base.contextSlot,c=>c.oracle.feed='synthetic-unapproved-feed'),changed('same-slot-good',2),
  changed('same-slot-conflict',3,base.contextSlot,poolChange),changed('same-slot-sticky',4),changed('regressed',5,'12344'),changed('higher-good',6,'12346'),
  changed('stale-oracle',7,'12347',c=>c.oracle.publicationMs=now-30000),changed('missing-fx',8,'12348',c=>c.oracle=null),changed('final-good',9,'12349'),
  changed('empty-vault',10,'12350',c=>{const b=Uint8Array.from(atob(c.accounts.attVault.data),x=>x.charCodeAt(0));new DataView(b.buffer).setBigUint64(64,1n,true);c.accounts.attVault.data=btoa(String.fromCharCode(...b));})];
}

test('actual B04 receipts drive identical Node/D1 quotes, newest-invalid masking, sticky finalized slots, replay and async fences',async t=>{
 const node=openDatabase(),store=memoryStore();t.after(()=>node.close());const edge=await localRuntime(t,new URL('./fixtures/quote-provenance-worker.ts',import.meta.url));
 const bucket=await edge.mf.getR2Bucket('MANIFESTS');
 node.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(QUOTE_TEST_PRINCIPAL.id,'evidence-ingest');await edge.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(QUOTE_TEST_PRINCIPAL.id,'evidence-ingest').run();
 let retainedRecords;const f=await quoteProvenanceFixture({crypto,now,captures:base=>(retainedRecords=recordsFor(base))});f.seed(node);
 for(const table of ['market_fixtures','vault_manifests'])for(const row of node.prepare('SELECT * FROM '+table).all()){
  const keys=Object.keys(row);await edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();
 }
 const records=[];for(const r of retainedRecords){const {byteDigest,...entry}=await f.reader.read(r.id);records.push({...entry,bytes:[...entry.bytes]});}
 const fixture={source:f.source,records},log=[];
 const nodeApp=createApp(node,{clock:()=>now+20,artifactStore:store});
 const publicBoth=async(body,{origin='http://localhost',method='POST',path='/api/v1/quotes'}={})=>{
  const init={method,headers:{origin,'content-type':'application/json',accept:mediaType},...(method==='POST'?{body:JSON.stringify(body)}:{})};
  const a=await nodeApp(new Request('http://localhost'+path,init)),b=await edge.mf.dispatchFetch('http://localhost'+path,init);
  assert.equal(a.status,b.status);assert.equal(a.headers.get('cache-control'),'no-store');assert.equal(b.headers.get('cache-control'),'no-store');
  const ar=await a.json(),br=await b.json();if(ar.error)assert.equal(ar.error.code,br.error.code);else{assert.deepEqual(ar.data,br.data);
   if(path==='/api/v1/quotes'){assert.equal(ar.meta.sourceSlot,ar.data.contextSlot);assert.equal(br.meta.sourceSlot,br.data.contextSlot);assert.equal(ar.meta.asOf,ar.data.quotedAt);assert.equal(br.meta.asOf,br.data.quotedAt);}}
  return {status:a.status,body:ar};
 };
 const nodeCall=request=>quoteTestDispatch({driver:createNodeAtomicDriver(node),store,crypto,ids:{next:randomUUID},fixture,request});
 const edgeCall=async request=>{const response=await edge.mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify({fixture,request})});assert.equal(response.status,200);return response.json();};
 const both=async(method,fields={})=>{const request={method,marketId:f.marketId,nowMs:now+20,...fields},a=await nodeCall(request),b=await edgeCall(request);
  assert.equal(b.status,a.status,method+': '+JSON.stringify([a,b]));if(a.result.error&&a.status!==500)assert.equal(b.result.error.code,a.result.error.code);else if(!a.result.error&&(method==='quote'||method==='availability'))assert.deepEqual(b.result,a.result);
  for(const result of [a,b])assert.ok(result.measurement.sqlStatements+result.measurement.objectReads+result.measurement.objectWrites<1000);
  log.push({method,sql:b.measurement.sqlStatements,reads:b.measurement.objectReads,writes:b.measurement.objectWrites});return [a,b];};
 const success=(results,kind)=>results.forEach(r=>{assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.result.kind,kind,JSON.stringify(r));});
 success(await both('register'),'committed');success(await both('bind',{input:f.bind}),'committed');success(await both('bind',{input:f.bind}),'replayed');
 const req={marketId:f.marketId,direction:'buy-att',inputUnits:'1000000',slippageBps:50};let head=null;const receipts=new Map();
 const ingest=async id=>{const result=await both('ingest',{input:f.request(id,head)});success(result,'committed');assert.equal(result[0].result.value.receiptDigest,result[1].result.value.receiptDigest);head=result[0].result.value.receiptDigest;receipts.set(id,head);return result;};
 const materialize=async(expectedStatus,expectedReason)=>{const result=await both('materialize');success(result,'committed');for(const r of result){assert.equal(r.result.value.status,expectedStatus,JSON.stringify(r));if(expectedReason)assert.equal(r.result.value.reason,expectedReason);}return result;};
 await ingest('good');assert.equal((await both('availability'))[0].result.available,false);
 // Inspect a real service-prepared command, then prove the repository rejects
 // forged derived amounts even after the malicious command is rehashed.
 const commands=await both('materialize-command');success(commands,'command');
 for(const [index,call] of [nodeCall,edgeCall].entries()){
  const command=structuredClone(commands[index].result.command),body=JSON.parse(command.input.bodyJson);body.data.ogUsdMicros='1';command.input.bodyJson=canonicalJson(body);command.requestDigest=await crypto.sha256(quoteCommandBytes(command));
  const forged=await call({method:'record-command',command,nowMs:now+20});assert.equal(forged.status,500);assert.match(forged.result.error.message,/quote-derived-input-mismatch/);
 }
 const beforeNode=node.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,beforeEdge=await edge.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n');
 const omitted=await both('materialize',{fault:'omit-input'});assert.equal(omitted[0].status,500);assert.equal(omitted[1].status,500);
 assert.equal(node.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,beforeNode);assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),beforeEdge);
 assert.equal(node.prepare('SELECT COUNT(*) n FROM app_quote_inputs').get().n,0);assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM app_quote_inputs').first('n'),0);
 const committed=await both('materialize',{fault:'lose-response'});success(committed,'replayed');assert.ok(committed.every(r=>r.faultInjected));
 const first=(await both('quote',{input:req}))[0];assert.equal(first.status,200);assert.equal(first.result.evidence.receiptDigest,head);assert.equal(first.result.executable,false);assert.equal(first.result.fees.networkLamports,null);
 const http=await publicBoth(req);assert.equal(http.status,200);assert.deepEqual(http.body.data,first.result);
 assert.equal((await publicBoth({...req,wallet:'spoof'})).status,400);assert.equal((await publicBoth(req,{origin:'https://elsewhere.invalid'})).status,403);
 assert.equal((await publicBoth(undefined,{method:'GET',path:'/api/v1/markets/'+f.marketId+'/quote-status'})).body.data.available,true);
 await both('quote',{input:{...req,direction:'sell-att',inputUnits:'1000000000000'}});
 const replay=await both('materialize');success(replay,'replayed');assert.equal(replay[0].result.value.inputDigest,committed[0].result.value.inputDigest);
 await ingest('oracle-bad');assert.equal((await both('availability'))[0].result.available,false);assert.equal((await both('quote',{input:req}))[0].result.error.code,'evidence_pending');assert.equal((await publicBoth(req)).status,503);await materialize('invalid','oracle_mismatch');
 await ingest('same-slot-good');await materialize('verified');assert.equal((await both('quote',{input:req}))[0].status,200);
 await ingest('same-slot-conflict');await materialize('invalid','finalized_slot_conflict');assert.equal((await both('availability'))[0].result.reason,'finalized_slot_conflict');
 await ingest('same-slot-sticky');await materialize('invalid','finalized_slot_conflict');
 await ingest('regressed');await materialize('invalid','slot_regression');
 await ingest('higher-good');await materialize('verified');assert.equal((await both('quote',{input:req}))[0].status,200);
 await ingest('stale-oracle');await materialize('invalid','stale_quote_source');
 await ingest('missing-fx');await materialize('invalid','invalid_capture');
 await ingest('final-good');await materialize('verified');assert.equal((await both('quote',{input:req}))[0].status,200);
 // A retained pointer cannot turn missing R2 evidence into a valid quote.
 const current=node.prepare('SELECT envelope_json FROM app_evidence_receipts WHERE receipt_digest=?').get(head),identity=JSON.parse(current.envelope_json),saved=store.objects.get(identity.objectRef),object=await bucket.get(identity.objectRef),edgeBytes=await object.arrayBuffer();
 store.objects.delete(identity.objectRef);await bucket.delete(identity.objectRef);assert.equal((await both('quote',{input:req}))[0].result.error.code,'evidence_unavailable');
 store.objects.set(identity.objectRef,saved);await bucket.put(identity.objectRef,edgeBytes,{sha256:identity.byteDigest,httpMetadata:{contentType:'application/json'}});assert.equal((await both('quote',{input:req}))[0].status,200);
 const corrupt=new Uint8Array(saved);corrupt[0]^=1;store.objects.set(identity.objectRef,corrupt);await bucket.put(identity.objectRef,corrupt,{httpMetadata:{contentType:'application/json'}});
 assert.equal((await both('quote',{input:req}))[0].result.error.code,'evidence_unavailable');assert.equal((await publicBoth(req)).status,503);
 store.objects.set(identity.objectRef,saved);await bucket.put(identity.objectRef,edgeBytes,{sha256:identity.byteDigest,httpMetadata:{contentType:'application/json'}});assert.equal((await publicBoth(req)).status,200);
 const expired=await both('quote',{input:req,fault:'expire-during-hash'});assert.ok(expired.every(r=>r.faultInjected));assert.equal(expired[0].result.error.code,'quote_expired');
 const streamKey=canonicalJson([f.source.sourceId,'quote-market',f.marketId,null]);
 const changed=await both('quote',{input:req,fault:'change-head',nextReceipt:receipts.get('oracle-bad'),streamKey});assert.ok(changed.every(r=>r.faultInjected));assert.equal(changed[0].result.error.code,'oracle_mismatch');
 // Restore the unchanged original selected receipt after the injected race.
 node.prepare('UPDATE app_evidence_heads SET receipt_digest=? WHERE stream_key=?').run(head,streamKey);await edge.db.prepare('UPDATE app_evidence_heads SET receipt_digest=? WHERE stream_key=?').bind(head,streamKey).run();
 await ingest('empty-vault');await materialize('verified');assert.equal((await both('quote',{input:req}))[0].result.error.code,'insufficient_vault');
 success(await both('materialize',{nowMs:now+86400000}),'replayed');
 const oldReplay=await both('ingest',{input:f.request('good',null),nowMs:now+86400000});success(oldReplay,'replayed');assert.equal(oldReplay[0].result.value.receiptDigest,receipts.get('good'));
 for(const table of ['tx_intents','tx_attempts']){assert.equal(node.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),0);}
 assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM app_quote_inputs').first('n'),retainedRecords.length);
 assert.throws(()=>node.prepare('UPDATE app_quote_account_slots SET byte_digest=? WHERE market_id=?').run('0'.repeat(64),f.marketId),/Retain finalized account slot history/);
 await assert.rejects(()=>edge.db.prepare('UPDATE app_quote_account_slots SET byte_digest=? WHERE market_id=?').bind('0'.repeat(64),f.marketId).run(),/Retain finalized account slot history/);
 // Nonempty migration033 data must survive the same private-recovery importer,
 // including sticky conflicts, actual B04 receipts and all raw quote objects.
 const schema=await readInstalledRecoverySchema(crypto),codec=createManifestCodec({crypto}),ports={crypto,codec,schema,clock:{nowMs:()=>now+20},ids:{next:randomUUID}};
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'}).trim();
 const snapshot=await createRecoveryExporter({...ports,driver:createNodeAtomicDriver(node),artifacts:store,sourceCommit}).capturePrivate();assert.equal(snapshot.kind,'captured',JSON.stringify(snapshot));
 const restoredDb=openDatabase(),restoredStore=memoryStore();t.after(()=>restoredDb.close());
 for(const identity of snapshot.inventory.objects)await restoredStore.putIfAbsent(identity,store.objects.get(identity.key));
 const recovered=await createPrivateRecovery({...ports,driver:createNodeAtomicDriver(restoredDb),artifacts:restoredStore}).restore({inventory:snapshot.inventory,pinnedDigest:snapshot.digest});assert.equal(recovered.kind,'restored',JSON.stringify(recovered));
 const recoveredCounts={};for(const table of ['app_quote_bindings','app_quote_heads','app_quote_inputs','app_quote_account_slots']){
  const original=node.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),restored=restoredDb.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
  assert.ok(original.length>0);assert.equal(canonicalJson(restored),canonicalJson(original));recoveredCounts[table]=original.length;
 }
 const restoredQuote=await quoteTestDispatch({driver:createNodeAtomicDriver(restoredDb),store:restoredStore,crypto,ids:{next:randomUUID},fixture,request:{method:'quote',input:req,nowMs:now+20}});assert.equal(restoredQuote.result.error.code,'insufficient_vault');
 // An isolated/held target cannot mutate newly added quote tables either.
 await edge.db.prepare("UPDATE app_recovery_state SET status='held' WHERE id=1").run();
 for(const [table,column] of [['app_quote_bindings','created_ms'],['app_quote_heads','binding_digest'],['app_quote_inputs','created_ms'],['app_quote_account_slots','byte_digest']])
  await assert.rejects(()=>edge.db.prepare('UPDATE '+table+' SET '+column+'='+column).run(),/mutation-disabled/);
 console.log('B14 real quote receipt parity '+JSON.stringify({records:retainedRecords.length,quoteCalls:log.filter(x=>x.method==='quote').length,maxSql:Math.max(...log.map(x=>x.sql)),maxCombined:Math.max(...log.map(x=>x.sql+x.reads+x.writes)),recoveredCounts,recoveryTables:snapshot.inventory.tables.length,recoveryObjects:snapshot.inventory.objects.length,financialExecution:false,providerAttempts:f.reader.counters().providerAttempts}));
});
