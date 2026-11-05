import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {encode58} from '../../server/base58.mjs';
import {importMarket} from '../../markets/catalog.mjs';
import {recordVaultManifest,observeAsset} from '../../vault/ledger.mjs';
import {seedFarm,observeFarm} from '../../stake/farms.mjs';
import {financialReadTestDispatch} from '../../financial/read-test-harness.mjs';
import {createApp} from '../../server/application.mjs';
const key=n=>encode58(Buffer.alloc(32,n)),base=Date.UTC(2026,10,1),hour=3600000,now=base+36*hour,at=h=>new Date(base+h*hour).toISOString();
const id=n=>'nft-'+String(n).padStart(3,'0'),crypto=createNodeCrypto();
function seed(db){
 for(let n=0;n<26;n++){
  const marketId=n?'farm-'+String(n).padStart(3,'0'):'demo';
  importMarket(db,{id:marketId,symbol:'SYNTHETIC',ogSymbol:'OG',activatedAt:at(0),attMint:key(n+10),ogMint:key(4),poolAddress:key(n+110)});
  recordVaultManifest(db,{marketId,originalUnits:'402600000'});seedFarm(db,{marketId,originalUnits:'402600000',treasuryFeeBps:100});
  observeFarm(db,{id:'deposit-'+n,marketId,wallet:key(1),at:at(1),amount:'100',kind:'deposit'},now);
  observeAsset(db,{eventId:'bind-'+n,assetId:id(n),kind:'bind',at:at(35),owner:key(1),slot:{kind:'genesis',tranche:1,level:1,ordinal:n}},now);
 }
 // Explicit synthetic local accounting only: no chain claim or mint receipt.
 db.prepare('INSERT INTO collect_inventories VALUES(?,?,?,?,?,?,?,?)').run('synthetic-hidden','genesis',2,null,null,1,'{}','synthetic-fixture');
 for(const [assetId,ordinal,ms] of [['zz-hidden',100,base+35*hour],['zz-future',101,base+60*hour],['zz-corrupt',102,base+35*hour]]){
  const coords=JSON.stringify({kind:'genesis',tranche:2,level:1,ordinal});
  db.prepare('INSERT INTO vault_assets VALUES(?,?,?,?,?)').run(assetId,coords,coords,key(9),ms);
  db.prepare('INSERT INTO vault_observations VALUES(?,?,?,?,?)').run('bind-'+assetId,assetId,'bind',ms,JSON.stringify({syntheticFixture:true}));
 }
 const slot=JSON.stringify({kind:'genesis',tranche:2,level:1,ordinal:100});
 db.prepare('INSERT INTO collect_assets VALUES(?,?,?,?,?,?,?,?)').run('zz-hidden','synthetic-hidden',key(9),base+35*hour,base+35*hour,null,slot,JSON.stringify({syntheticFixture:true}));
 db.prepare('INSERT INTO vault_claim_totals VALUES(?,?,?)').run('zz-corrupt','demo','-1');
}

test('Node and actual D1 financial reads preserve complete totals, opaque cursors, concealed state and bounded histories',async t=>{
 const node=openDatabase();t.after(()=>node.close());seed(node);
 const edge=await localRuntime(t,new URL('./fixtures/financial-reads-worker.ts',import.meta.url)),driver=createNodeAtomicDriver(node),measurements=[];
 for(const table of ['market_fixtures','vault_manifests','vault_assets','vault_observations','vault_claim_totals','stake_fixture_farms','stake_fixture_events','collect_inventories','collect_assets']){
  const rows=node.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=50){const batch=rows.slice(offset,offset+50).map(row=>{
   const columns=Object.keys(row);return edge.db.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row));});if(batch.length)await edge.db.batch(batch);}
 }
 for(const row of node.prepare('SELECT * FROM app_revisions').all())await edge.db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(row.revision,row.name).run();
 const both=async(path,options={})=>{
  const input={path,nowMs:now,wallet:key(1),...options},a=await financialReadTestDispatch({driver,crypto,input});
  const response=await edge.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(input)});assert.equal(response.status,200);
  const b=await response.json();assert.deepEqual(b,a,path);assert.equal(a.headers['cache-control'],'no-store');assert.ok(a.measurement.statements<1000);measurements.push({path,...a.measurement});return a;
 };
 const write=async(sql,...values)=>{await driver.batch([{sql,values}]);await edge.db.prepare(sql).bind(...values).run();};
 const paged=(path,cursor)=>path+'?cursor='+encodeURIComponent(cursor);
 const first=await both('/api/v1/vault');assert.equal(first.status,200);assert.equal(first.body.items.length,25);assert.equal(first.body.summary.assetCount,26);assert.equal(first.body.summary.items[0].allocated,'26000');assert.equal(first.body.summary.items[0].claimable,'13000');assert.ok(first.body.nextCursor);assert.equal(first.measurement.statements,6);
 const next=await both(paged('/api/v1/vault',first.body.nextCursor),{nowMs:now+60000});assert.equal(next.body.items.length,1);assert.equal(next.body.asOf,first.body.asOf);assert.equal(next.body.snapshotId,first.body.snapshotId);assert.deepEqual(next.body.summary,first.body.summary);
 assert.equal((await both(paged('/api/v1/vault',first.body.nextCursor),{wallet:key(2)})).status,400);
 assert.equal((await both(paged('/api/v1/stake/positions',first.body.nextCursor))).status,400);
 assert.equal((await both('/api/v1/vault?cursor=nft-024')).status,400);
 assert.equal((await both(paged('/api/v1/vault',first.body.nextCursor),{nowMs:now+300001})).status,409);
 const asset=await both('/api/v1/nfts/nft-000/vault');assert.equal(asset.status,200);assert.equal(asset.body.items.length,25);assert.ok(asset.body.nextCursor);assert.equal(asset.measurement.statements,5);
 const assetNext=await both(paged('/api/v1/nfts/nft-000/vault',asset.body.nextCursor),{nowMs:now+60000});assert.equal(assetNext.body.items.length,1);assert.equal(assetNext.body.asOf,asset.body.asOf);
 assert.equal((await both(paged('/api/v1/nfts/nft-001/vault',asset.body.nextCursor))).status,400);
 const positions=await both('/api/v1/stake/positions');assert.equal(positions.status,200);assert.equal(positions.body.items.length,25);assert.ok(positions.body.nextCursor);
 const positionsNext=await both(paged('/api/v1/stake/positions',positions.body.nextCursor),{nowMs:now+60000});assert.equal(positionsNext.body.items.length,1);assert.equal(positionsNext.body.asOf,positions.body.asOf);
 const farm=await both('/api/v1/farms/demo');assert.equal(farm.status,200);assert.equal(farm.body.totalStakedUnits,'100');assert.equal(farm.body.executable,false);assert.equal(farm.body.sourceStatus,'local-accounting');assert.equal(farm.body.chainAuthority,'unverified');
 // Explicitly synthetic local session rows exercise the genuine mounted auth
 // readers and origin binding; browser acceptance separately signs challenges.
 const tokens=['synthetic-financial-owner-one','synthetic-financial-owner-two'];
 for(let n=0;n<tokens.length;n++)await write('INSERT INTO sessions VALUES(?,?,?,?)',await crypto.sha256(new TextEncoder().encode(tokens[n])),key(n+1),'http://localhost',now+86400000);
 const nodeApp=createApp(node,{clock:()=>now});let publicRequests=0;
 const publicBoth=async(path,{owner=0,origin='http://localhost'}={})=>{
  const nodeCookie=owner===null?'':'tenx_local_session='+tokens[owner],edgeCookie=owner===null?'':'tenx_edge_local_session='+tokens[owner];
  const a=await nodeApp(new Request(origin+path,{headers:{cookie:nodeCookie}})),b=await edge.mf.dispatchFetch(origin+path,{headers:{cookie:edgeCookie}});
  assert.equal(a.status,b.status);assert.equal(a.headers.get('cache-control'),'no-store');assert.equal(b.headers.get('cache-control'),'no-store');
  const body=await a.json(),other=await b.json();
  if(body.error){for(const value of [body,other])assert.match(value.error.requestId,/^[0-9a-f-]{36}$/);const {requestId:_a,...first}=body.error,{requestId:_b,...second}=other.error;assert.deepEqual(second,first);}
  else assert.deepEqual(other,body);publicRequests++;return {status:a.status,body};
 };
 for(const path of ['/api/v1/nfts/nft-000/vault','/api/v1/farms/demo','/api/v1/vault','/api/v1/stake/positions']){const r=await publicBoth(path);assert.equal(r.status,200);assert.equal(r.body.executable,false);assert.equal(r.body.chainAuthority,'unverified');}
 assert.equal((await publicBoth('/api/v1/vault',{owner:1})).body.summary.assetCount,0);
 for(const path of ['/api/v1/vault','/api/v1/stake/positions']){assert.equal((await publicBoth(path,{owner:null})).status,401);assert.equal((await publicBoth(path,{origin:'http://127.0.0.1'})).status,401);}
 assert.equal((await publicBoth(paged('/api/v1/vault',first.body.nextCursor),{owner:1})).status,400);
 assert.equal((await publicBoth(paged('/api/v1/stake/positions',first.body.nextCursor))).status,400);
 assert.equal((await publicBoth('/api/v1/nfts/zz-hidden/vault')).status,409);
 for(const path of ['/api/v1/vault','/api/v1/stake/positions'])assert.equal((await both(path,{wallet:null})).status,401);
 assert.equal((await both('/api/v1/vault',{method:'POST'})).status,405);assert.equal((await both('/api/v1/farms/demo?cursor=x')).status,400);
 assert.equal((await both('/api/v1/nfts/missing/vault')).status,404);
 const hidden=await both('/api/v1/nfts/zz-hidden/vault');assert.equal(hidden.status,409);assert.equal(hidden.body.error.code,'metadata_unrevealed');assert.deepEqual(Object.keys(hidden.body),['error']);
 for(const [name,reason] of [['zz-future','future-accounting'],['zz-corrupt','invalid-accounting']]){const result=await both('/api/v1/nfts/'+name+'/vault');assert.equal(result.status,503);assert.equal(result.body.error.code,reason);}
 const concealSummary=await both('/api/v1/vault',{wallet:key(9)});assert.equal(concealSummary.body.summary.reason,'concealed-metadata');assert.equal(concealSummary.body.summary.assetCount,null);assert.deepEqual(concealSummary.body.summary.items,[]);

 // Each real table change invalidates a cursor before returning any old page.
 await write('INSERT INTO vault_claim_totals VALUES(?,?,?)','nft-000','demo','100');
 assert.equal((await both(paged('/api/v1/vault',first.body.nextCursor))).status,409);
 const claimed=await both('/api/v1/nfts/nft-000/vault');assert.equal(claimed.body.items[0].claimed,'100');assert.equal(claimed.body.ownerObservedAt,at(35));
 let cursor=(await both('/api/v1/vault')).body.nextCursor;
 await write('UPDATE vault_assets SET owner=? WHERE id=?',key(2),'nft-000');assert.equal((await both(paged('/api/v1/vault',cursor))).status,409);
 const transferred=await both('/api/v1/vault',{wallet:key(2)});assert.equal(transferred.body.summary.items[0].claimed,'100');assert.equal(transferred.body.summary.items[0].claimable,'400');
 await write('UPDATE vault_assets SET owner=? WHERE id=?',key(1),'nft-000');cursor=(await both('/api/v1/vault')).body.nextCursor;
 await write('UPDATE collect_assets SET reveal_ms=? WHERE id=?',now,'zz-hidden');assert.equal((await both(paged('/api/v1/vault',cursor))).status,409);assert.equal((await both('/api/v1/nfts/zz-hidden/vault')).status,200);
 cursor=(await both('/api/v1/stake/positions')).body.nextCursor;await write('UPDATE stake_fixture_farms SET treasury_fee_bps=101 WHERE market_id=?','demo');assert.equal((await both(paged('/api/v1/stake/positions',cursor))).status,409);

 const retry=await both('/api/v1/vault',{fault:'source-once',faultWallet:key(2)});assert.equal(retry.status,200);assert.equal(retry.measurement.injected,1);assert.equal(retry.measurement.hashes,2);assert.equal(retry.body.summary.assetCount,25);
 const held=await both('/api/v1/vault',{fault:'source-always',faultWallet:key(2)});assert.equal(held.status,503);assert.equal(held.body.error.code,'source_changed');assert.equal(held.measurement.injected,2);
 await write('UPDATE vault_assets SET owner=? WHERE id=?',key(1),'nft-025');cursor=(await both('/api/v1/vault')).body.nextCursor;
 const stale=await both(paged('/api/v1/vault',cursor),{fault:'source-once',faultWallet:key(2)});assert.equal(stale.status,409);assert.equal(stale.body.error.code,'stale_cursor');

 // Corrupt/oversized imported local history cannot become a partial simulation.
 const extra=[];for(let n=0;n<1000;n++)extra.push({sql:'INSERT INTO stake_fixture_events(id,market_id,kind,wallet,at_ms,amount) VALUES(?,?,?,?,?,?)',values:['overflow-'+n,'demo','deposit',key(1),base+2*hour,'1']});
 for(let offset=0;offset<extra.length;offset+=50){const slice=extra.slice(offset,offset+50);await driver.batch(slice);await edge.db.batch(slice.map(s=>edge.db.prepare(s.sql).bind(...s.values)));}
 for(const path of ['/api/v1/farms/demo','/api/v1/stake/positions']){const value=await both(path);assert.equal(value.status,503);assert.equal(value.body.error.code,'event_bound');assert.deepEqual(Object.keys(value.body),['error']);}
 for(const table of ['tx_intents','tx_attempts']){assert.equal(node.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),0);}
 t.diagnostic(JSON.stringify({requests:measurements.length,productionRouteRequests:publicRequests,maxSqlStatements:Math.max(...measurements.map(m=>m.statements)),financialCapabilities:false}));
});
