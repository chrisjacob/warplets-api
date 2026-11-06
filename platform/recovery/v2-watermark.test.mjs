import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {recoveryWatermarkTriggerInventory,verifyRecoveryWatermarkTriggers,recoveryWatermarkTriggerQuery} from './v2-watermark.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
test('exact watermark SQL verification rejects same-name disabled triggers and omitted future tables',async()=>{
 const tables=['synthetic_business'],expected=recoveryWatermarkTriggerInventory(tables),crypto=createNodeCrypto(),valid=await verifyRecoveryWatermarkTriggers(expected,tables,crypto);assert.equal(valid.triggerCount,6);assert.match(valid.fingerprint,/^[a-f0-9]{64}$/);
 await assert.rejects(verifyRecoveryWatermarkTriggers(expected.slice(1),tables,crypto),/inventory mismatch/);
 await assert.rejects(verifyRecoveryWatermarkTriggers(expected.map(row=>row.name.endsWith('_insert')?{...row,sql:row.sql.replace('revision=revision+1','revision=revision')}:row),tables,crypto),/SQL mismatch/);
 await assert.rejects(verifyRecoveryWatermarkTriggers(expected,[...tables,'new_business'],crypto),/inventory mismatch/);
 const formatted=expected.map(row=>({...row,sql:'\n'+row.sql.replaceAll(' AFTER ','\n AFTER ')+';\n'}));assert.deepEqual(await verifyRecoveryWatermarkTriggers(formatted,tables,crypto),valid);
});
test('actual SQLite whole-business watermark advances and cannot reset via replace even with recursive triggers disabled',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA recursive_triggers=OFF; CREATE TABLE app_recovery_watermark(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991)) STRICT; INSERT INTO app_recovery_watermark VALUES(1,0); CREATE TABLE synthetic_business(id INTEGER PRIMARY KEY,value TEXT) STRICT;');
 for(const row of recoveryWatermarkTriggerInventory(['synthetic_business']))db.exec(row.sql);
 const revision=()=>db.prepare('SELECT revision FROM app_recovery_watermark').get().revision;
 db.prepare('INSERT INTO synthetic_business VALUES(1,?)').run('first');assert.equal(revision(),1);db.prepare('UPDATE synthetic_business SET value=?').run('next');assert.equal(revision(),2);db.exec('DELETE FROM synthetic_business');assert.equal(revision(),3);
 assert.throws(()=>db.exec('INSERT OR REPLACE INTO app_recovery_watermark VALUES(1,0)'),/Retain/);assert.throws(()=>db.exec('DELETE FROM app_recovery_watermark'),/Retain/);assert.throws(()=>db.exec('UPDATE app_recovery_watermark SET revision=0'),/advance/);assert.equal(revision(),3);
 const query=recoveryWatermarkTriggerQuery(),rows=db.prepare(query.sql).all(...query.values).map(row=>({...row}));assert.equal((await verifyRecoveryWatermarkTriggers(rows,['synthetic_business'],createNodeCrypto())).triggerCount,6);
});
