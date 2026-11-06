import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {planRecoveryV2Rows,materializeRecoveryV2Rows} from './v2-planning.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
test('keyset page planning emits exact100-row continuations and bounded byte pages without offset or lost rows',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE synthetic_rows(id INTEGER PRIMARY KEY,value TEXT) STRICT');const put=db.prepare('INSERT INTO synthetic_rows VALUES(?,?)');for(let n=1;n<=251;n++)put.run(n,'row-'+n);
 const table={name:'synthetic_rows',columns:['id','value'],primaryKey:['id'],hasRowid:true},codec=createRecoveryV2Codec({crypto:createNodeCrypto()}),all=[];let after=null,index=0;
 for(;;){const plan=planRecoveryV2Rows(table,{index,after}),result=materializeRecoveryV2Rows(plan,db.prepare(plan.statement.sql).all(...plan.statement.values));assert.doesNotMatch(plan.statement.sql,/OFFSET/);if(result.value){assert.ok(result.value.rows.length<=100);await codec.encodeRows(result.value);all.push(...result.value.rows);after=result.last;}if(result.exhausted)break;index++;}
 assert.equal(index,2);assert.equal(all.length,251);assert.deepEqual(all.map(row=>row[0]),Array.from({length:251},(_,n)=>n+1));
 db.exec('DELETE FROM synthetic_rows');for(let n=1;n<=5;n++)put.run(n,'x'.repeat(40000));const plan=planRecoveryV2Rows(table,{index:0}),partial=materializeRecoveryV2Rows(plan,db.prepare(plan.statement.sql).all(...plan.statement.values));assert.equal(partial.value.rows.length,3);assert.equal(partial.exhausted,false);assert.deepEqual(partial.last,[3]);
 const next=planRecoveryV2Rows(table,{index:1,after:partial.last}),remaining=materializeRecoveryV2Rows(next,db.prepare(next.statement.sql).all(...next.statement.values));assert.equal(remaining.value.rows.length,2);assert.equal(remaining.exhausted,true);
});
test('oversized source row is never hydrated or skipped and SQL composite-key ordering remains exact',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE synthetic_rows(id INTEGER PRIMARY KEY,value TEXT) STRICT');db.prepare('INSERT INTO synthetic_rows VALUES(1,?)').run('x'.repeat(2000000));const plan=planRecoveryV2Rows({name:'synthetic_rows',columns:['id','value'],primaryKey:['id'],hasRowid:true},{index:0}),raw=db.prepare(plan.statement.sql).all(...plan.statement.values);assert.equal(raw.length,1);assert.equal(raw[0].row_json,null);assert.throws(()=>materializeRecoveryV2Rows(plan,raw),/exceeds page byte bound/);
 db.exec('CREATE TABLE synthetic_keys(a TEXT,b INTEGER,value TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID,STRICT');const put=db.prepare('INSERT INTO synthetic_keys VALUES(?,?,?)');for(const a of ['a','b'])for(let n=0;n<60;n++)put.run(a,n,a+n);const table={name:'synthetic_keys',columns:['a','b','value'],primaryKey:['a','b'],hasRowid:false},first=planRecoveryV2Rows(table,{index:0}),page=materializeRecoveryV2Rows(first,db.prepare(first.statement.sql).all(...first.statement.values));assert.equal(page.value.rows.length,100);assert.deepEqual(page.last,['b',39]);const second=planRecoveryV2Rows(table,{index:1,after:page.last}),tail=materializeRecoveryV2Rows(second,db.prepare(second.statement.sql).all(...second.statement.values));assert.equal(tail.value.rows.length,20);assert.deepEqual(tail.value.rows[0],['b',40,'b40']);
});
