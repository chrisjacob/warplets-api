import { decodeNetworkSnapshot } from './snapshot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from '../sqliteTestDb';
import { acceptedQuote, decimalScale, importWalletValue, neynarRead, NATIVE_ASSET, priceBalances, type WalletEnv } from './wallets';
import { publishSnapshot } from './store';
import { buildNetworkDashboard } from './aggregate';
import { parseNetworkFilters } from '../../../shared/network/model';
import { readNetworkMembers } from './members';
const databases: DatabaseSync[]=[];
afterEach(()=>{vi.unstubAllGlobals();for(const db of databases.splice(0))db.close();});
const address=(n:number)=>`0x${n.toString(16).padStart(40,'0')}`;
const token=`eip155:8453/erc20:${address(999)}`;
const units=(dollars:number)=>(BigInt(dollars)*100_000_000n).toString();
function fixture(){
  const db=new DatabaseSync(':memory:');databases.push(db);
  for(const file of ['0095_network.sql','0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql','0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql','0102_network_warplet_holders.sql','0103_network_warplet_images.sql'])db.exec(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8'));
  for(let fid=1;fid<=5;fid++){
    db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,?)').run(fid,Date.now());
    db.prepare('INSERT INTO network_wallet_associations(fid,observed_at) VALUES(?,?)').run(fid,Date.now());
    db.prepare("INSERT INTO network_profiles(fid,country,location_status,token_status,opt_in_status,observed_at) VALUES(?,?,'known','unavailable','opted_in',?)").run(fid,fid===1||fid===3?'AU':'US',Date.now());
  }
  for(const [fid,wallet] of [[1,1],[1,2],[2,3],[3,3],[4,4]])db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(fid,address(wallet),Date.now());
  const values=(wallet:number,eth:number,stable:number)=>{
    const positions=[{id:NATIVE_ASSET,symbol:'ETH',name:'Ethereum',usdUnits:units(eth)},{id:token,symbol:'USD',name:'Dollar',usdUnits:units(stable)}];
    db.prepare('INSERT INTO network_wallet_values(address,usd_units,positions,excluded,observed_at,price_oldest_at) VALUES(?,?,?,?,?,?)').run(address(wallet),units(eth+stable),JSON.stringify(positions),0,Date.now(),Date.now());
  };
  values(1,40,60);values(2,30,0);values(3,90,0);
  return {db,env:{WARPLETS:sqliteD1(db),NEYNAR_API_KEY:'test',NETWORK_WALLET_CREDITS:'10000'} as WalletEnv};
}
describe('wallet valuation and top holdings',()=>{
  it('uses fixed-point quantities and independently timestamped high-confidence quotes',()=>{
    expect(decimalScale('1.23456789',8)).toBe(123456789n);expect(decimalScale('1e-12',24)).toBe(1_000_000_000_000n);
    const now=Date.now(),q={price:1.25,decimals:6,timestamp:Math.floor(now/1000),confidence:.99};
    const balances=[{network:'base',address:address(999),balance:'2000000',decimals:6,price_usd:'999999999999'}];
    expect(priceBalances(balances,new Map([[token,q]]),now).usdUnits).toBe('250000000');
    expect(acceptedQuote({...q,confidence:.5},token,now)).toBeNull();
    expect(acceptedQuote({...q,timestamp:Math.floor(now/1000)-10000},token,now)).toBeNull();
    expect(acceptedQuote({...q,timestamp:Math.floor(now/1000)+10000},token,now)).toBeNull();
    expect(priceBalances(balances,new Map([[token,{...q,decimals:18}]]),now)).toMatchObject({usdUnits:'0',excluded:1});
    expect(()=>priceBalances([...balances,...balances],new Map([[token,q]]),now)).toThrow('Duplicate');
  });
  it('deduplicates shared wallets globally and combines a token across every verified wallet for its top holding',async()=>{
    const {env}=fixture();const snapshot=await publishSnapshot(env.WARPLETS,true);
    const all=buildNetworkDashboard(snapshot,parseNetworkFilters(new URLSearchParams()));
    expect(all.economics).toMatchObject({status:'partial',totalUsd:'220.00000000',attributedUsd:'130.00000000',unallocatedUsd:'90.00000000',averageUsd:'130.00000000',medianUsd:'130.00000000',measuredAccounts:1});
    expect(all.economics.coverage).toMatchObject({expectedWallets:4,measuredWallets:3});
    const held=buildNetworkDashboard(snapshot,parseNetworkFilters(new URLSearchParams({held:NATIVE_ASSET})));
    expect(held.population).toBe(1);expect(held.economics.totalUsd).toBe('130.00000000');
    const au=buildNetworkDashboard(snapshot,parseNetworkFilters(new URLSearchParams('country=AU')));
    expect(au.economics.totalUsd).toBe('130.00000000');expect(au.economics.unallocatedUsd).toBe('0.00000000');
    expect((await readNetworkMembers(env.WARPLETS,new URLSearchParams({held:NATIVE_ASSET}))).members.map(m=>m.fid)).toEqual([1]);
  });
  it('never spends on excluded members and keeps the last OG FID distinct from the first new FID',async()=>{
    const {db,env}=fixture();const {NETWORK_OG_LAST_FID}=await import('../../../shared/network/model');
    db.exec("UPDATE network_profiles SET opt_in_status='opted_out'");
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    expect((await importWalletValue(env)).status).toBe('complete');expect(fetcher).not.toHaveBeenCalled();
    for(const fid of [NETWORK_OG_LAST_FID,NETWORK_OG_LAST_FID+1]){
      db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,1)').run(fid);
      db.prepare("INSERT INTO network_profiles(fid,location_status,token_status,opt_in_status,observed_at) VALUES(?,'unknown','none','opted_in',1)").run(fid);
    }
    const snapshot=await publishSnapshot(env.WARPLETS,true);
    expect(snapshot?.population).toBe(2);expect(snapshot?.cells.map(c=>c.ogMember).sort()).toEqual([false,true]);
  });
  it('keeps pending wallets, ambiguous wallets and accounts without wallets distinct',async()=>{
    const {env}=fixture();const snapshot=await publishSnapshot(env.WARPLETS,true);
    for(const [held,fids] of [['unavailable',[4]],['ambiguous',[2,3]],['none',[5]]] as const){
      const params=new URLSearchParams({held});expect((await readNetworkMembers(env.WARPLETS,params)).members.map(m=>m.fid)).toEqual(fids);
      expect(buildNetworkDashboard(snapshot,parseNetworkFilters(params)).population).toBe(fids.length);
    }
    expect(snapshot?.adoption).toEqual([]);
  });
  it('does not assign a top holding or complete-portfolio average until every wallet is retrieved',async()=>{
    const {env,db}=fixture();db.prepare('DELETE FROM network_wallet_values WHERE address=?').run(address(2));
    const snapshot=await publishSnapshot(env.WARPLETS,true);const all=buildNetworkDashboard(snapshot,parseNetworkFilters(new URLSearchParams()));
    expect(all.economics.averageUsd).toBeNull();expect(all.economics.totalUsd).toBe('190.00000000');
    expect((await readNetworkMembers(env.WARPLETS,new URLSearchParams({held:NATIVE_ASSET}))).total).toBe(0);
  });
  it('preserves the last valid wallet value if pagination fails',async()=>{
    const {env,db}=fixture();db.prepare('DELETE FROM network_wallet_links WHERE address=?').run(address(4));
    db.prepare('UPDATE network_wallet_values SET observed_at=0 WHERE address=?').run(address(1));
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({balances:[],next:{cursor:'repeated'}})));
    expect((await importWalletValue(env)).status).toBe('retry');
    expect(db.prepare('SELECT usd_units FROM network_wallet_values WHERE address=?').get(address(1))?.usd_units).toBe(units(100));
  });
  it('stops before provider calls when the credit cap would be exceeded',async()=>{
    const {env,db}=fixture();env.NETWORK_WALLET_CREDITS='1';const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    await expect(importWalletValue(env)).rejects.toThrow('credit cap');expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) n FROM network_wallet_retries').get()?.n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM network_leases WHERE name='wallet-values'").get()?.n).toBe(0);
  });
  it('cannot raise the confirmed 250,000-credit Network cap through configuration',async()=>{
    const {env,db}=fixture();env.NETWORK_WALLET_CREDITS='10000000';
    db.prepare('INSERT INTO network_credit_budgets(month,reserved) VALUES(?,?)').run(new Date().toISOString().slice(0,7),249999);
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    await expect(neynarRead(env,'/v2/farcaster/user/bulk?fids=1',2)).rejects.toThrow('credit cap');
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare('SELECT reserved FROM network_credit_budgets').get()?.reserved).toBe(249999);
  });
  it('refreshes prices without rewriting balances or changing older published snapshots',async()=>{
    const {env,db}=fixture();
    const initial=await publishSnapshot(env.WARPLETS,true);const before=db.prepare('SELECT positions,observed_at FROM network_wallet_values WHERE address=?').get(address(1));
    const positions=[{id:NATIVE_ASSET,symbol:'ETH',name:'Ethereum',balance:'1000000000000000000',decimals:18,priceUsd:'40',usdUnits:units(40),quotedAt:Date.now()}];
    db.prepare('UPDATE network_wallet_values SET positions=?,usd_units=? WHERE address=?').run(JSON.stringify(positions),units(40),address(1));
    db.prepare('INSERT INTO network_asset_prices VALUES(?,?,?)').run(NATIVE_ASSET,JSON.stringify({price:50,confidence:.99,timestamp:Math.floor(Date.now()/1000)}),Date.now());
    const newer=await publishSnapshot(env.WARPLETS,true);
    expect(buildNetworkDashboard(newer,parseNetworkFilters(new URLSearchParams())).economics.totalUsd).toBe('170.00000000');
    expect(buildNetworkDashboard(await decodeNetworkSnapshot(String(db.prepare('SELECT payload FROM network_snapshots WHERE id=?').get(initial!.id)?.payload)),parseNetworkFilters(new URLSearchParams())).economics.totalUsd).toBe('220.00000000');
    expect(db.prepare('SELECT observed_at FROM network_wallet_values WHERE address=?').get(address(1))?.observed_at).toBe(before?.observed_at);
    expect(db.prepare('SELECT usd_units FROM network_wallet_values WHERE address=?').get(address(1))?.usd_units).toBe(units(40));
  });
});
