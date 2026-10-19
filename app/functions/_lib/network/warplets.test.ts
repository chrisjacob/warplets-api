import {afterEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sqliteD1} from '../sqliteTestDb';
import {refreshNetworkWarplets} from './warplets';
import {publishSnapshot} from './store';
import {readNetworkMembers} from './members';
import {buildNetworkDashboard} from './aggregate';
import {parseNetworkFilters,validateNetworkParams} from '../../../shared/network/model';
const instances:DatabaseSync[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const db of instances.splice(0))db.close();});
const wallet=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
function fixture(){
 const db=new DatabaseSync(':memory:');instances.push(db);
 for(const file of ['0095_network.sql','0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql','0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql','0102_network_warplet_holders.sql'])db.exec(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8'));
 db.exec(`CREATE TABLE warplets_metadata(token_id INTEGER PRIMARY KEY,warplet_wallet TEXT,fid_value INTEGER);
 CREATE TABLE warplet_market_state(token_id INTEGER PRIMARY KEY,owner_wallet TEXT,owner_fid INTEGER,owner_checked_at TEXT,owner_event_at TEXT);
 CREATE TABLE wallet_farcaster_links(wallet TEXT,fid INTEGER);`);
 for(let n=1;n<=8;n++)db.prepare('INSERT INTO warplets_metadata VALUES(?,?,?)').run(n,wallet(n),n);
 for(let n=1;n<=9;n++)db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,1)').run(n);
 return{db,d1:sqliteD1(db)};
}
describe('saved 10X Warplet ownership',()=>{
 it('uses current transfers, preserves untouched allocations, excludes burns and ambiguous wallets without provider calls',async()=>{
  const{db,d1}=fixture();const fetcher=vi.fn(()=>{throw Error('No provider calls allowed');});vi.stubGlobal('fetch',fetcher);
  // Transferred token: original FID 1 must lose it, buyer FID 9 receives it.
  db.prepare('INSERT INTO warplet_market_state VALUES(?,?,?,?,?)').run(1,wallet(9),9,'2026-10-01T00:00:00Z',null);
  // A buyer with no recorded owner_fid is mapped by existing verified links.
  db.prepare('INSERT INTO warplet_market_state VALUES(?,?,?,?,?)').run(2,wallet(9),null,null,'2026-10-02T00:00:00Z');
  db.prepare('INSERT INTO network_wallet_links VALUES(?,?,1)').run(9,wallet(9));
  // Explicit burn and observed unavailable current owner never fall back.
  db.prepare('INSERT INTO warplet_market_state VALUES(?,?,?,?,?)').run(3,wallet(0),null,null,'2026-10-02T00:00:00Z');
  db.prepare('INSERT INTO warplet_market_state VALUES(?,?,?,?,?)').run(4,null,null,'2026-10-02T00:00:00Z',null);
  // Conflicting cached identity for original wallet stays unallocated.
  db.prepare('INSERT INTO wallet_farcaster_links VALUES(?,?)').run(wallet(5),50);
  // A listing-only row has no ownership observation: keep the allocation.
  db.prepare('INSERT INTO warplet_market_state VALUES(?,?,?,?,?)').run(6,null,null,null,null);
  const result=await refreshNetworkWarplets(d1);
  expect([...result.holders].sort((a,b)=>a-b)).toEqual([6,7,8,9]);
  expect(db.prepare('SELECT token_count FROM network_warplet_holders WHERE fid=9').get()?.token_count).toBe(2);
  expect(result.summary).toMatchObject({resolvedTokens:5,unresolvedTokens:3,holderFids:4});
  expect(fetcher).not.toHaveBeenCalled();
  const snapshot=await publishSnapshot(d1,true);expect(snapshot).not.toBeNull();
  const filters=parseNetworkFilters(new URLSearchParams('warplet=holders'));
  const selected=buildNetworkDashboard(snapshot,filters),members=await readNetworkMembers(d1,new URLSearchParams('warplet=holders'));
  expect(selected.population).toBe(4);expect(members.total).toBe(4);expect(members.members.map(m=>m.fid)).toEqual([6,7,8,9]);
  expect(selected.coverage.unavailable).toBe(4);expect(selected.countries[0].population).toBe(4);
  // A later transfer removes FID 8 and adds a token to an existing holder once.
  db.prepare('INSERT INTO warplet_market_state VALUES(?,?,?,?,?)').run(8,wallet(9),9,null,'2026-10-03T00:00:00Z');
  const newer=await publishSnapshot(d1,true);
  expect(buildNetworkDashboard(newer,filters).population).toBe(3);
  expect(buildNetworkDashboard(snapshot,filters).population).toBe(4);
  expect((await readNetworkMembers(d1,new URLSearchParams('warplet=holders&q=8'))).total).toBe(0);
 });
 it('rejects invalid selections and historical holder claims',()=>{
  for(const q of ['warplet=no','warplet=holders&warplet=all','warplet=holders&snapshot=1234567890123-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']){
    expect(()=>{const params=new URLSearchParams(q);validateNetworkParams(params);parseNetworkFilters(params);}).toThrow();
  }
 });
});
