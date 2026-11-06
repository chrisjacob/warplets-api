import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createCollectionStateCodec} from '../collect/state-codec.mjs';
import {createInventory,publishStage} from '../domain/collections/inventory.mjs';
import {encode58} from '../server/base58.mjs';
import {createOperatorSessionAuthority} from './session.mjs';
import {createOperatorUploadTransport} from './upload-transport.mjs';
import {createOperatorCommandTransport} from './command-transport.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
const SOURCE='collection.stage-record.v1',CUT='collection.stage-cut-record.v1',origin='http://127.0.0.1:4174',boot='synthetic-upload-bootstrap-code-longer-than-32',wallet=encode58(new Uint8Array(32).fill(127));
const counts=db=>['app_collection_records','app_collection_cut_records','app_command_receipts','ops_config_audit'].map(n=>db.prepare('SELECT COUNT(*) n FROM '+n).get().n);
async function fixture(t,{kind=SOURCE,crypto=createNodeCrypto(),sessionClock,allowedKinds=[SOURCE,CUT],wrap=db=>db}={}){
 const db=openDatabase();t.after(()=>db.close());db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-upload-operator',kind===SOURCE?'collection-import':'collection-evidence');
 const clock=()=>Date.now(),sessions=createOperatorSessionAuthority({bootCode:boot,operatorId:'synthetic-upload-operator',allowedKinds,clock:sessionClock?()=>sessionClock(db):clock}),login=sessions.login(boot),handler=createOperatorUploadTransport(wrap(db),{sessions,clock,crypto});
 const raw=kind===SOURCE?{format:'collection-page-v1',kind:'eligibility',index:0,entries:[wallet]}:{format:'collection-cut-page-v1',index:0,holdings:[{id:'synthetic-private-asset',owner:wallet,collection:'solana-genesis',level:1,revealedAt:0}]},bytes=utf8(canonicalJson(raw)),metadata={operationKind:kind,requestKey:'synthetic-upload',id:await createNodeCrypto().sha256(bytes),size:bytes.length,expectedRevisions:Object.fromEntries(db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)]))};
 const request=(path,{meta=metadata,body=path==='receipt'?undefined:bytes,headers={},url=origin+'/ops/uploads/'+path,method='POST'}={})=>new Request(url,{method,headers:{origin,'content-type':'application/octet-stream',authorization:'Bearer '+login.sessionToken,'x-operator-upload':JSON.stringify(meta),...headers},...(body===undefined?{}:{body,...(body instanceof ReadableStream?{duplex:'half'}:{})})});
 return {db,sessions,login,handler,request,bytes,metadata,crypto,clock};
}
const preview=async f=>{const r=await f.handler(f.request('preview'));assert.equal(r.status,200,await r.clone().text());return r.json();};

test('both private record kinds preview without writes, confirm exact bytes, and recover safe original receipts',async t=>{
 for(const kind of [SOURCE,CUT]){const f=await fixture(t,{kind}),before=counts(f.db),p=await preview(f);assert.deepEqual(counts(f.db),before);assert.deepEqual(Object.keys(p).sort(),['operationKind','requestKey','requestDigest','confirmationDigest','expectedRevisions','financialExecution','summary'].sort());assert.deepEqual(p.summary,{id:f.metadata.id,size:f.bytes.length,format:kind===SOURCE?'collection-page-v1':'collection-cut-page-v1',privateStaging:true,financialExecution:false});
  assert.equal((await f.handler(f.request('execute'))).status,409);const headers={'x-operator-preview':p.confirmationDigest},acceptedResponse=await f.handler(f.request('execute',{headers}));assert.equal(acceptedResponse.status,200,await acceptedResponse.clone().text());const accepted=await acceptedResponse.json();assert.equal(accepted.kind,'committed');assert.equal(accepted.projection,'safe-upload-summary-v1');
  const replay=await(await f.handler(f.request('execute',{headers}))).json(),receipt=await(await f.handler(f.request('receipt'))).json();assert.equal(replay.kind,'replayed');assert.deepEqual(receipt,replay);assert.deepEqual(receipt.receipt,accepted.receipt);assert.deepEqual(receipt.value,accepted.value);assert.equal(verifyConfigChain(f.db).events,1);
  for(const output of [p,accepted,replay,receipt]){const text=JSON.stringify(output);assert.equal(text.includes(wallet),false);for(const secret of ['bodyBase64','body_json','input_json','synthetic-private-asset','holdings','entries'])assert.equal(text.includes(secret),false);}
  assert.equal(acceptedResponse.headers.get('cache-control'),'no-store');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
 }
});

test('upload metadata, MIME, exact stream size, canonical encoding and hashes reject before mutation',async t=>{
 const f=await fixture(t);const cases=[
  [{meta:{...f.metadata,extra:true}},400],[{meta:{...f.metadata,operationKind:'collection.seal-list.v1'}},400],[{meta:{...f.metadata,size:0}},400],[{meta:{...f.metadata,size:131073}},413],[{meta:{...f.metadata,expectedRevisions:{source:'1'}}},400],
  [{headers:{'x-operator-upload':' '.repeat(2049)}},400],[{headers:{'x-operator-upload':'{"label":"é"}'}},400],[{headers:{'content-type':'application/json'}},415],[{headers:{'content-length':String(f.bytes.length+1)}},400],
  [{body:f.bytes.slice(1)},400],[{body:new Uint8Array(f.bytes.length+1)},413],[{meta:{...f.metadata,id:'0'.repeat(64)}},400],
 ];for(const [args,status]of cases){const r=await f.handler(f.request('preview',args));assert.equal(r.status,status,JSON.stringify(args.meta??args.headers));assert.equal((await r.text()).includes(wallet),false);}
 const noncanonical=utf8(JSON.stringify({format:'collection-page-v1',kind:'eligibility',index:0,entries:[wallet]})),m={...f.metadata,id:await f.crypto.sha256(noncanonical),size:noncanonical.length};assert.equal((await f.handler(f.request('preview',{meta:m,body:noncanonical}))).status,400);
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(f.bytes.slice(0,10));c.enqueue(new Uint8Array(f.bytes.length));},cancel(){cancelled=true;}});assert.equal((await f.handler(f.request('preview',{body:stream}))).status,413);assert.equal(cancelled,true);assert.deepEqual(counts(f.db),[0,0,0,0]);
 const cut=await fixture(t,{kind:CUT});assert.equal((await cut.handler(cut.request('preview',{meta:{...cut.metadata,size:65537}}))).status,413);
});

test('confirmation binds key, revisions and identity; accepted execute still validates uploaded bytes',async t=>{
 const f=await fixture(t),p=await preview(f),headers={'x-operator-preview':p.confirmationDigest};
 for(const meta of [{...f.metadata,requestKey:'other'},{...f.metadata,expectedRevisions:{...f.metadata.expectedRevisions,control:String(Number(f.metadata.expectedRevisions.control)+1)}}])assert.equal((await f.handler(f.request('execute',{meta,headers}))).status,409);
 const other=utf8(canonicalJson({format:'collection-page-v1',kind:'eligibility',index:1,entries:[wallet]})),meta={...f.metadata,id:await f.crypto.sha256(other),size:other.length};assert.equal((await f.handler(f.request('execute',{meta,body:other,headers}))).status,409);
 assert.equal((await f.handler(f.request('execute',{headers}))).status,200);assert.equal((await f.handler(f.request('execute',{headers,body:new Uint8Array(f.bytes.length)}))).status,400);assert.equal(verifyConfigChain(f.db).events,1);
 const standard=createOperatorCommandTransport(f.db,{sessions:f.sessions});const response=await standard(new Request(origin+'/ops/commands/preview',{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer '+f.login.sessionToken},body:JSON.stringify({operationKind:SOURCE,requestKey:f.metadata.requestKey,input:{id:f.metadata.id},expectedRevisions:f.metadata.expectedRevisions})}));assert.equal(response.status,400);
});

test('upload and receipt routes require loopback origin, live original principal and allowed command kind',async t=>{
 const f=await fixture(t);for(const path of ['preview','receipt']){
  assert.equal((await f.handler(f.request(path,{headers:{origin:'https://elsewhere.example'}}))).status,403);assert.equal((await f.handler(f.request(path,{url:'http://example.com/ops/uploads/'+path}))).status,403);assert.equal((await f.handler(f.request(path,{headers:{authorization:'Bearer member'}}))).status,401);
 }
 assert.equal((await f.handler(f.request('preview',{method:'GET',body:null}))).status,405);
 const denied=await fixture(t,{allowedKinds:[CUT]});assert.equal((await denied.handler(denied.request('preview'))).status,403);
 const p=await preview(f);assert.equal((await f.handler(f.request('execute',{headers:{'x-operator-preview':p.confirmationDigest}}))).status,200);f.sessions.revoke();assert.equal((await f.handler(f.request('receipt'))).status,401);
 const other=createOperatorSessionAuthority({bootCode:boot,operatorId:'synthetic-other',allowedKinds:[SOURCE]}),token=other.login(boot).sessionToken,handler=createOperatorUploadTransport(f.db,{sessions:other});assert.equal((await handler(f.request('receipt',{headers:{authorization:'Bearer '+token}}))).status,404);
 const forbidden=createOperatorSessionAuthority({bootCode:boot,operatorId:'synthetic-upload-operator',allowedKinds:[CUT]}),restricted=forbidden.login(boot).sessionToken;assert.equal((await createOperatorUploadTransport(f.db,{sessions:forbidden})(f.request('receipt',{headers:{authorization:'Bearer '+restricted}}))).status,403);
});

test('revocation across asynchronous hashing and expiry immediately before commit abort all effects',async t=>{
 let current;const real=createNodeCrypto(),f=await fixture(t,{crypto:{...real,async sha256(b){current?.revoke();return real.sha256(b);}}});current=f.sessions;assert.equal((await f.handler(f.request('preview'))).status,401);assert.deepEqual(counts(f.db),[0,0,0,0]);
 const now=Date.now(),g=await fixture(t,{sessionClock:db=>now+(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n?7200000:0)}),p=await preview(g),response=await g.handler(g.request('execute',{headers:{'x-operator-preview':p.confirmationDigest}}));assert.equal(response.status,401);assert.deepEqual(counts(g.db),[0,0,0,0]);
 let mutate=false,target;const h=await fixture(t,{crypto:{...real,async sha256(b){const result=await real.sha256(b);if(mutate){mutate=false;target.exec('UPDATE app_operator_scopes SET enabled=0,revision=revision+1');}return result;}}});target=h.db;const hp=await preview(h);mutate=true;assert.equal((await h.handler(h.request('execute',{headers:{'x-operator-preview':hp.confirmationDigest}}))).status,409);assert.deepEqual(counts(h.db),[0,0,0,0]);
});

test('lost acknowledgement resolves one receipt; fresh session can retrieve it after business grant revocation',async t=>{
 let lost=false;const f=await fixture(t,{wrap:db=>({get isTransaction(){return db.isTransaction;},prepare:sql=>db.prepare(sql),exec(sql){db.exec(sql);if(sql==='COMMIT'&&!lost&&db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n){lost=true;throw Error('Synthetic lost committed response');}}})}),p=await preview(f),headers={'x-operator-preview':p.confirmationDigest},accepted=await(await f.handler(f.request('execute',{headers}))).json();assert.equal(lost,true);assert.equal(accepted.kind,'replayed');
 f.db.exec('UPDATE app_operator_scopes SET enabled=0,revision=revision+1');f.sessions.revoke();const token=f.sessions.login(f.sessions.issueBootCode()).sessionToken,before=counts(f.db),receipt=await f.handler(f.request('receipt',{headers:{authorization:'Bearer '+token}}));assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),accepted);assert.deepEqual(counts(f.db),before);
 assert.equal((await f.handler(f.request('execute',{headers:{...headers,authorization:'Bearer '+token}}))).status,200);assert.deepEqual(counts(f.db),before);
});

test('metadata-only receipt recovery rejects wrong size and nonempty body; missing receipts do not execute',async t=>{
 const f=await fixture(t);assert.equal((await f.handler(f.request('receipt'))).status,404);assert.deepEqual(counts(f.db),[0,0,0,0]);const p=await preview(f);await f.handler(f.request('execute',{headers:{'x-operator-preview':p.confirmationDigest}}));const before=counts(f.db);
 const wrong=await f.handler(f.request('receipt',{meta:{...f.metadata,size:f.metadata.size+1}}));assert.equal(wrong.status,409);assert.equal((await wrong.json()).error.code,'upload_identity_conflict');assert.equal((await f.handler(f.request('receipt',{body:new Uint8Array([1])}))).status,400);assert.equal((await f.handler(f.request('receipt',{meta:{...f.metadata,requestKey:'missing'}}))).status,404);assert.deepEqual(counts(f.db),before);
});

test('maximum legal source record streams within 131072 bytes and returns only a bounded summary',async t=>{
 const f=await fixture(t),state=publishStage(createInventory({id:'synthetic-upload-capacity',kind:'genesis',tranche:1}),{id:'first',type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets:[wallet],walletLimit:1}),bundle=await createCollectionStateCodec({crypto:f.crypto}).encodeReferenceInventory(state),root=JSON.parse(new TextDecoder().decode(bundle.root.bytes));root.stages[0].terms.syntheticUnapprovedPadding='';root.stages[0].terms.syntheticUnapprovedPadding='x'.repeat(131072-utf8(canonicalJson(root)).length);const body=utf8(canonicalJson(root));assert.equal(body.length,131072);const meta={...f.metadata,id:await f.crypto.sha256(body),size:body.length};
 const streamed=()=>new ReadableStream({start(c){for(let n=0;n<body.length;n+=4096)c.enqueue(body.slice(n,n+4096));c.close();}}),r=await f.handler(f.request('preview',{meta,body:streamed()}));assert.equal(r.status,200,await r.clone().text());const p=await r.json(),done=await f.handler(f.request('execute',{meta,body:streamed(),headers:{'x-operator-preview':p.confirmationDigest}}));assert.equal(done.status,200,await done.clone().text());assert.ok((await done.text()).length<4096);assert.equal(f.db.prepare('SELECT size FROM app_collection_records').get().size,131072);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM collect_inventories').get().n,0);
});
