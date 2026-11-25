import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {base58,protectBytes} from './create-wallets.mjs';

test('Solana address encoding preserves leading zeros and known vectors',()=>{
 assert.equal(base58(Buffer.alloc(32)),'11111111111111111111111111111111');
 assert.equal(base58(Buffer.from('Hello World')),'JxF12TrwUP45BMd');
 assert.equal(base58(Buffer.from([0,0,1])),'112');
});
test('experiment graph is complete, acyclic and preserves required custody gates',()=>{
 const data=JSON.parse(readFileSync(new URL('./experiments.json',import.meta.url)));
 const map=new Map(data.experiments.map(row=>[row.id,row]));
 assert.equal(map.size,11);assert.equal(data.budget.maximum,10);
 const visiting=new Set(),done=new Set();
 function visit(id){
  assert(map.has(id));assert(!visiting.has(id),'Cycle: '+id);
  if(done.has(id))return;visiting.add(id);
  const row=map.get(id);assert(row.steps.length);assert(row.passCriteria.length);
  for(const dependency of row.dependsOn)visit(dependency);
  visiting.delete(id);done.add(id);
 }
 for(const id of map.keys())visit(id);
 for(const dependency of ['P04','P05','P06'])assert(map.get('P10').dependsOn.includes(dependency));
 assert.equal(data.budget.recurringServicesAllowed,false);
});
test('DPAPI protection uses randomized encryption and never returns plaintext',{skip:process.platform!=='win32'},()=>{
 // Synthetic bytes only. This test never reads operational wallet files.
 const plaintext=Buffer.alloc(64,7),a=protectBytes(plaintext),b=protectBytes(plaintext);
 assert(a.length>plaintext.length);assert(b.length>plaintext.length);
 assert(!a.equals(plaintext));assert(!a.equals(b));
});
