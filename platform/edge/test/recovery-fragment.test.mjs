import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createCollection} from '../../collect/store.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createRecoveryV2FragmentCodec,RECOVERY_FRAGMENT_COLUMNS} from '../../recovery/v2-fragments.mjs';
import {planRecoveryFragmentProbe,materializeRecoveryFragmentProbe,planRecoveryFragmentChunk,materializeRecoveryFragmentChunk} from '../../recovery/v2-fragment-planning.mjs';
const table={name:'fair_inventories',columns:[...RECOVERY_FRAGMENT_COLUMNS],primaryKey:['inventory_id'],hasRowid:true};
test('Node and actual workerd/D1 emit identical SQL JSON text fragments across Unicode, escape and maximum-policy boundaries',async t=>{
 const source=openDatabase();t.after(()=>source.close());const r=await localRuntime(t,new URL('./fixtures/recovery-fragment-worker.ts',import.meta.url)),crypto=createNodeCrypto(),codec=createRecoveryV2FragmentCodec({crypto}),metrics=[];
 await r.db.exec('CREATE TABLE synthetic_fragment_seed(id INTEGER PRIMARY KEY,text TEXT NOT NULL) STRICT');
 const values=[JSON.stringify(Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,Array.from({length:256},(_,n)=>({name:'界'.repeat(124)+String(n).padStart(4,'0'),weight:1000000}))]))),JSON.stringify({model:'😀界\\"\n\0'.repeat(4000)})];
 for(const [index,traits]of values.entries()){
  const inventoryId='synthetic-fragment-parity-'+index;createCollection(source,{id:inventoryId,kind:'genesis',tranche:index+1});const h=source.prepare('SELECT * FROM collect_inventories WHERE id=?').get(inventoryId),keys=Object.keys(h);await r.db.prepare(`INSERT INTO collect_inventories(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...Object.values(h)).run();
  source.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(inventoryId,'b'.repeat(64),traits,1);
  // Bounded fixture-only staging avoids an oversized seed request. It is not
  // the proposed048 restore control table or an authority implementation.
  const chars=Array.from(traits);await r.db.exec('DELETE FROM synthetic_fragment_seed');for(let offset=0,n=0;offset<chars.length;offset+=4096,n++)await r.db.prepare('INSERT INTO synthetic_fragment_seed VALUES(?,?)').bind(n,chars.slice(offset,offset+4096).join('')).run();await r.db.prepare("INSERT INTO fair_inventories SELECT ?,?,group_concat(text,''),? FROM (SELECT text FROM synthetic_fragment_seed ORDER BY id)").bind(inventoryId,'b'.repeat(64),1).run();
 }
 const call=async input=>{const response=await r.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(input)});assert.equal(response.status,200,await response.clone().text());const result=await response.json();metrics.push(result.metrics);return result;};let after=null,totalChunks=0;
 for(let index=0;index<values.length;index++){
  const input={index,after,schemaFingerprint:'a'.repeat(64)},probe=planRecoveryFragmentProbe(table,input),node=materializeRecoveryFragmentProbe(probe,source.prepare(probe.statement.sql).all(...probe.statement.values)),edge=(await call({method:'probe',table,input})).value;assert.deepEqual(edge,node);const fragments=[],texts=[];
  for(let n=0;n<Math.ceil(node.characters/8192);n++){const plan=planRecoveryFragmentChunk(node,n),piece=materializeRecoveryFragmentChunk(plan,source.prepare(plan.statement.sql).all(...plan.statement.values)),expected=await codec.encodeChunk(piece.text),actual=await call({method:'chunk',header:node,index:n});assert.deepEqual(actual.piece,piece);assert.deepEqual(actual.identity,expected.identity);fragments.push({index:n,offset:piece.offset,characters:piece.characters,identity:actual.identity});texts.push(piece.text);totalChunks++;}
  assert.equal(JSON.parse(texts.join(''))[3],values[index]);const descriptor=await codec.encodeRowDescriptor({...node,fragments});assert.deepEqual(await codec.verifyRowDescriptor(descriptor.bytes,descriptor.identity),{...node,fragments});after=node.cursor;
 }
 assert.ok(metrics.every(m=>m.statements===1&&m.batchBytes<2048&&m.resultBytes<32768));t.diagnostic(JSON.stringify({rows:2,maximumPolicyBytes:Buffer.byteLength(values[0]),totalChunks,maximumResultBytes:Math.max(...metrics.map(m=>m.resultBytes)),maximumSqlBatchBytes:Math.max(...metrics.map(m=>m.batchBytes)),exactNodeWorkerdBytes:true,planningOnly:true,fragmentControlUsed:false}));
});
