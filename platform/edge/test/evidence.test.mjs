import {decodeMintAccount} from '../../quotes/accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {evidenceFixture} from '../../evidence/fixtures.mjs';
import {streamKey} from '../../evidence/envelope.mjs';
import {decodeRecorded} from '../../evidence/decoders.mjs';
import {buildRequirementSpecs,selectRequirementReceipts,normalizeRequirementValue} from '../../evidence/requirements.mjs';
const crypto=createNodeCrypto();
test('workerd recorded decoder + D1/R2 immutable ingestion preserves retries, pending masks and all-or-none head',async t=>{
 const code=(await build({entryPoints:[fileURLToPath(new URL('./fixtures/evidence-worker.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',external:['node:*'],write:false,target:'es2022'})).outputFiles[0].text;
 const mf=new Miniflare({workers:[{config:{name:'evidence-fixture',type:'worker',compatibilityDate:'2026-08-25',compatibilityFlags:['nodejs_compat'],
  manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000026'},MANIFESTS:{type:'r2',name:'evidence-private'}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 const directory=new URL('../../storage/',import.meta.url);
 for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
  const statements=[];let current='';for(const line of readFileSync(new URL(name,directory),'utf8').replace(/^--.*$/gm,'').split(/\r?\n/)){
   current+=(current?'\n':'')+line;const value=current.trim();if(value.endsWith(';')&&(!value.startsWith('CREATE TRIGGER')||/\bEND;$/i.test(value))){statements.push(db.prepare(value));current='';}
  }if(current.trim())throw Error('Incomplete migration '+name);await db.batch(statements);
 }
 await db.prepare("INSERT INTO app_operator_scopes VALUES('fixture-reader','evidence-ingest',0,1)").run();
 const vector=JSON.parse(readFileSync(new URL('../../quotes/fixtures/sdk-vectors.json',import.meta.url))),now=100000,subject={kind:'mint',id:'fixture-mint'};
 const record=(id,payload)=>({id,subject,contextSlot:'10',blockTimeMs:now,retrievedAtMs:now,finality:'finalized',bytes:utf8(canonicalJson(payload))});
 const records=[record('good',{...vector.attMint,address:subject.id}),record('pending',null),record('competing',{...vector.attMint,address:subject.id})];
 const fixture=await evidenceFixture({crypto,subject,records}),body={source:fixture.source,records:records.map(r=>({...r,bytes:[...r.bytes]})),now,cutoff:now,supersedes:null};
 const call=async extra=>{const response=await mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify({...body,...extra})});return {status:response.status,...await response.json()};};
 assert.equal((await call({action:'register'})).result.kind,'committed');
 const missing=await call({action:'ingest',recordId:'good',fault:'skip-head'});assert.equal(missing.status,409);assert.match(missing.error,/Missing evidence receipt/);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_evidence_receipts').first('n'),0);
 const first=await call({action:'ingest',recordId:'good',fault:'lost-response'});assert.equal(first.result.kind,'replayed');assert.equal(first.result.value.decision.status,'verified');assert.equal(first.counters.providerAttempts,0);assert.deepEqual(first.result.value.decision.decoded,decodeMintAccount(vector.attMint));
 const concurrent=await Promise.all([call({action:'ingest',recordId:'good'}),call({action:'ingest',recordId:'good'})]);assert.ok(concurrent.every(r=>r.result.kind==='replayed'));
 const pending=await call({action:'ingest',recordId:'pending',supersedes:first.result.value.receiptDigest,now:now+1});assert.equal(pending.result.value.decision.status,'pending');
 const head=await call({action:'head',key:streamKey(first.result.value.envelope)});assert.equal(head.result.decision.status,'pending');
 const competing=await call({action:'ingest',recordId:'competing',supersedes:first.result.value.receiptDigest});assert.equal(competing.result.code,'evidence_head_changed');
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_evidence_receipts').first('n'),2);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_private_artifacts').first('n'),2);
 const r2=await mf.getR2Bucket('MANIFESTS');assert.equal((await r2.list({prefix:'private/'})).objects.length,2);
 const race=await Promise.all([call({action:'ingest',recordId:'good',supersedes:pending.result.value.receiptDigest,now:now+2}),call({action:'ingest',recordId:'competing',supersedes:pending.result.value.receiptDigest,now:now+2})]);
 assert.equal(race.filter(r=>r.result?.kind==='committed').length,1);assert.equal(race.filter(r=>r.result?.kind==='conflict').length,1);
 await assert.rejects(db.prepare("UPDATE app_evidence_receipts SET status='verified'").run(),/immutable/);
 const inputs=[],heads=[];
 for(const kind of ['campaign-registry','ownership','position-inventory','action-completions','position-history']){
  const subject={kind,id:kind==='campaign-registry'?'registry':'alice'},history=kind==='position-history';
  const payload=history?{network:'solana-local',wallet:'alice',tokenId:'ATT',enrolledAtMs:0,throughMs:now,complete:true,pages:[{cursor:null,nextCursor:null,events:[]}]}:
   {version:1,network:'solana-local',kind,subject,fromMs:0,toMs:now,complete:true,pages:[{cursor:null,nextCursor:null,items:[]}]};
  const policy=history?{wallet:'alice',tokenId:'ATT',farmProgram:'fixture-farm',swapProgram:'fixture-swap',enrolledAtMs:0}:{kind,fromMs:0};
  const decoderVersion=history?'synthetic-position-history-v2':'synthetic-cutoff-facts-v1';
  const f=await evidenceFixture({crypto,payload,subject,policy,decoderVersion,now});f.source.sourceId='fixture-'+kind;
  const r=await f.reader.read('first'),override={source:f.source,records:[{...r,bytes:[...r.bytes]}],recordId:'first',now,cutoff:now,supersedes:null};
  assert.equal((await call({...override,action:'register'})).result.kind,'committed');
  const ingested=await call({...override,action:'ingest'});assert.equal(ingested.result.kind,'committed');assert.equal(ingested.counters.providerAttempts,0);
  const receipt=ingested.result.value;assert.equal(receipt.decision.status,'verified');
  assert.deepEqual(receipt.decision,decodeRecorded(f.source,r,receipt.envelope));
  const input={authority:'evidence',kind,subject,cutoffMs:now,sourceId:f.source.sourceId,sourceRevision:f.source.sourceRevision,decoderVersion,
   value:normalizeRequirementValue(kind,decoderVersion,receipt.decision.decoded),coverage:{required:'interval',fromMs:0,toMs:now}};
  const [spec]=await buildRequirementSpecs([input],crypto);inputs.push(input);heads.push([spec.id,receipt]);
 }
 const specs=await buildRequirementSpecs(inputs,crypto),expected=await selectRequirementReceipts(specs,new Map(heads),crypto);
 assert.equal(expected.kind,'ready');
 const actual=await (await mf.dispatchFetch('http://localhost/select',{method:'POST',body:JSON.stringify({inputs,heads})})).json();
 assert.deepEqual(actual,expected,'WebCrypto selector and normalized receipt digests match Node');
});
