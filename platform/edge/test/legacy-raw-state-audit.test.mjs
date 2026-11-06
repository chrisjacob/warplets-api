import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {_SHA256} from '../../beacon/node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/sha2.js';
import {createLegacyAuditHashAdapter,LEGACY_HASH_IMPLEMENTATION_PIN} from '../../collect/legacy-audit-hash.mjs';
import {createLegacyRawStateAudit} from '../../collect/legacy-raw-state-audit.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {localRuntime} from './local-runtime.mjs';
const hash=()=>createLegacyAuditHashAdapter({createSha256:()=>new _SHA256(),implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN});
test('actual D1 raw byte audit resumes separate invocations and matches Node native digest, then fences mutation',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/legacy-raw-state-audit-worker.ts',import.meta.url)),node=openDatabase();t.after(()=>node.close());
 const state=JSON.stringify({z:'🦘é\u0000'.repeat(75000),a:1}),insert="INSERT INTO collect_inventories VALUES('legacy','genesis',1,NULL,NULL,0,?,'synthetic-origin')";await db.prepare(insert).bind(state).run();node.prepare(insert).run(state);
 const call=async checkpoint=>{const r=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({inventoryId:'legacy',checkpoint})});assert.equal(r.status,200);return r.json();};let checkpoint=null,nc=null,result,first,steps=0,maxWorkingBytes=0;
 do{result=await call(checkpoint);const expected=await createLegacyRawStateAudit({driver:createNodeAtomicDriver(node),hash:hash()}).step({inventoryId:'legacy',checkpoint:nc});assert.deepEqual(result,expected);steps++;maxWorkingBytes=Math.max(maxWorkingBytes,result.metrics.maxWorkingBytes);if(result.kind==='continue'){checkpoint=JSON.parse(JSON.stringify(result.checkpoint));nc=expected.checkpoint;first??=checkpoint;}}while(result.kind==='continue');
 assert.equal(result.kind,'verified');assert.equal(result.rawStateDigest,createHash('sha256').update(state).digest('hex'));assert.ok(maxWorkingBytes<1048576);assert.deepEqual(await call(first),await call(first));await db.prepare("UPDATE collect_inventories SET revision=revision+1 WHERE id='legacy'").run();assert.equal((await call(first)).reason,'source-pin-changed');assert.equal((await mf.dispatchFetch('http://localhost/api/v1/legacy-audit')).status,404);t.diagnostic(JSON.stringify({sourceBytes:Buffer.byteLength(state),steps,maxWorkingBytes,sqlPerStep:3,adoption:false}));
});
test('32MiB exact local Node row hashes in512 bounded resumed calls with pinned serialized state',async t=>{const db=openDatabase();t.after(()=>db.close());const size=33554432;db.prepare("INSERT INTO collect_inventories VALUES('legacy','genesis',1,NULL,NULL,0,CAST(zeroblob(?) AS TEXT),'synthetic-binary-raw-fixture')").run(size);let checkpoint=null,result,steps=0,maxWorkingBytes=0;do{result=await createLegacyRawStateAudit({driver:createNodeAtomicDriver(db),hash:hash()}).step({inventoryId:'legacy',checkpoint});steps++;maxWorkingBytes=Math.max(maxWorkingBytes,result.metrics.maxWorkingBytes);checkpoint=result.checkpoint;}while(result.kind==='continue');assert.equal(result.kind,'verified');assert.equal(steps,512);assert.equal(result.rawStateDigest,createHash('sha256').update(Buffer.alloc(size)).digest('hex'));assert.ok(maxWorkingBytes<1048576);t.diagnostic(JSON.stringify({classification:'synthetic raw bytes; not valid inventory JSON; local D1 single-value limit is smaller',size,steps,maxWorkingBytes,sqlPerStep:3}));});
