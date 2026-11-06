import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createNodeAtomicDriver} from './atomic-driver.mjs';
import {sql} from '../atomic-driver.mjs';

test('transaction guard denies before statements and rolls back an expired final guard',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE effects(id INTEGER)');
 let calls=0,denyAt=1;
 const driver=createNodeAtomicDriver(db,{transactionGuard(){if(++calls===denyAt)throw Error('session expired');}});
 await assert.rejects(driver.batch([sql('INSERT INTO effects VALUES(1)')]),/session expired/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM effects').get().n,0);
 calls=0;denyAt=2;
 await assert.rejects(driver.batch([sql('INSERT INTO effects VALUES(2)')]),/session expired/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM effects').get().n,0);
 calls=0;denyAt=3;
 await driver.batch([sql('INSERT INTO effects VALUES(3)')]);assert.equal(calls,2);
 assert.equal(db.prepare('SELECT id FROM effects').get().id,3);
});

test('guarded batch rejects an outer transaction that could outlive authorization',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE effects(id INTEGER); BEGIN; INSERT INTO effects VALUES(1)');
 let calls=0;
 const driver=createNodeAtomicDriver(db,{transactionGuard(){if(++calls===2)throw Error('revoked');}});
 await assert.rejects(driver.batch([sql('INSERT INTO effects VALUES(2)')]),/own transaction/);
 assert.equal(calls,0);
 assert.equal(db.isTransaction,true);db.exec('COMMIT');
 assert.deepEqual(db.prepare('SELECT id FROM effects').all().map(r=>r.id),[1]);
});

test('async or value-returning guards fail closed',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 assert.throws(()=>createNodeAtomicDriver(db,{transactionGuard:async()=>{}}),/synchronous/);
 assert.throws(()=>createNodeAtomicDriver(db,{transactionGuard:true}),/synchronous/);
 const driver=createNodeAtomicDriver(db,{transactionGuard:()=>Promise.resolve()});
 await assert.rejects(driver.batch([sql('CREATE TABLE forbidden(id INTEGER)')]),/undefined/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='forbidden'").get().n,0);
});
