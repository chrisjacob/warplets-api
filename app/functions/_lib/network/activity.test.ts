import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {networkManMonths,previousMonth} from '../../../shared/network/activity';
import {parseNetworkFilters,type NetworkCell,type NetworkSnapshot} from '../../../shared/network/model';
import {buildNetworkDashboard} from './aggregate';
import {activityEvidence,importNetworkActivity} from './activity';
import {sqliteD1} from '../sqliteTestDb';
const now=Date.parse('2026-12-16T00:00:00Z');
const base:NetworkCell={country:'AU',location:'known',token:null,tokenStatus:'none',vote:'opted_in',acceptedDay:'2026-10-17',count:1};
const epoch=Date.UTC(2021,0,1);
const msg=(at:string,fid=7,type='MESSAGE_TYPE_CAST_ADD')=>({hash:'0x'+'a'.repeat(40),data:{fid,type,network:'FARCASTER_NETWORK_MAINNET',timestamp:(Date.parse(at)-epoch)/1000}});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('Man-Months',()=>{
 it('deduplicates months, counts signing, excludes earlier/future activity and preserves gaps',()=>{
  const result=networkManMonths([{...base,count:2,activityMonths:['2026-09','2026-10','2026-11','2026-11','2027-01']}],now);
  expect(result.total).toBe(4);
  expect(result.months.map(m=>[m.month,m.active,m.joined,m.retained,m.unresolved])).toEqual([['2026-10',2,2,0,0],['2026-11',2,0,2,0],['2026-12',0,0,0,2]]);
  expect(result.partial).toBe(true);
 });
 it('partitions OG and new joiners, retaining either group in later active months',()=>{
  const result=networkManMonths([{...base,ogMember:true,count:3,activityMonths:['2026-11']},{...base,ogMember:false,count:2,acceptedDay:'2026-11-01',activityMonths:['2026-12']}],now);
  expect(result.months.map(m=>[m.og,m.newMembers,m.continuing,m.active])).toEqual([[3,0,0,3],[0,2,3,5],[0,0,2,2]]);
  expect(result.months.every(m=>m.og+m.newMembers+m.continuing===m.active)).toBe(true);
 });
 it('handles UTC month boundaries and December/January correctly',()=>{
  expect(previousMonth('2027-01')).toBe('2026-12');
  const result=networkManMonths([{...base,acceptedDay:'2026-10-31',activityMonths:['2026-11']}],Date.parse('2026-10-31T23:59:59Z'));
  expect(result.total).toBe(1);expect(result.months).toHaveLength(1);
 });
 it('does not invent signing dates for official confirmations or historical activity',()=>{
  expect(networkManMonths([{...base,acceptedDay:null}],now)).toMatchObject({total:0,undatedMembers:1,partial:true});
  expect(networkManMonths([],now,false).total).toBeNull();
  expect(networkManMonths([{...base,activityMonths:['2026-11']}],Date.parse('2026-10-20')).total).toBe(1);
 });
 it('cross-filters the activity counter with the same country/token/holding cells',()=>{
  const s:NetworkSnapshot={id:'snapshot',createdAt:now,cohort:'acceptance-signers',chain:'Base',scan:{fromBlock:1,throughBlock:2,targetBlock:2,complete:true},population:3,profilesObserved:3,profileOldestAt:now,tokens:[],adoption:[],cells:[{...base,count:2,activityMonths:['2026-11']},{...base,country:'US',activityMonths:['2026-11','2026-12']}]};
  const result=buildNetworkDashboard(s,{...parseNetworkFilters(new URLSearchParams()),country:'AU'});
  expect(result.population).toBe(2);expect(result.manMonths?.total).toBe(4);
 });
 it('validates FID, chain, timestamp, message type and after-signing evidence',()=>{
  const acceptedAt=Date.parse('2026-10-17');
  expect(activityEvidence(msg('2026-11-01'),7,acceptedAt,'2026-11',['MESSAGE_TYPE_CAST_ADD'],now)).toMatchObject({type:'MESSAGE_TYPE_CAST_ADD'});
  expect(activityEvidence(msg('2026-10-16'),7,acceptedAt,'2026-10',['MESSAGE_TYPE_CAST_ADD'],now)).toBeNull();
  expect(activityEvidence(msg('2027-01-01'),7,acceptedAt,'2027-01',['MESSAGE_TYPE_CAST_ADD'],now)).toBeNull();
  expect(()=>activityEvidence(msg('2026-11-01',8),7,acceptedAt,'2026-11',['MESSAGE_TYPE_CAST_ADD'],now)).toThrow();
  expect(()=>activityEvidence(msg('2026-11-01',7,'WALLET_TRANSFER'),7,acceptedAt,'2026-11',['MESSAGE_TYPE_CAST_ADD'],now)).toThrow();
 });
 it('saves one positive month, skips signing-month API reads, and respects the shared cap',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
   for(const file of ['0095_network.sql','0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql','0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql','0102_network_warplet_holders.sql','0103_network_warplet_images.sql'])db.exec(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8'));
   db.prepare('INSERT INTO network_events VALUES(?,?,?,?,?,?,?,?)').run('tx',1,1,'block',Date.parse('2026-10-17'),7,'address',now);
   db.exec("INSERT INTO network_profiles(fid,location_status,token_status,opt_in_status,observed_at) VALUES(7,'unknown','none','opted_in',1)");
   const env={WARPLETS:sqliteD1(db),NEYNAR_API_KEY:'test',NETWORK_WALLET_CREDITS:'200'};
   vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20'));
   const fetcher=vi.fn(async()=>Response.json({messages:[msg('2026-11-01')],nextPageToken:''}));vi.stubGlobal('fetch',fetcher);
   expect((await importNetworkActivity(env)).status).toBe('complete');expect(fetcher).not.toHaveBeenCalled();
   vi.setSystemTime(new Date('2026-11-05'));
   expect((await importNetworkActivity(env)).status).toBe('observed');
   expect((await importNetworkActivity(env)).status).toBe('complete');expect(fetcher).toHaveBeenCalledTimes(1);
   expect(db.prepare('SELECT fid,month FROM network_activity_months').all()).toEqual([{fid:7,month:'2026-11'}]);
   db.prepare('DELETE FROM network_activity_months').run();
   await expect(importNetworkActivity(env)).rejects.toThrow('credit cap');expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{db.close();}
 });
});
