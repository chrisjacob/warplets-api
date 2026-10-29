import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from '../sqliteTestDb';
import { readNetworkMembers, memberQuery } from './members';
import { networkIdentity, normalizeNetworkProfile } from '../../../shared/network/normalize';
import { saveProfile } from './store';
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  for (const file of ['0095_network.sql', '0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql','0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql','0102_network_warplet_holders.sql','0103_network_warplet_images.sql']) db.exec(readFileSync(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8'));
  for (let fid = 1; fid <= 30; fid++) {
    db.prepare('INSERT INTO network_candidates VALUES(?,?,?)').run(fid, 100, 'tracker');
    db.prepare('INSERT INTO network_member_profiles VALUES(?,?,?,?,?,?)').run(fid, `user${fid}`, `Member ${fid}`, 'https://example.com/avatar.png', 100, 'nft-contract-tracker');
    if (fid < 30) db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,?)').run(fid, 100);
    db.prepare("INSERT INTO network_profiles(fid,country,location_status,token_status,opt_in_status,observed_at) VALUES(?,?,'known','none','opted_in',100)").run(fid, fid === 1 ? 'AU' : 'US');
  }
  return { db, d1: sqliteD1(db) };
}
describe('public signer directory', () => {
  it('excludes tracker candidates without acceptance, deduplicates both evidence sources, and pages without overlap', async () => {
    const { db, d1 } = fixture();
    db.prepare("INSERT INTO network_events VALUES('tx',1,1,'hash',100,1,'wallet',100)").run();
    const first = await readNetworkMembers(d1, new URLSearchParams());
    expect(first.total).toBe(29); expect(first.members).toHaveLength(24); expect(first.next).toBe(24);
    const second = await readNetworkMembers(d1, new URLSearchParams(`after=${first.next}`));
    expect(second.members.map(m => m.fid)).toEqual([25, 26, 27, 28, 29]); expect(second.next).toBeNull();
    expect(first.members[0].profileUrl).toBe('https://farcaster.xyz/~/profiles/1');
    expect(first.members[0].wallet).toMatchObject({status:'pending',usd:null});
    expect(first.members[0].location).toBe('Australia');
  });
  it('excludes former and unobserved members across counts, snapshots and wallet coverage',async()=>{
    const {db,d1}=fixture();
    db.exec("UPDATE network_profiles SET opt_in_status='opted_out' WHERE fid=1; UPDATE network_profiles SET opt_in_status='moderated_out' WHERE fid=2; UPDATE network_profiles SET opt_in_status='unavailable' WHERE fid=3");
    const {publishSnapshot}=await import('./store');const snapshot=await publishSnapshot(d1,true);
    expect(snapshot?.population).toBe(26);expect(snapshot?.cells.every(c=>c.vote==='opted_in')).toBe(true);
    expect((await readNetworkMembers(d1,new URLSearchParams())).total).toBe(26);
    expect((await readNetworkMembers(d1,new URLSearchParams('q=1'))).members).toEqual([]);
    expect(snapshot?.wallet?.associationsObserved).toBe(0);
  });
  it('filters small public groups without hiding profiles and searches usernames, display names and FIDs', async () => {
    const { d1 } = fixture();
    for (const params of ['country=AU', 'q=%40user1&country=AU', 'q=Member+1&country=AU', 'q=1&country=AU', 'token=none&country=AU']) expect((await readNetworkMembers(d1, new URLSearchParams(params))).members.map(m => m.fid)).toEqual([1]);
    expect((await readNetworkMembers(d1, new URLSearchParams('location=unknown'))).total).toBe(0);
    expect((await readNetworkMembers(d1, new URLSearchParams('vote=pending'))).total).toBe(0);
    expect((await readNetworkMembers(d1, new URLSearchParams("q=' OR 1=1 --"))).total).toBe(0);
  });
  it('distinguishes complete, partial, pending, empty and shared portfolios, with global ownership checks',async()=>{
    const {db,d1}=fixture();
    const first='0x'+'a'.repeat(40),second='0x'+'b'.repeat(40),third='0x'+'c'.repeat(40),at=Date.now();
    for(const fid of [1,2,3,4])db.prepare('INSERT INTO network_wallet_associations(fid,observed_at) VALUES(?,?)').run(fid,at);
    for(const [fid,address] of [[1,first],[1,second],[2,third],[5,third]])db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(fid,address,at);
    const position={id:'eip155:8453/slip44:60',balance:'1000000000000000000',decimals:18,usdUnits:'100000000',quotedAt:at,symbol:'ETH',name:'Ether',priceUsd:'1'};
    for(const address of [first,third])db.prepare("INSERT INTO network_wallet_values VALUES(?,?,?,?,?,?,?)").run(address,'100000000',JSON.stringify([position]),0,at,at,'alchemy-base+defillama');
    db.prepare('INSERT INTO network_asset_prices VALUES(?,?,?)').run(position.id,JSON.stringify({price:2000,timestamp:Math.floor(at/1000),confidence:1}),at);
    const member=(await readNetworkMembers(d1,new URLSearchParams('country=AU'))).members[0];
    expect(member.wallet).toMatchObject({status:'partial',usd:'2000.00000000',measured:1,expected:2,stale:false});
    const members=(await readNetworkMembers(d1,new URLSearchParams())).members;
    expect(members.find(m=>m.fid===2)?.wallet).toMatchObject({status:'shared',usd:null});
    expect(members.find(m=>m.fid===3)?.wallet).toMatchObject({status:'no-wallet',usd:null});
    expect(members.find(m=>m.fid===6)?.wallet).toMatchObject({status:'pending',usd:null});
    db.prepare('INSERT INTO network_wallet_values VALUES(?,?,?,?,?,?,?)').run(second,'0','[]',0,at,null,'alchemy-base+defillama');
    expect((await readNetworkMembers(d1,new URLSearchParams('country=AU'))).members[0].wallet.status).toBe('measured');
    db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(4,'0x'+'d'.repeat(40),at);
    db.prepare('INSERT INTO network_wallet_values VALUES(?,?,?,?,?,?,?)').run('0x'+'d'.repeat(40),'0','[]',0,at,null,'alchemy-base+defillama');
    expect((await readNetworkMembers(d1,new URLSearchParams('q=4'))).members[0].wallet).toMatchObject({status:'measured',usd:'0.00000000'});
  });
  it('stores unmatched locations as blanks while preserving matched locations',async()=>{
    const {d1,db}=fixture();
    const payload=(description:string)=>({result:{user:{fid:1,profile:{location:{description,placeId:'source-place'}},viewerContext:{optInStatus:'opted_in'}}}});
    await saveProfile(d1,normalizeNetworkProfile(payload('Jammu'),1,200));
    expect(db.prepare('SELECT description,place_id,country FROM network_profile_locations WHERE fid=1').get()).toEqual({description:'',place_id:null,country:null});
    expect((await readNetworkMembers(d1,new URLSearchParams('q=1'))).members[0].location).toBeNull();
    await saveProfile(d1,normalizeNetworkProfile(payload('Sydney, Australia'),1,300));
    expect(db.prepare('SELECT description,country FROM network_profile_locations WHERE fid=1').get()).toEqual({description:'Sydney, Australia',country:'AU'});
  });
  it('rejects bad cursors and historical identity claims', () => {
    for (const query of ['after=-1', 'after=1.5', 'after=NaN', 'country=invalid', 'snapshot=1234567890123-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']) expect(() => memberQuery(new URLSearchParams(query))).toThrow();
  });
  it('normalizes public identities and rejects executable image URLs', async () => {
    expect(networkIdentity('../bad', ' Name ', 'javascript:alert(1)')).toEqual({ username: null, displayName: 'Name', avatarUrl: null });
    expect(networkIdentity('good.eth', null, 'data:image/svg+xml,x').avatarUrl).toBeNull();
    const { d1, db } = fixture();
    await saveProfile(d1, normalizeNetworkProfile({ result: { user: { fid: 1, username: 'newname.eth', displayName: 'New name', pfp: { url: 'https://example.com/new.png' }, profile: {} } } }, 1, 200));
    expect(db.prepare('SELECT username,source FROM network_member_profiles WHERE fid=1').get()).toMatchObject({ username: 'newname.eth', source: 'official-client' });
  });
});
