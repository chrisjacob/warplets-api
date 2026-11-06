import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {createCollectionStateCodec} from '../collect/state-codec.mjs';
import {dryRunWhitelist} from '../collect/whitelist-import.mjs';
import {createOperatorSessionAuthority} from './session.mjs';
import {createWhitelistDraftTransport} from './whitelist-draft-transport.mjs';
import {readOperatorBody} from './command-transport.mjs';
const KIND='collection.validate-whitelist.v1',origin='http://127.0.0.1:4174',boot='synthetic-whitelist-bootstrap-longer-than-32';
const wallet=n=>{const b=Buffer.alloc(32,127);b.writeUInt32BE(n,28);return encode58(b);};
function fixture(t,{crypto=createNodeCrypto(),allowedKinds=[KIND],grant=true}={}){
 const db=openDatabase();t.after(()=>db.close());if(grant)db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-draft-operator','collection-import');let now=Date.now();
 const sessions=createOperatorSessionAuthority({bootCode:boot,operatorId:'synthetic-draft-operator',allowedKinds,clock:()=>now}),login=sessions.login(boot),handler=createWhitelistDraftTransport(db,{sessions,clock:()=>now,crypto}),body={source:'synthetic-curated-community-invitation',inventoryId:'synthetic-next-inventory',stageId:'synthetic-next-stage',entries:[wallet(1)]};
 const request=(value=body,{headers={},url=origin+'/ops/drafts/whitelist',method='POST'}={})=>new Request(url,{method,headers:{origin,'content-type':'application/json',authorization:'Bearer '+login.sessionToken,...headers},...(method==='GET'?{}:{body:typeof value==='string'||value instanceof Uint8Array||value instanceof ReadableStream?value:JSON.stringify(value),...(value instanceof ReadableStream?{duplex:'half'}:{})})});
 return {db,sessions,handler,body,request,setNow:v=>{now=v;},getNow:()=>now};
}
const changes=db=>db.prepare('SELECT total_changes() n').get().n;
const exactFields=['operationKind','source','inventoryId','stageId','inputCount','acceptedCount','duplicateCount','errorCount','errors','errorsTruncated','digest','eligibilityListId','publishable','expectedRevisions','financialExecution','staged','isAuthorization'];

test('curated duplicates produce exact legacy digest and codec identity with no writes or wallet disclosure',async t=>{
 const f=fixture(t),body={...f.body,entries:[wallet(2),wallet(1),wallet(2),wallet(1)]},before=changes(f.db),response=await f.handler(f.request(body));assert.equal(response.status,200);const result=await response.json(),old=dryRunWhitelist(body),encoded=await createCollectionStateCodec({crypto:createNodeCrypto()}).encodeWalletList(old.wallets);
 assert.deepEqual(Object.keys(result).sort(),exactFields.sort());assert.equal(result.operationKind,KIND);assert.equal(result.inputCount,4);assert.equal(result.acceptedCount,2);assert.equal(result.duplicateCount,2);assert.equal(result.errorCount,0);assert.deepEqual(result.errors,[]);assert.equal(result.errorsTruncated,false);assert.equal(result.publishable,true);assert.equal(result.digest,old.digest);assert.equal(result.eligibilityListId,encoded.manifest.id);assert.equal(result.source,body.source);assert.equal(result.inventoryId,body.inventoryId);assert.equal(result.stageId,body.stageId);
 assert.deepEqual(result.expectedRevisions,Object.fromEntries(f.db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)])));for(const key of ['financialExecution','staged','isAuthorization'])assert.equal(result[key],false);for(const w of old.wallets)assert.equal(JSON.stringify(result).includes(w),false);assert.equal(changes(f.db),before);assert.equal(response.headers.get('cache-control'),'no-store');
 const corrected=await(await f.handler(f.request({...body,entries:[wallet(1),wallet(2)]}))).json();assert.equal(corrected.digest,result.digest);assert.equal(corrected.eligibilityListId,result.eligibilityListId);assert.equal(corrected.duplicateCount,0);assert.equal(changes(f.db),before);
});

test('invalid entries return only sanitized positions and first100 errors; invalid draft never invokes codec',async t=>{
 let hashes=0;const base=createNodeCrypto(),f=fixture(t,{crypto:{...base,async sha256(b){hashes++;return base.sha256(b);}}}),entries=[wallet(1),wallet(1)+' ',17,null,{private:'synthetic-secret'},...Array(101).fill('synthetic-invalid-private-wallet')],before=changes(f.db),response=await f.handler(f.request({...f.body,entries}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.publishable,false);assert.equal(result.acceptedCount,1);assert.equal(result.errorCount,105);assert.equal(result.errors.length,100);assert.equal(result.errorsTruncated,true);assert.equal(result.eligibilityListId,null);assert.equal(hashes,0);assert.deepEqual(result.errors,Array.from({length:100},(_,n)=>({index:n+1,reason:'noncanonical-solana-address'})));assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);assert.equal(JSON.stringify(result).includes(wallet(1)),false);assert.equal(changes(f.db),before);
});

test('empty and10000-member lists retain exact existing codec semantics and bounded response',async t=>{
 const f=fixture(t),before=changes(f.db);for(const entries of [[],Array.from({length:10000},(_,n)=>wallet(n))]){const body={...f.body,entries},json=JSON.stringify(body);assert.ok(Buffer.byteLength(json)<=524288);const began=performance.now(),response=await f.handler(f.request(body));assert.equal(response.status,200,await response.clone().text());const result=await response.json(),expected=await createCollectionStateCodec({crypto:createNodeCrypto()}).encodeWalletList([...entries].sort());assert.equal(result.publishable,true);assert.equal(result.acceptedCount,entries.length);assert.equal(result.eligibilityListId,expected.manifest.id);assert.equal(result.digest,dryRunWhitelist(body).digest);assert.ok(Buffer.byteLength(JSON.stringify(result))<2048);assert.equal(changes(f.db),before);t.diagnostic(JSON.stringify({entries:entries.length,inputBytes:Buffer.byteLength(json),responseBytes:Buffer.byteLength(JSON.stringify(result)),elapsedMs:performance.now()-began,staged:false}));}
 for(const table of ['app_collection_records','app_collection_list_seals','app_command_receipts','ops_config_audit','collect_inventories','tx_intents'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
});

test('draft boundary rejects unknown fields, malformed input, source/entry/identity limits and oversized streams',async t=>{
 const f=fixture(t),before=changes(f.db);for(const body of [{...f.body,extra:true},{...f.body,source:' '},{...f.body,source:'x'.repeat(257)},{...f.body,inventoryId:'../bad'},{...f.body,stageId:'x'.repeat(129)},{...f.body,entries:Array(10001).fill(wallet(1))},{...f.body,entries:null},'[1,2]','{"entries":"synthetic-parser-secret"',new Uint8Array([255])]){const r=await f.handler(f.request(body));assert.equal(r.status,400);assert.equal((await r.text()).includes('synthetic-parser-secret'),false);}
 assert.equal((await f.handler(f.request(' '.repeat(524289)))).status,413);let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(262144));c.enqueue(new Uint8Array(262145));},cancel(){cancelled=true;}});assert.equal((await f.handler(f.request(stream))).status,413);assert.equal(cancelled,true);assert.equal((await f.handler(f.request(f.body,{headers:{'content-type':'text/plain'}}))).status,415);assert.equal(changes(f.db),before);
 await assert.rejects(readOperatorBody(new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(16385)})),e=>e.status===413);
});

test('scope, session command, same origin and loopback are mandatory for read-only validation',async t=>{
 const f=fixture(t);assert.equal((await f.handler(f.request(f.body,{headers:{origin:'https://elsewhere.example'}}))).status,403);assert.equal((await f.handler(f.request(f.body,{url:'http://example.com/ops/drafts/whitelist'}))).status,403);assert.equal((await f.handler(f.request(f.body,{headers:{authorization:'Bearer member'}}))).status,401);assert.equal((await f.handler(f.request(f.body,{method:'GET'}))).status,405);assert.equal((await f.handler(f.request(f.body,{url:origin+'/ops/drafts/other'}))).status,404);
 const noGrant=fixture(t,{grant:false});assert.equal((await noGrant.handler(noGrant.request())).status,403);const noKind=fixture(t,{allowedKinds:['collection.stage-record.v1']});assert.equal((await noKind.handler(noKind.request())).status,403);f.sessions.revoke();assert.equal((await f.handler(f.request())).status,401);
});

test('asynchronous encoding cannot outlive session or grant and cannot return stale configuration',async t=>{
 for(const fault of ['session','expiry','grant','revision']){const base=createNodeCrypto();let f,changed=false;const crypto={...base,async sha256(b){const result=await base.sha256(b);if(!changed){changed=true;if(fault==='session')f.sessions.revoke();if(fault==='expiry')f.setNow(f.getNow()+7200000);if(fault==='grant')f.db.exec('UPDATE app_operator_scopes SET enabled=0');if(fault==='revision')f.db.exec("UPDATE app_revisions SET revision=revision+1 WHERE name='source'");}return result;}};f=fixture(t,{crypto});const response=await f.handler(f.request());assert.equal(changed,true);assert.equal(response.status,['session','expiry'].includes(fault)?401:409,fault+await response.clone().text());for(const table of ['app_collection_records','app_command_receipts','ops_config_audit'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);}
});
