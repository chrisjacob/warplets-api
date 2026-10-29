import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { NETWORK_ACCEPTANCE_TOPIC, NETWORK_CONTRACT, NETWORK_DEPLOY_BLOCK, NETWORK_TRANSFER_TOPIC, parseNetworkFilters, type NetworkSnapshot } from '../../../shared/network/model';
import { networkCountry, networkAsset, normalizeNetworkProfile } from '../../../shared/network/normalize';
import { buildNetworkDashboard } from './aggregate';
import { decodeAcceptanceLogs } from './source';
import { publishSnapshot, reserveRequest, type NetworkEnv } from './store';
import { advanceNetwork } from './ingest';
import { sqliteD1 } from '../sqliteTestDb';
const hash = `0x${'a'.repeat(64)}`, tx = `0x${'b'.repeat(64)}`, address = `0x${'1'.repeat(40)}`;
const word = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
function events(fid = 42) {
  const base = { address: NETWORK_CONTRACT, blockNumber: `0x${(NETWORK_DEPLOY_BLOCK + 1).toString(16)}`, blockHash: hash, blockTimestamp: '0x6acfc5a7', transactionHash: tx, data: '0x' };
  const recipient = `0x${'0'.repeat(24)}${address.slice(2)}`;
  return [{ ...base, topics: [NETWORK_TRANSFER_TOPIC, word(0), recipient, word(fid)], logIndex: '0x1' }, { ...base, topics: [NETWORK_ACCEPTANCE_TOPIC, word(fid), recipient], logIndex: '0x2' }];
}
const instances: DatabaseSync[] = [];
function database() { const db = new DatabaseSync(':memory:'); instances.push(db); for (const migration of ['0095_network.sql', '0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql','0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql','0102_network_warplet_holders.sql','0103_network_warplet_images.sql']) db.exec(readFileSync(new URL(`../../../../migrations/${migration}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), 'utf8')); return { db, env: { WARPLETS: sqliteD1(db), NETWORK_INGEST_ENABLED: 'true', NETWORK_SCAN_BATCH: '1' } as NetworkEnv }; }
afterEach(() => { vi.unstubAllGlobals(); for (const db of instances.splice(0)) db.close(); });
function snapshot(): NetworkSnapshot { return { id: '1730000000000-12345678-1234-1234-1234-123456789abc', createdAt: Date.now(), cohort: 'acceptance-signers', chain: 'Base', scan: { fromBlock: 1, throughBlock: 2, targetBlock: 2, complete: true }, population: 100, profilesObserved: 80, profileOldestAt: Date.now(), tokens: [{ id: 'eip155:8453/erc20:0x' + 'a'.repeat(40), name: 'Example', symbol: 'EX' }], adoption: [], cells: [
  { country: 'US', location: 'known', token: null, tokenStatus: 'none', vote: 'opted_in', acceptedDay: '2026-10-16', count: 60 },
  { country: 'AU', location: 'known', token: null, tokenStatus: 'none', vote: 'opted_out', acceptedDay: '2026-10-17', count: 5 },
  { country: null, location: 'unknown', token: null, tokenStatus: 'unavailable', vote: 'pending', acceptedDay: '2026-10-17', count: 15 },
  { country: null, location: 'unavailable', token: null, tokenStatus: 'unavailable', vote: 'unavailable', acceptedDay: '2026-10-17', count: 20 },
] }; }
const filters = () => parseNetworkFilters(new URLSearchParams());
describe('signer event evidence', () => {
  it('pairs acceptance and original mint, preserving chain provenance', () => { const result = decodeAcceptanceLogs(events()); expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ fid: 42, recipient: address, blockHash: hash, tx }); expect(result.events[0].at).toBe(1792001447000); });
  it('does not accept NFT transfers or assign their new owners', () => { expect(decodeAcceptanceLogs([events()[0]]).events).toEqual([]); const input = events(); input[0].topics[1] = word(99); expect(() => decodeAcceptanceLogs(input)).toThrow('original mint'); });
  it('rejects mismatched receipt/token data and removed events', () => { const input = events(); input[0].topics[3] = word(77); expect(() => decodeAcceptanceLogs(input)).toThrow(); expect(decodeAcceptanceLogs(events().map(e => ({ ...e, removed: true }))).events).toEqual([]); });
});
describe('profile semantics', () => {
  it('only assigns explicit countries and canonical assets', () => { expect(networkCountry('Sydney, Australia')).toBe('AU'); expect(networkCountry('London')).toBeNull(); expect(networkCountry('Earth')).toBeNull(); expect(networkAsset('USDC')).toBeNull(); expect(networkAsset('eip155:8453/erc20:0x' + 'A'.repeat(40))).toBe('eip155:8453/erc20:0x' + 'a'.repeat(40)); });
  it('distinguishes cleared, absent and mismatched identity fields', () => { const payload = { result: { user: { fid: 3, profile: { profileToken: { tokenUri: '' } }, viewerContext: { optInStatus: 'moderated_out' } } } }; expect(normalizeNetworkProfile(payload, 3, 1)).toMatchObject({ tokenStatus: 'none', vote: 'moderated_out', locationStatus: 'unknown' }); expect(normalizeNetworkProfile({ result: { user: { fid: 3, profile: {} } } }, 3, 1).tokenStatus).toBe('unavailable'); expect(() => normalizeNetworkProfile(payload, 4, 1)).toThrow(); });
});
describe('cross-filtered public statistics', () => {
  it('keeps pending profile retrieval separate from unknown geography', () => { const result = buildNetworkDashboard(snapshot(), filters()); expect(result.population).toBe(100); expect(result.coverage).toMatchObject({ known: 65, unknown: 15, unavailable: 20, observed: 80 }); expect(result.adoption.at(-1)?.count).toBe(100); });
  it('uses one cohort for map, leaderboard, current status and adoption', () => { const f = { ...filters(), location: 'unknown' as const }; const result = buildNetworkDashboard(snapshot(), f); expect(result.population).toBe(15); expect(result.countries).toHaveLength(1); expect(result.countries[0].id).toBe('UNKNOWN'); expect(result.adoption.at(-1)?.count).toBe(15); expect(result.votes.find(v => v.id === 'pending')?.count).toBe(15); });
  it('shows public profile statistics for small groups, including direct filters', () => { const result = buildNetworkDashboard(snapshot(), { ...filters(), country: 'AU' }); expect(result.suppressed).toBe(false); expect(result.population).toBe(5); expect(result.countries[0].population).toBe(5); expect(result.adoption.at(-1)?.count).toBe(5); });
  it('does not present unavailable economics, activity or an absent snapshot as zero', () => { const result = buildNetworkDashboard(null, filters()); expect(result.population).toBeNull(); expect(result.coverage.known).toBeNull(); expect(result.economics.status).toBe('unavailable'); expect(result.activity.status).toBe('unavailable'); });
  it('does not backdate official confirmations without an onchain timestamp', () => { const s = snapshot(); s.cells = s.cells.map(c => ({ ...c, acceptedDay: null })); expect(buildNetworkDashboard(s, filters()).adoption).toEqual([]); });
  it('validates filters and preserves token chain identity', () => { expect(() => parseNetworkFilters(new URLSearchParams('country=DROP TABLE'))).toThrow(); expect(() => parseNetworkFilters(new URLSearchParams('vote=no'))).toThrow(); expect(parseNetworkFilters(new URLSearchParams('token=none')).tokens).toEqual(['none']); });
});
describe('durable storage and bounded ingestion', () => {
  it('reserves attempts atomically and stops at the combined provider budget', async () => { const { env } = database(); env.NETWORK_REQUESTS_PER_DAY = '1'; await reserveRequest(env, 'base'); await expect(reserveRequest(env, 'official-client')).rejects.toThrow('budget'); });
  it('backfills missing raw locations for unknown countries before stale known profiles, without refetching observed blanks',async()=>{
    const {env,db}=database(),now=Date.now();env.NETWORK_PROFILE_BATCH='1';
    db.prepare("INSERT INTO network_sync VALUES('candidate_refresh',?,?)").run(JSON.stringify(now),now);
    for(const fid of [1,2,3,4])db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,?)').run(fid,now);
    // A routine stale profile, two legacy unknowns (one with mismatched raw
    // observation), and a recent genuine blank that must not re-enter the queue.
    for(const [fid,country,at] of [[1,'AU',now-2*86400000],[2,null,now],[3,null,now],[4,null,now]])db.prepare("INSERT INTO network_profiles(fid,country,location_status,token_status,opt_in_status,observed_at) VALUES(?,?,'unknown','none','opted_in',?)").run(fid,country,at);
    db.prepare("INSERT INTO network_profile_locations(fid,description,observed_at) VALUES(1,'Sydney, Australia',?)").run(now-2*86400000);
    db.prepare("INSERT INTO network_profile_locations(fid,description,observed_at) VALUES(3,'Old text',?)").run(now-1);
    db.prepare("INSERT INTO network_profile_locations(fid,description,observed_at) VALUES(4,'',?)").run(now);
    const requested:number[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      const fid=Number(new URL(url).searchParams.get('fid'));requested.push(fid);
      return Response.json({result:{user:{fid,profile:{location:{description:fid===2?'Sydney, Australia':''}},viewerContext:{optInStatus:'opted_in'}}}});
    }));
    await advanceNetwork(env,{locationBackfillOnly:true});
    expect(requested).toEqual([2]);
    expect(db.prepare('SELECT description,country FROM network_profile_locations WHERE fid=2').get()).toMatchObject({description:'Sydney, Australia',country:'AU'});
    await advanceNetwork(env,{locationBackfillOnly:true});
    expect(requested).toEqual([2,3]);
    await advanceNetwork(env,{locationBackfillOnly:true});
    expect(requested).toEqual([2,3]);
    await advanceNetwork(env,{profilesOnly:true});
    expect(requested).toEqual([2,3,1]);
    await advanceNetwork(env,{profilesOnly:true});
    expect(requested).toEqual([2,3,1]);
  });
  it('caps the higher combined daily allowance without weakening the monthly budget',async()=>{
    const {env,db}=database();env.NETWORK_REQUESTS_PER_DAY='9999999';
    db.prepare('INSERT INTO network_budgets VALUES(?,?,?)').run(new Date().toISOString().slice(0,10),'official-client',249999);
    await reserveRequest(env,'alchemy-base');
    await expect(reserveRequest(env,'official-client')).rejects.toThrow('budget');
    expect(db.prepare('SELECT SUM(attempts) n FROM network_budgets').get()?.n).toBe(250000);
  });
  it('does not publish duplicate snapshots while location backfill has no work',async()=>{
    const {env,db}=database();
    for(let i=0;i<2;i++)expect(await advanceNetwork(env,{locationBackfillOnly:true,publish:true})).toMatchObject({status:'advanced',profilesSaved:0,snapshot:null});
    expect(db.prepare('SELECT COUNT(*) n FROM network_snapshots').get()?.n).toBe(0);
  });
  it('does not publish duplicate snapshots while location backfill has no work',async()=>{
    const {env,db}=database();
    for(let i=0;i<2;i++)expect(await advanceNetwork(env,{locationBackfillOnly:true,publish:true})).toMatchObject({status:'advanced',profilesSaved:0,snapshot:null});
    expect(db.prepare('SELECT COUNT(*) n FROM network_snapshots').get()?.n).toBe(0);
  });
  it('has no side effects while disabled', async () => { const { env, db } = database(); env.NETWORK_INGEST_ENABLED = 'false'; expect(await advanceNetwork(env)).toEqual({ status: 'disabled' }); expect(db.prepare('SELECT COUNT(*) AS n FROM network_budgets').get()?.n).toBe(0); });
  it('replays orphaned events and invalidates affected historical snapshots on a reorg', async () => {
    const { env, db } = database(), block = NETWORK_DEPLOY_BLOCK + 49;
    db.prepare('INSERT INTO network_events VALUES(?,?,?,?,?,?,?,?)').run(tx, 2, block, 'old', 1792001447000, 42, address, Date.now());
    db.prepare("INSERT INTO network_sync VALUES('scan',?,?)").run(JSON.stringify({ block, hash: 'old', target: block + 100 }), Date.now());
    await publishSnapshot(env.WARPLETS, true);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { const r = JSON.parse(String(init.body)); return Response.json({ result: r.method === 'eth_blockNumber' ? `0x${(block + 200).toString(16)}` : r.method === 'eth_getLogs' ? [] : { hash, timestamp: '0x6acfc5a7' } }); }));
    await advanceNetwork(env, { scanOnly: true, publish: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM network_events').get()?.n).toBe(0);
    const rows = db.prepare('SELECT payload FROM network_snapshots').all();
    expect(rows).toHaveLength(1); expect(JSON.parse(String(rows[0].payload)).population).toBe(0);
  });
  it('never counts candidates alone, or treats opt-outs/moderation as acceptance', async () => {
    const { env, db } = database();
    for (const fid of [3, 4, 5]) db.prepare("INSERT INTO network_candidates VALUES(?,?,'tracker')").run(fid, Date.now());
    db.prepare("INSERT INTO network_sync VALUES('candidate_refresh',?,?)").run(JSON.stringify(Date.now()), Date.now());
    expect((await publishSnapshot(env.WARPLETS, true))?.population).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { const fid = Number(new URL(url).searchParams.get('fid')); return Response.json({ result: { user: { fid, profile: {}, viewerContext: { optInStatus: fid === 3 ? 'opted_in' : fid === 4 ? 'opted_out' : 'moderated_out' } } } }); }));
    await advanceNetwork(env, { profilesOnly: true, publish: true });
    expect(db.prepare('SELECT fid FROM network_confirmed').all()).toEqual([{ fid: 3 }]);
    const s = JSON.parse(String(db.prepare('SELECT payload FROM network_snapshots ORDER BY created_at DESC LIMIT 1').get()?.payload));
    expect(s.population).toBe(1); expect(s.adoption).toEqual([]); expect(s.sources.candidatesObserved).toBe(3);
  });
  it('replays do not duplicate FIDs and publication freezes the snapshot', async () => {
    const { env, db } = database();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { const request = init?.body ? JSON.parse(String(init.body)) : null; let result: unknown;
      if (request?.method === 'eth_blockNumber') result = `0x${(NETWORK_DEPLOY_BLOCK + 200).toString(16)}`;
      else if (request?.method === 'eth_getLogs') result = events();
      else if (request?.method === 'eth_getBlockByNumber') result = { hash, timestamp: '0x6acfc5a7' };
      else return Response.json({ result: { user: { fid: 42, profile: { location: { description: 'Sydney, Australia' } }, viewerContext: { optInStatus: 'opted_in' } } } });
      return Response.json({ jsonrpc: '2.0', id: 1, result }); });
    vi.stubGlobal('fetch', fetcher);
    await advanceNetwork(env, { publish: true, scanOnly: true });
    expect(db.prepare('SELECT COUNT(DISTINCT fid) AS n FROM network_events').get()?.n).toBe(1);
    const first = db.prepare('SELECT payload FROM network_snapshots ORDER BY created_at LIMIT 1').get()?.payload;
    expect(JSON.parse(String(first)).profilesObserved).toBe(0);
    await publishSnapshot(env.WARPLETS, true);
    expect(db.prepare('SELECT payload FROM network_snapshots ORDER BY created_at LIMIT 1').get()?.payload).toBe(first);
  });
});
