import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPerformanceScenario,DEFAULT_QA_OWNER} from './scenario.mjs';
import {populateQa} from './populate.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createApp} from '../server/application.mjs';
import {createPerformanceService} from '../performance/leaderboards.mjs';
import {readCoreRewards} from './core-rewards.mjs';
const asOf='2026-11-13T00:00:00.000Z';
test('90-day data is reproducible, bounded, priced contemporaneously and includes outside100/missing-value states',()=>{
 const a=buildPerformanceScenario({asOf,missingPrices:true}),b=buildPerformanceScenario({asOf,missingPrices:true});assert.deepEqual(a,b);assert.equal(a.tokens.length,90);assert.equal(a.participants.length,250);assert.equal(a.rewards.length,22502);assert(JSON.stringify(a).length<10*1024*1024);
 assert.equal(new Set(a.rewards.map(r=>r.id)).size,a.rewards.length);assert.deepEqual([...new Set(a.rewards.map(r=>r.category))].sort(),['earn','nfts','stake']);
 for(const token of a.tokens)for(const obs of token.observations)assert.equal(obs.at,obs.ogObservedAt);
 const service=createPerformanceService(a),board=service.board('airdrops',{wallet:DEFAULT_QA_OWNER});assert.equal(board.items.length,100);assert(board.myRank.rank>100);assert(board.unrankedCount>0);assert(service.profile(DEFAULT_QA_OWNER).nextCursor);assert.equal(service.profile(a.participants.at(-2).wallet).valuationComplete,false);
 assert.throws(()=>buildPerformanceScenario({wallet:'bad',asOf}));assert.throws(()=>buildPerformanceScenario({asOf,participantCount:10001}));
});
test('isolated population refuses overwrite and populates actual paginated APIs without bypassing domain writes',async t=>{
 const parent=mkdtempSync(join(tmpdir(),'10x-qa-test-')),directory=join(parent,'qa-three-month');let db;t.after(()=>{db?.close();assert(parent.startsWith(resolve(tmpdir())+sep));rmSync(parent,{recursive:true,force:true});});
 const report=populateQa({directory,asOf,participantCount:150,mintCountPerSeason:5});assert.equal(report.core.markets,90);assert.equal(report.core.finalizedBoards,90);assert.equal(report.core.recordedAllocations,89);assert.equal(report.core.submissions,90);assert.equal(report.status,'complete');
 const bytes=readFileSync(join(directory,'performance.json'));assert.throws(()=>populateQa({directory,asOf}),/overwrite/);assert.deepEqual(readFileSync(join(directory,'performance.json')),bytes);assert.throws(()=>populateQa({directory:join(parent,'manual-demo'),asOf}),/qa-/);assert.equal(existsSync(join(parent,'manual-demo')),false);
 db=openDatabase(join(directory,'core.sqlite'));const snapshot=JSON.parse(bytes),service=createPerformanceService(snapshot),now=Date.parse(asOf),token='synthetic-qa-api-session';
 assert.deepEqual(snapshot.rewards.filter(r=>r.wallet===report.wallet),readCoreRewards(db,{wallet:report.wallet,asOf}));
 const aggregate=new Map();for(const r of snapshot.rewards.filter(r=>r.wallet===report.wallet)){const a=aggregate.get(r.tokenId)??{awarded:0n,claimable:0n};a.awarded+=BigInt(r.awardedUnits);a.claimable+=BigInt(r.vestedUnits)-BigInt(r.claimedUnits);aggregate.set(r.tokenId,a);}
 for(const row of service.profile(report.wallet,{limit:100}).items){assert.equal(row.awardedUnits,String(aggregate.get(row.tokenId).awarded));assert.equal(row.claimableUnits,String(aggregate.get(row.tokenId).claimable));}
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),report.wallet,'http://localhost',now+600000);
 const app=createApp(db,{clock:()=>now,performanceService:service});
 const get=async path=>{const response=await app(new Request('http://localhost'+path,{headers:{cookie:'tenx_local_session='+token}}));assert.equal(response.status,200,await response.clone().text());const value=await response.json();return value.data??value;};
 const pages=async path=>{const items=[];let cursor=null;do{const page=await get(path+(cursor?'?cursor='+encodeURIComponent(cursor):''));items.push(...page.items);cursor=page.nextCursor;}while(cursor);return items;};
 assert.equal((await pages('/api/v1/markets')).length,90);assert.equal((await pages('/api/v1/collect/me/assets')).length,report.core.ownedAssets);assert.equal((await pages('/api/v1/stake/positions')).length,90);assert.equal((await pages('/api/v1/earn/me')).length,90);assert.equal((await pages('/api/v1/earn/claims')).length,89);
 const board=await get('/api/v1/performance/boards/airdrops?mode=peak&limit=100');assert.equal(board.items.length,100);assert(board.myRank.rank);assert(service.profile(report.wallet).valuationComplete);assert(service.board('airdrops',{wallet:report.examples.outsideTop100.wallet}).myRank.rank>100);
});
