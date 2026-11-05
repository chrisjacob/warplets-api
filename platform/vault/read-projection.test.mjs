import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createFinancialVaultRepository,FinancialVaultReadBoundError} from '../storage/financial-vault.mjs';
import {projectMemberVaultSnapshot,projectVaultAssetSnapshot} from './read-projection.mjs';
import {prepareVaultManifest,projectEntitlement} from './projection.mjs';
import {memberVaultSummary} from './member-projection.mjs';
import {observeAsset,readAsset,recordVaultManifest} from './ledger.mjs';
import {importMarket} from '../markets/catalog.mjs';
import {encode58} from '../server/base58.mjs';
import {createCollection,publishCollectionStage,reserveMint,fulfillMint,inspectOperation,observeCollectionAsset} from '../collect/store.mjs';
const key=n=>encode58(Buffer.alloc(32,n)),base=Date.UTC(2026,10,1),hour=3600000,at=h=>new Date(base+h*hour).toISOString();
const labels={sourceStatus:'local-accounting',chainAuthority:'unverified',unit:'base-units',executable:false};
const strip=value=>JSON.parse(JSON.stringify(value),(k,v)=>Object.hasOwn(labels,k)?undefined:v);
const member=(wallet=key(1),h=36,after='')=>({wallet,evaluatedAtMs:base+h*hour,after});
const detail=(assetId,h=36,after='')=>({assetId,evaluatedAtMs:base+h*hour,after});
function setup(t){
 const db=openDatabase();t.after(()=>db.close());
 importMarket(db,{id:'demo',symbol:'DEMO',ogSymbol:'OG',activatedAt:at(0),attMint:key(3),ogMint:key(4),poolAddress:key(5)});
 recordVaultManifest(db,{marketId:'demo',originalUnits:'402600000'});
 const driver=createNodeAtomicDriver(db),calls=[];
 const repo=createFinancialVaultRepository({...driver,async batch(statements){calls.push(statements);return driver.batch(statements);}});
 return {db,repo,calls};
}
function bind(db,n,owner=key(1)){observeAsset(db,{eventId:'bind-'+n,assetId:'nft-'+String(n).padStart(3,'0'),kind:'bind',at:at(36),owner,slot:{kind:'genesis',tranche:1,level:1,ordinal:n}},base+36*hour);}

test('single-batch bounded Vault snapshots preserve full-owner totals, pagination, original clocks and transfer claims',async t=>{
 const {db,repo,calls}=setup(t);for(let n=0;n<26;n++)bind(db,n);
 const first=await repo.readMemberVault(member()),projected=projectMemberVaultSnapshot(first);
 assert.equal(calls.length,1);assert.equal(calls[0].length,5);assert.match(first.sourceRevision,/^\d+$/);assert.ok(Object.isFrozen(first.assets[0]));
 assert.deepEqual(strip(projected.summary),memberVaultSummary(db,key(1),base+36*hour));
 assert.equal(projected.summary.items[0].allocated,'26000');assert.equal(projected.summary.items[0].claimable,'13000');
 assert.equal(projected.items.length,25);assert.equal(projected.nextCursor,'nft-024');assert.deepEqual(Object.fromEntries(Object.keys(labels).map(k=>[k,projected[k]])),labels);
 const second=projectMemberVaultSnapshot(await repo.readMemberVault(member(key(1),36,projected.nextCursor)));
 assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);assert.deepEqual(second.summary,projected.summary);
 observeAsset(db,{eventId:'claim',assetId:'nft-000',kind:'claim',at:at(37),owner:key(1),marketId:'demo',units:'100'},base+37*hour);
 const claim=projectVaultAssetSnapshot(await repo.readAssetVault(detail('nft-000',37)));
 assert.equal(calls.at(-1).length,4);assert.equal(claim.kind,'ready');assert.equal(claim.value.ownerObservedAt,at(36));
 assert.deepEqual(strip(claim.value),readAsset(db,'nft-000',base+37*hour));
 observeAsset(db,{eventId:'transfer',assetId:'nft-000',kind:'transfer',at:at(48),from:key(1),to:key(2)},base+48*hour);
 const buyer=projectMemberVaultSnapshot(await repo.readMemberVault(member(key(2),49)));
 assert.equal(buyer.items[0].ownerObservedAt,at(48));assert.equal(buyer.summary.items[0].claimable,'900');assert.equal(buyer.summary.items[0].activatedAt,at(0));
 assert.equal(projectMemberVaultSnapshot(await repo.readMemberVault(member(key(1),49))).summary.assetCount,25);
 assert.deepEqual(projectVaultAssetSnapshot(await repo.readAssetVault(detail('missing'))),{kind:'missing'});
 assert.equal(projectVaultAssetSnapshot(await repo.readAssetVault(detail('nft-000',36))).reason,'future-accounting');
});

test('SQL conceals coordinates and detail allocations; one concealed holding suppresses the whole summary across pages',async t=>{
 const {db,repo}=setup(t);for(let n=0;n<26;n++)bind(db,n);
 createCollection(db,{id:'genesis',kind:'genesis',tranche:1});
 publishCollectionStage(db,{inventoryId:'genesis',stage:{id:'first',type:'whitelist',publishedAt:base,opensAt:base+48*hour,closesAt:base+72*hour,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[key(1)],walletLimit:1}},base+48*hour);
 const op=reserveMint(db,{inventoryId:'genesis',stageId:'first',wallet:key(1),requestKey:'one',now:base+48*hour}).operation;
 fulfillMint(db,{operationId:op.id,assetId:'zz-hidden',proofId:'proof',commitment:inspectOperation(db,op.id).commitment,ticket:999,at:base+49*hour,traits:{model:'Fixture',backdrop:'Fixture',symbol:'Fixture'},finalized:true},base+49*hour);
 const snapshot=await repo.readMemberVault(member(key(1),50));assert.equal(snapshot.assets.find(a=>a.id==='zz-hidden').coords,null);
 const projected=projectMemberVaultSnapshot(snapshot);assert.equal(projected.items.some(a=>a.id==='zz-hidden'),false);assert.equal(projected.summary.reason,'concealed-metadata');assert.equal(projected.summary.assetCount,null);assert.deepEqual(projected.summary.items,[]);
 const concealed=await repo.readAssetVault(detail('zz-hidden',50));assert.equal(concealed.asset.coords,null);assert.deepEqual(concealed.manifests,[]);assert.deepEqual(projectVaultAssetSnapshot(concealed),{kind:'hidden'});
 observeCollectionAsset(db,{sourceId:'reveal',assetId:'zz-hidden',kind:'reveal',at:base+51*hour,finalized:true},base+51*hour);
 assert.equal(projectVaultAssetSnapshot(await repo.readAssetVault(detail('zz-hidden',50))).kind,'hidden');
 assert.equal(projectVaultAssetSnapshot(await repo.readAssetVault(detail('zz-hidden',51))).kind,'ready');
 assert.equal(projectMemberVaultSnapshot(await repo.readMemberVault(member(key(1),51))).summary.status,'complete');
});

test('over-bound rows never yield partial totals; claim scans are disabled for over-bound owners or manifests',async t=>{
 const {db,repo,calls}=setup(t);for(let n=0;n<101;n++){bind(db,n);db.prepare('INSERT INTO vault_claim_totals VALUES(?,?,?)').run('nft-'+String(n).padStart(3,'0'),'demo','1');}
 const large=await repo.readMemberVault(member());assert.equal(large.assets.length,101);assert.deepEqual(large.claims,[]);assert.equal(calls.at(-1).length,5);
 assert.equal(projectMemberVaultSnapshot(large).summary.reason,'asset-bound');
 db.prepare('DELETE FROM vault_claim_totals').run();db.prepare("DELETE FROM vault_observations WHERE asset_id!='nft-000'").run();db.prepare("DELETE FROM vault_assets WHERE id!='nft-000'").run();
 for(let n=0;n<100;n++){
  const id='launch-'+String(n).padStart(3,'0');importMarket(db,{id,symbol:'DEMO',ogSymbol:'OG',activatedAt:at(0),attMint:key(n+10),ogMint:key(4),poolAddress:key(n+110)});
  recordVaultManifest(db,{marketId:id,originalUnits:'402600000'});
 }
 db.prepare('INSERT INTO vault_claim_totals VALUES(?,?,?)').run('nft-000','demo','1');
 const many=await repo.readMemberVault(member());assert.equal(many.manifests.length,101);assert.deepEqual(many.claims,[]);assert.equal(projectMemberVaultSnapshot(many).summary.reason,'manifest-bound');
 const page=projectVaultAssetSnapshot(await repo.readAssetVault(detail('nft-000')));assert.equal(page.value.items.length,25);assert.notEqual(page.value.nextCursor,null);
});

test('projection retains exact BigInt sums and withholds invalid or incomplete accounting',async t=>{
 const {db,repo}=setup(t);bind(db,0);const source=await repo.readMemberVault(member(key(1),49));
 const mutate=fn=>{const value=structuredClone(source);fn(value);return projectMemberVaultSnapshot(value).summary;};
 assert.equal(mutate(s=>s.claims=Array.from({length:10001},()=>({assetId:'nft-000',launchId:'demo',claimed:'0'}))).reason,'claim-bound');
 for(const claimed of ['-1','01','18446744073709551616','1001'])assert.equal(mutate(s=>s.claims=[{assetId:'nft-000',launchId:'demo',claimed}]).reason,'invalid-accounting');
 assert.equal(mutate(s=>s.claims=[{assetId:'someone-else',launchId:'demo',claimed:'0'}]).reason,'invalid-accounting');
 assert.equal(mutate(s=>s.assets[0].coords='{').reason,'invalid-accounting');
 assert.equal(mutate(s=>s.assets[0].latestMs=s.evaluatedAtMs+1).reason,'future-accounting');
 const big=structuredClone(source);big.manifests[0].genesis_units='18446744073709551615';
 big.assets=Array.from({length:100},(_,n)=>({...source.assets[0],id:'big-'+n,coords:JSON.stringify({kind:'genesis',tranche:1,level:1,ordinal:n})}));
 const expected=big.assets.reduce((sum,a)=>sum+BigInt(projectEntitlement(a,big.manifests[0],big.evaluatedAtMs,'0').allocated),0n);
 assert.ok(expected>BigInt(Number.MAX_SAFE_INTEGER));assert.equal(projectMemberVaultSnapshot(big).summary.items[0].allocated,String(expected));
});

test('per-manifest preparation pins Season denominator and original vesting through later clocks and caller mutation',()=>{
 const manifest={id:'season',activated_ms:base,genesis_units:'1000',season_units:'1000000',seasons:JSON.stringify([{id:'s',startsAt:at(0),levels:Array(1000).fill(1)}]),digest:'synthetic'};
 const prepared=prepareVaultManifest(manifest),asset={coords:JSON.stringify({kind:'season',seasonId:'s',slotIndex:0})};
 const early=prepared.project(asset,base+36*hour,'0');assert.equal(early.allocated,'1000');assert.equal(early.vested,'500');
 manifest.season_units='0';manifest.seasons='[]';manifest.activated_ms+=hour;
 const later=prepared.project(asset,base+100*24*hour,'100');assert.equal(later.allocated,'1000');assert.equal(later.claimable,'900');assert.equal(later.activatedAt,at(0));assert.ok(Object.isFrozen(prepared));
});

test('repository rejects byte overflow and captures immutable inputs before the driver await',async t=>{
 const {db}=setup(t);bind(db,0);const baseDriver=createNodeAtomicDriver(db),query=member();
 const repo=createFinancialVaultRepository({...baseDriver,async batch(statements){query.wallet=key(2);query.evaluatedAtMs=0;return baseDriver.batch(statements);}});
 const result=await repo.readMemberVault(query);assert.equal(result.wallet,key(1));assert.equal(result.evaluatedAtMs,base+36*hour);assert.equal(result.assets.length,1);
 const over=createFinancialVaultRepository({async batch(){return [{rows:[{revision:'0',padding:'x'.repeat(2*1024*1024)}]}];}});
 await assert.rejects(over.readMemberVault(member()),e=>e instanceof FinancialVaultReadBoundError&&e.code==='read_byte_bound'&&e.status===503);
 await assert.rejects(repo.readMemberVault({...member(),unexpected:true}),TypeError);
});

test('maximum complete 100-assets by100-manifests snapshot stays at five SQL statements and exact10000 claims',async t=>{
 const {db,repo,calls}=setup(t);
 for(let n=0;n<100;n++)bind(db,n);
 for(let n=0;n<99;n++){
  const id='launch-'+String(n).padStart(3,'0');importMarket(db,{id,symbol:'DEMO',ogSymbol:'OG',activatedAt:at(0),attMint:key(n+10),ogMint:key(4),poolAddress:key(n+110)});
  recordVaultManifest(db,{marketId:id,originalUnits:'402600000'});
 }
 const manifests=db.prepare('SELECT id FROM vault_manifests').all(),assets=db.prepare('SELECT id FROM vault_assets').all(),insert=db.prepare('INSERT INTO vault_claim_totals VALUES(?,?,?)');
 for(const a of assets)for(const m of manifests)insert.run(a.id,m.id,'1');
 const started=performance.now(),snapshot=await repo.readMemberVault(member()),value=projectMemberVaultSnapshot(snapshot),bytes=new TextEncoder().encode(JSON.stringify(snapshot)).length;
 assert.equal(calls.length,1);assert.equal(calls[0].length,5);assert.equal(snapshot.claims.length,10000);assert.ok(bytes<2*1024*1024);
 assert.equal(value.summary.status,'complete');assert.equal(value.summary.assetCount,100);assert.equal(value.summary.items.length,100);
 for(const row of value.summary.items){assert.equal(row.allocated,'100000');assert.equal(row.claimed,'100');assert.equal(row.claimable,'49900');}
 t.diagnostic(JSON.stringify({sqlStatements:5,claims:snapshot.claims.length,snapshotBytes:bytes,elapsedMs:Math.round(performance.now()-started)}));
});
