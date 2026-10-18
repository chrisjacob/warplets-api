import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from '../sqliteTestDb';
import { cachedNetworkResponse } from './cache';
import { refreshNetworkCandidates, advanceNetwork } from './ingest';
import type { NetworkEnv } from './store';
import { NETWORK_CONTRACT, validateNetworkParams } from '../../../shared/network/model';
import { onRequestGet } from '../../api/network/dashboard';
const databases: DatabaseSync[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  for (const file of ['0095_network.sql', '0096_network_members.sql','0097_network_wallets.sql']) db.exec(readFileSync(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8'));
  return { db, env: { WARPLETS: sqliteD1(db), NETWORK_INGEST_ENABLED: 'true' } as NetworkEnv };
}
describe('Network request cost and security', () => {
  it('serves cache hits without repeating the database loader, and separates selections and hosts', async () => {
    const entries = new Map<string, Response>(), pending: Promise<unknown>[] = [];
    vi.stubGlobal('caches', { open: async () => ({ match: async (key: Request) => entries.get(key.url)?.clone(), put: async (key: Request, response: Response) => { entries.set(key.url, response); } }) });
    const context = { request: new Request('https://network.10x.meme/api/network/members'), waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    const load = vi.fn(async () => Response.json({ members: [1] }));
    expect((await cachedNetworkResponse(context, 'members', ['AU', 0], load)).headers.get('x-network-cache')).toBe('MISS');
    await Promise.all(pending);
    expect((await cachedNetworkResponse(context, 'members', ['AU', 0], load)).headers.get('x-network-cache')).toBe('HIT');
    expect(load).toHaveBeenCalledTimes(1);
    await cachedNetworkResponse(context, 'members', ['US', 0], load);
    await cachedNetworkResponse({ ...context, request: new Request('https://network-local.10x.meme/api/network/members') }, 'members', ['AU', 0], load);
    expect(load).toHaveBeenCalledTimes(3); await Promise.all(pending);
  });
  it('never caches errors or exposes database exception details', async () => {
    const put = vi.fn(); vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) }); vi.spyOn(console, 'error').mockImplementation(() => {});
    const context = { request: new Request('https://network.10x.meme/api/network/members'), waitUntil: vi.fn() };
    const response = await cachedNetworkResponse(context, 'members', [], async () => { throw Error('private SQL details'); });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('SQL'); expect(put).not.toHaveBeenCalled(); expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('checks the serving gate before any cache or D1 access', async () => {
    const cache = vi.fn(); vi.stubGlobal('caches', { open: async () => ({ match: cache }) });
    const context = { env: { NETWORK_ENABLED: 'false' }, request: new Request('https://network.10x.meme/api/network/dashboard') } as Parameters<typeof onRequestGet>[0];
    expect((await onRequestGet(context)).status).toBe(404); expect(cache).not.toHaveBeenCalled();
  });
  it('still serves data if edge caching is unavailable', async () => {
    vi.stubGlobal('caches', { open: async () => { throw Error('Cache unavailable'); } }); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = { request: new Request('https://network.10x.meme/api/network/dashboard'), waitUntil: vi.fn() };
    const response = await cachedNetworkResponse(context, 'dashboard', [], async () => Response.json({ population: 42 }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ population: 42 }); expect(context.waitUntil).not.toHaveBeenCalled();
  });
  it('rejects cache-busting and ambiguous parameters before database work', () => {
    for (const query of ['random=1', 'country=AU&country=US', 'vote=all&vote=opted_in', `q=${'a'.repeat(33000)}`]) expect(() => validateNetworkParams(new URLSearchParams(query), ['q'])).toThrow();
    expect(() => validateNetworkParams(new URLSearchParams('token=none&token=unavailable'))).not.toThrow();
  });
  it('does not rewrite unchanged tracker identities or candidates', async () => {
    const { env, db } = fixture();
    let name = 'Original';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/stats') ? { contract: NETWORK_CONTRACT } : { signers: [[3, 'user', name, 'https://example.com/avatar.png']], signerFids: 1 })));
    await refreshNetworkCandidates(env, true);
    const before = Number(db.prepare('SELECT total_changes() AS n').get()!.n);
    await refreshNetworkCandidates(env, true);
    const after = Number(db.prepare('SELECT total_changes() AS n').get()!.n);
    // Only two source-budget reservations and one refresh checkpoint change.
    expect(after - before).toBe(3);
    name = 'Updated'; await refreshNetworkCandidates(env, true);
    expect(db.prepare('SELECT display_name FROM network_member_profiles WHERE fid=3').get()?.display_name).toBe('Updated');
  });
  it('backs off a failed chain source while continuing profile work', async () => {
    const { env, db } = fixture();
    db.prepare("INSERT INTO network_sync VALUES('candidate_refresh',?,?)").run(JSON.stringify(Date.now()), Date.now());
    const fetcher = vi.fn(async () => { throw Error('RPC unavailable'); }); vi.stubGlobal('fetch', fetcher);
    expect((await advanceNetwork(env)).status).toBe('advanced'); expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await advanceNetwork(env)).status).toBe('advanced'); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
