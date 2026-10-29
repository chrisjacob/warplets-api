import { NETWORK_CURRENT_COHORT } from './cohort';
import { importNetworkActivity } from './activity';
import { NETWORK_CONTRACT, NETWORK_DEPLOY_BLOCK } from '../../../shared/network/model';
import { networkIdentity, normalizeNetworkProfile } from '../../../shared/network/normalize';
import { decodeAcceptanceLogs, networkFetchJson } from './source';
import { importWalletAssociations, importWalletValue, refreshWalletPrices } from './wallets';
import { bounded, publishSnapshot, reserveRequest, saveEvents, saveProfile, syncGet, syncSet, type NetworkEnv } from './store';

type Cursor = { block: number; hash: string; target: number };
async function rpc(env: NetworkEnv, method: string, params: unknown[]): Promise<unknown> {
  const urls = [...new Set([env.NETWORK_RPC_URL || env.BASE_RPC_URL, 'https://1rpc.io/base', 'https://base.drpc.org', 'https://base-rpc.publicnode.com'].filter((v): v is string => Boolean(v)))];
  for (const url of urls) {
    if (!url.startsWith('https://')) throw new Error('Network RPC must use HTTPS');
    await reserveRequest(env, 'base');
    try {
      const response = await networkFetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }) as { result?: unknown; error?: unknown };
      if (response.error || response.result === undefined) throw new Error('Network RPC rejected request');
      return response.result;
    } catch { /* Bounded read-only fallback; every attempt remains budgeted. */ }
  }
  throw new Error('Network Base RPC unavailable across configured and public endpoints');
}
const hex = (n: number) => `0x${n.toString(16)}`;
function integer(value: unknown) { if (typeof value !== 'string' || !/^0x[\da-f]+$/i.test(value)) throw new Error('Invalid RPC integer'); const n = Number(BigInt(value)); if (!Number.isSafeInteger(n)) throw new Error('RPC integer overflow'); return n; }

export async function refreshNetworkCandidates(env: NetworkEnv, force = false) {
  const last = await syncGet(env.WARPLETS, 'candidate_refresh', 0);
  if (!force && last > Date.now() - 900_000) return;
  await reserveRequest(env, 'tracker');
  const stats = await networkFetchJson('https://fc.dylanbrodeur.org/api/stats') as { contract: string };
  if (stats.contract?.toLowerCase() !== NETWORK_CONTRACT) throw new Error('Tracker contract mismatch');
  await reserveRequest(env, 'tracker');
  const data = await networkFetchJson('https://fc.dylanbrodeur.org/api/signers', {}, 10_000_000) as { signers: unknown[][]; signerFids: number };
  if (!Array.isArray(data.signers) || data.signers.length < 1 || data.signers.length > 100_000) throw new Error('Invalid candidate list');
  const fids = data.signers.map(row => row[0]);
  if (fids.some(fid => !Number.isSafeInteger(fid) || Number(fid) < 1) || new Set(fids).size !== data.signerFids || data.signerFids !== fids.length) throw new Error('Candidate FIDs do not reconcile');
  const at = Date.now();
  const existing = await env.WARPLETS.prepare('SELECT fid,username,display_name AS displayName,avatar_url AS avatarUrl,source FROM network_member_profiles').all<{ fid: number; username: string | null; displayName: string | null; avatarUrl: string | null; source: string }>();
  const identities = new Map(existing.results.map(row => [row.fid, row]));
  const changed = data.signers.flatMap(row => {
    const identity = networkIdentity(row[1], row[2], row[3]);
    const previous = identities.get(row[0] as number);
    if (previous && (previous.source !== 'nft-contract-tracker' || previous.username === identity.username && previous.displayName === identity.displayName && previous.avatarUrl === identity.avatarUrl)) return [];
    return [{ fid: row[0] as number, ...identity }];
  });
  for (let i = 0; i < changed.length; i += 100) await env.WARPLETS.batch(changed.slice(i, i + 100).map(identity => {
    return env.WARPLETS.prepare(`INSERT INTO network_member_profiles(fid,username,display_name,avatar_url,observed_at,source) VALUES(?,?,?,?,?,'nft-contract-tracker')
      ON CONFLICT(fid) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar_url=excluded.avatar_url,observed_at=excluded.observed_at WHERE network_member_profiles.source='nft-contract-tracker'`)
      .bind(identity.fid, identity.username, identity.displayName, identity.avatarUrl, at);
  }));
  const known = new Set((await env.WARPLETS.prepare('SELECT fid FROM network_candidates').all<{ fid: number }>()).results.map(row => row.fid));
  const fresh = fids.filter(fid => !known.has(fid as number));
  for (let i = 0; i < fresh.length; i += 100) await env.WARPLETS.batch(fresh.slice(i, i + 100).map(fid => env.WARPLETS.prepare(`INSERT OR IGNORE INTO network_candidates(fid,observed_at,source) VALUES(?,?,'nft-contract-tracker')`).bind(fid as number, at)));
  await syncSet(env.WARPLETS, 'candidate_refresh', at);
}

export async function advanceNetwork(env: NetworkEnv, options: { publish?: boolean; scanOnly?: boolean; profilesOnly?: boolean; locationBackfillOnly?: boolean } = {}) {
  if (env.NETWORK_INGEST_ENABLED !== 'true') return { status: 'disabled' };
  const db = env.WARPLETS, owner = crypto.randomUUID(), now = Date.now();
  const lease = await db.prepare(`INSERT INTO network_leases(name,owner,expires_at) VALUES('ingestion',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE network_leases.expires_at<? RETURNING owner`).bind(owner, now + 300_000, now).first<{ owner: string }>();
  if (lease?.owner !== owner) return { status: 'busy' };
  let eventsSaved = 0, profilesSaved = 0;
  try {
    if (!options.profilesOnly && !options.locationBackfillOnly && (options.scanOnly || await syncGet(db, 'chain_retry_after', 0) <= now)) {
      try {
      const head = integer(await rpc(env, 'eth_blockNumber', []));
      const cursor = await syncGet<Cursor>(db, 'scan', { block: NETWORK_DEPLOY_BLOCK - 1, hash: '', target: head - 64 });
      cursor.target = Math.max(NETWORK_DEPLOY_BLOCK - 1, head - 64);
      if (cursor.hash) {
        const anchor = await rpc(env, 'eth_getBlockByNumber', [hex(cursor.block), false]) as { hash: string } | null;
        if (!anchor?.hash) throw new Error('Missing scan anchor');
        if (anchor.hash.toLowerCase() !== cursor.hash) {
          const replay = Math.max(NETWORK_DEPLOY_BLOCK, cursor.block - 128);
          await db.batch([
            db.prepare('DELETE FROM network_events WHERE block_number>=?').bind(replay),
            db.prepare("DELETE FROM network_snapshots WHERE CAST(json_extract(payload,'$.scan.throughBlock') AS INTEGER)>=?").bind(replay),
          ]);
          cursor.block = replay - 1; cursor.hash = '';
        }
      }
      const batches = bounded(env.NETWORK_SCAN_BATCH, 8, 100);
      for (let i = 0; i < batches && cursor.block < cursor.target; i += 4) {
        const ranges = Array.from({ length: Math.min(4, batches - i, Math.ceil((cursor.target - cursor.block) / 50)) }, (_, index) => ({ from: cursor.block + 1 + index * 50, to: Math.min(cursor.block + (index + 1) * 50, cursor.target) }));
        // Fetch all contract logs so acceptance/mint pairing cannot use a later transfer.
        const responses = await Promise.allSettled(ranges.map(async ({ from, to }) => decodeAcceptanceLogs(await rpc(env, 'eth_getLogs', [{ address: NETWORK_CONTRACT, fromBlock: hex(from), toBlock: hex(to) }]))));
        const failed = responses.find(r => r.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        const decoded = { events: responses.flatMap(r => r.status === 'fulfilled' ? r.value.events : []), missingTimestamps: [...new Set(responses.flatMap(r => r.status === 'fulfilled' ? r.value.missingTimestamps : []))] };
        const from = ranges[0].from, to = ranges.at(-1)!.to;
        for (const block of decoded.missingTimestamps) {
          const record = await rpc(env, 'eth_getBlockByNumber', [hex(block), false]) as { timestamp: string; hash: string };
          for (const event of decoded.events.filter(e => e.block === block)) { if (event.blockHash !== record.hash?.toLowerCase()) throw new Error('Event block changed'); event.at = integer(record.timestamp) * 1000; }
        }
        if (decoded.events.some(e => e.block < from || e.block > to || !e.at)) throw new Error('Event outside scanned range');
        await saveEvents(db, decoded.events); eventsSaved += decoded.events.length;
        const block = await rpc(env, 'eth_getBlockByNumber', [hex(to), false]) as { hash: string };
        if (!block?.hash) throw new Error('Missing scan block hash');
        cursor.block = to; cursor.hash = block.hash.toLowerCase();
        await syncSet(db, 'scan', cursor);
      }
      await syncSet(db, 'scan', cursor);
      await syncSet(db, 'chain_retry_after', 0);
      } catch (error) {
        await syncSet(db, 'chain_retry_after', Date.now() + 900_000);
        await syncSet(db, 'chain_failure', { at: Date.now(), message: error instanceof Error ? error.message.slice(0, 180) : 'Chain source unavailable' });
        if (options.scanOnly) throw error;
        // Chain reconciliation and official profile refresh have separate source
        // coverage. A public RPC quota must not stall verified client records.
      }
    }
    if (!options.scanOnly && await syncGet(db, 'official_cooldown', 0) < Date.now()) {
      if (!options.locationBackfillOnly) await refreshNetworkCandidates(env);
      const refresh = bounded(env.NETWORK_PROFILE_REFRESH_HOURS, 24, 168) * 3_600_000;
      // Legacy imports discarded raw text even for unknown-country profiles.
      // Backfill missing/current observations before routine age-based refreshes;
      // an observed empty description is complete, not a reason to refetch.
      const missingLocation = '(g.fid IS NULL OR g.observed_at<>p.observed_at)';
      const cohort=options.locationBackfillOnly?NETWORK_CURRENT_COHORT:'SELECT fid FROM network_events UNION SELECT fid FROM network_candidates UNION SELECT fid FROM network_confirmed';
      const needsRefresh=options.locationBackfillOnly?`${missingLocation} AND p.observed_at>=?`:`p.fid IS NULL OR p.observed_at<? OR ${missingLocation}`;
      const rows = await db.prepare(`SELECT s.fid FROM (${cohort}) s LEFT JOIN network_profiles p ON p.fid=s.fid LEFT JOIN network_profile_failures f ON f.fid=s.fid LEFT JOIN network_profile_locations g ON g.fid=s.fid WHERE (${needsRefresh}) AND (f.fid IS NULL OR f.retry_after<?) ORDER BY CASE WHEN p.fid IS NOT NULL AND p.country IS NULL AND ${missingLocation} THEN 0 WHEN p.fid IS NULL THEN 1 WHEN ${missingLocation} THEN 2 ELSE 3 END,COALESCE(p.observed_at,0),s.fid LIMIT ?`)
        .bind(options.locationBackfillOnly?0:Date.now() - refresh, Date.now(), bounded(env.NETWORK_PROFILE_BATCH, 20, 100)).all<{ fid: number }>();
      // Four bounded readers; errors preserve the previous profile and are retried on a later run.
      let index = 0, paused = false;
      const workers = await Promise.allSettled(Array.from({ length: Math.min(4, rows.results.length) }, async () => {
        while (index < rows.results.length && !paused) {
          const { fid } = rows.results[index++];
          if(options.locationBackfillOnly) await new Promise(resolve=>setTimeout(resolve,1000));
          await reserveRequest(env, 'official-client');
          try {
            const payload = await networkFetchJson(`https://client.farcaster.xyz/v2/user?fid=${fid}`, {}, 256_000);
            const profile = normalizeNetworkProfile(payload, fid, Date.now());
            await saveProfile(db, profile);
            if (profile.vote === 'opted_in') await db.prepare(`INSERT OR IGNORE INTO network_confirmed(fid,observed_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM network_candidates WHERE fid=?)`).bind(fid, profile.observedAt, fid).run();
            await db.prepare('DELETE FROM network_profile_failures WHERE fid=?').bind(fid).run();
            profilesSaved++;
          } catch (error) {
            await db.prepare('INSERT INTO network_profile_failures(fid,retry_after) VALUES(?,?) ON CONFLICT(fid) DO UPDATE SET retry_after=excluded.retry_after').bind(fid, Date.now() + 3_600_000).run();
            if (error instanceof Error && error.message.includes('429')) { paused = true; await syncSet(db, 'official_cooldown', Date.now() + 900_000); throw error; }
          }
        }
      }));
      const failure = workers.find(w => w.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
    if (!options.scanOnly && !options.locationBackfillOnly) {
      try { await refreshWalletPrices(env); }
      catch { await syncSet(db,'wallet_price_failure',{at:Date.now(),message:'Price refresh unavailable; previous accepted observations retained'}); }
    }
    if (!options.scanOnly && !options.locationBackfillOnly && env.NETWORK_WALLETS_ENABLED === 'true') {
      try { await importWalletAssociations(env); }
      catch { await syncSet(db, 'wallet_association_failure', {at:Date.now(),message:'Wallet association source unavailable or budget reached'}); }
      try { await importWalletValue(env); }
      catch { await syncSet(db, 'wallet_failure', {at:Date.now(),message:'Wallet source unavailable or budget reached; previous values retained'}); }
    }
    if (!options.scanOnly && !options.profilesOnly && !options.locationBackfillOnly) {
      try { await importNetworkActivity(env); }
      catch { await syncSet(db,'activity_failure',{at:Date.now(),message:'Activity source unavailable or budget reached; positive observations retained'}); }
    }
    const snapshot = options.locationBackfillOnly && profilesSaved===0 ? null : await publishSnapshot(db, options.publish);
    await syncSet(db, 'last_success', { at: Date.now(), eventsSaved, profilesSaved });
    return { status: 'advanced', eventsSaved, profilesSaved, snapshot: snapshot?.id ?? null };
  } catch (error) {
    await syncSet(db, 'last_failure', { at: Date.now(), message: error instanceof Error ? error.message.slice(0, 180) : 'Network ingestion failed' });
    // Do not publish failed runs; the previous immutable snapshot remains available.
    throw error;
  } finally { await db.prepare("DELETE FROM network_leases WHERE name='ingestion' AND owner=?").bind(owner).run(); }
}
