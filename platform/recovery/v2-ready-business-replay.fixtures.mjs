import assert from 'node:assert/strict';
import {fullAdoptionSource} from './v2-adoption-full.fixtures.mjs';
import {dispatchImportedLifecycle} from '../collect/imported-lifecycle-test-harness.mjs';
import {BUSINESS_TABLES,quote} from './schema.mjs';
import {canonicalJson} from '../security/canonical.mjs';
export async function pendingReplaySource(t){
 const f=await fullAdoptionSource(t,'modern-pending'),row=f.db.prepare("SELECT r.* FROM app_command_receipts r JOIN collect_operations o ON o.id=r.result_ref WHERE r.request_key='synthetic-mixed-pending' AND o.settled_ms IS NULL").get();assert.ok(row);
 const input=JSON.parse(row.input_json);delete input.kind;input.requestKey=row.request_key;
 const principal={kind:'wallet',wallet:row.principal_key.slice('wallet:'.length)},request={method:'mint',idPrefix:'synthetic-recovered-replay',nowMs:f.now,principal,input};
 const expected=(await dispatchImportedLifecycle({driver:f.driver,crypto:f.crypto,store:f.store,request})).result;assert.equal(expected.kind,'replayed');
 const nowMs=Math.max(f.now+86400000,f.db.prepare('SELECT MAX(closes_ms) n FROM app_collection_stages').get().n+86400000);
 return {...f,replayRequest:{...request,nowMs},expected};
}
export const pauseSql="INSERT INTO ops_scope_log VALUES('synthetic-recovered-pause','collection-mint',1,(SELECT revision FROM ops_scope_log WHERE scope='collection-mint' ORDER BY at_ms DESC LIMIT 1),?,'synthetic-recovery-operator','Synthetic replay acceptance pause','synthetic:replay','synthetic-recovered-pause')";
export async function businessSnapshot(all){const value={};for(const table of BUSINESS_TABLES)value[table]=(await all('SELECT * FROM '+quote(table))).map(canonicalJson).sort();return value;}
export function assertReplays(expected,replay,changed,fresh){assert.deepEqual(replay,expected);assert.equal(replay.value.executable,false);assert.equal(changed.kind,'conflict');assert.equal(changed.code,'idempotency_conflict');assert.equal(fresh.kind,'pending',JSON.stringify(fresh));assert.equal(fresh.reason,'operator-pause');}
