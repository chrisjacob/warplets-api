import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,transaction} from './database.mjs';
test('nested economic observations roll back together and isolated failures preserve outer writes',t=>{
 const db=openDatabase();t.after(()=>db.close());
 db.exec('CREATE TABLE proof(id INTEGER PRIMARY KEY)');
 assert.throws(()=>transaction(db,()=>{
  transaction(db,()=>db.exec('INSERT INTO proof VALUES(1)'));
  throw Error('outer operation failed');
 }));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM proof').get().n,0);
 transaction(db,()=>{
  db.exec('INSERT INTO proof VALUES(1)');
  assert.throws(()=>transaction(db,()=>{db.exec('INSERT INTO proof VALUES(2)');throw Error('bad evidence');}));
  db.exec('INSERT INTO proof VALUES(3)');
 });
 assert.deepEqual(db.prepare('SELECT id FROM proof ORDER BY id').all().map(row=>row.id),[1,3]);
});
