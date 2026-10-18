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
  for (const file of ['0095_network.sql', '0096_network_members.sql','0097_network_wallets.sql']) db.exec(readFileSync(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8'));
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
    expect(first.members[0]).not.toHaveProperty('wallet');
  });
  it('filters small public groups without hiding profiles and searches usernames, display names and FIDs', async () => {
    const { d1 } = fixture();
    for (const params of ['country=AU', 'q=%40user1&country=AU', 'q=Member+1&country=AU', 'q=1&country=AU', 'token=none&country=AU']) expect((await readNetworkMembers(d1, new URLSearchParams(params))).members.map(m => m.fid)).toEqual([1]);
    expect((await readNetworkMembers(d1, new URLSearchParams('location=unknown'))).total).toBe(0);
    expect((await readNetworkMembers(d1, new URLSearchParams('vote=pending'))).total).toBe(0);
    expect((await readNetworkMembers(d1, new URLSearchParams("q=' OR 1=1 --"))).total).toBe(0);
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
