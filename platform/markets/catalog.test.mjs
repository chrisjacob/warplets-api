import test from 'node:test';
import assert from 'node:assert/strict';
import {encode58} from '../server/base58.mjs';
import {openDatabase} from '../storage/database.mjs';
import {importMarket,handleMarkets} from './catalog.mjs';
function fixture(id) {
 const key=n=>encode58(Buffer.alloc(32,n));
 return {id:'att-'+id,attMint:key(id),poolAddress:key(id+100),ogMint:key(201),
  symbol:'ATT'+id,ogSymbol:'OG',activatedAt:'2026-11-01T00:00:00.000Z'};
}
test('catalog paging freezes market set, fee and clock across appends',async t=>{
 const db=openDatabase();t.after(()=>db.close());
 const get=(path,ms)=>handleMarkets(db,new Request('http://localhost/api/v1'+path),ms);
 const at=Date.parse(fixture(1).activatedAt)+1000;
 for(const id of [1,2,3])importMarket(db,fixture(id));
 importMarket(db,fixture(3));assert.throws(()=>importMarket(db,{...fixture(3),symbol:'NEW'}));
 const page=await (await get('/markets?limit=1',at)).json();assert.equal(page.items[0].id,'att-3');
 importMarket(db,fixture(4));
 const rest=await (await get('/markets?limit=10&cursor='+page.nextCursor,at+10000)).json();
 assert.equal(page.snapshotId,rest.snapshotId);assert.deepEqual(rest.items.map(m=>m.id),['att-2','att-1']);
 assert.equal(rest.items[0].feeBps,8900);assert.equal(rest.nextCursor,null);
 assert.equal((await get('/markets?limit=0',at)).status,400);
 assert.equal((await get('/markets?cursor=invalid',at)).status,400);
 const fee=(await (await get('/launch/fee-schedule',at)).json()).points;
 assert.equal(fee[88].feeBps,200);assert.equal(fee[89].feeBps,100);
});

test('catalog searches all records and binds filtered cursors to stable status and query',async t=>{
 const db=openDatabase();t.after(()=>db.close());const now=Date.parse('2026-11-15T00:00:00.000Z');
 for(let i=1;i<=40;i++)importMarket(db,{...fixture(i),activatedAt:i<=5?'2026-11-14T00:00:00.000Z':fixture(i).activatedAt});
 const get=async query=>handleMarkets(db,new Request('http://localhost/api/v1/markets?'+query),now);
 const active=await (await get('status=active&limit=2')).json();
 assert.deepEqual(active.items.map(m=>m.id),['att-5','att-4']);
 assert(active.items.every(m=>m.status==='active'));
 const next=await (await get('status=active&limit=100&cursor='+active.nextCursor)).json();
 assert.deepEqual(next.items.map(m=>m.id),['att-3','att-2','att-1']);
 assert.equal((await get('status=campaign-ended&cursor='+active.nextCursor)).status,400);
 assert.equal((await get('status=active&q=ATT1&cursor='+active.nextCursor)).status,400);
 const search=await (await get('q=att-1')).json();assert(search.items.some(m=>m.id==='att-1'));assert(search.items.every(m=>m.id.includes('att-1')));
 const ended=await (await get('status=campaign-ended&limit=100')).json();assert.equal(ended.items.length,35);assert(ended.items.every(m=>m.status==='campaign-ended'));
 assert.equal((await get('status=unknown')).status,400);assert.equal((await get('q='+ 'x'.repeat(65))).status,400);
 assert.equal((await get('q=a&q=b')).status,400);
 const none=await (await get('q=not-found')).json();assert.equal(none.items.length,0);assert.equal(none.nextCursor,null);
});
