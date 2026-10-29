import { NETWORK_CURRENT_COHORT } from './cohort';
import { encodeNetworkSnapshot } from './snapshot';
import { refreshNetworkWarplets } from './warplets';
import { NETWORK_GEOGRAPHY_VERSION, resolveNetworkLocation } from './geography';
import { NETWORK_OG_LAST_FID, NETWORK_DEPLOY_BLOCK, type NetworkCell, type NetworkSnapshot, type NetworkToken } from '../../../shared/network/model';
import type { NetworkProfile } from '../../../shared/network/normalize';
import type { AcceptanceEvent } from './source';
import { mergeWalletCells, walletSnapshot } from './walletSnapshot';
export interface NetworkEnv { ALCHEMY_API_KEY?: string; NETWORK_ALCHEMY_CU?: string; NETWORK_ALCHEMY_CU_PER_DAY?: string; WARPLETS: D1Database; WARPLETS_KV?: KVNamespace; NETWORK_ENABLED?: string; NETWORK_INGEST_ENABLED?: string; NETWORK_RPC_URL?: string; BASE_RPC_URL?: string; NETWORK_PROFILE_BATCH?: string; NETWORK_SCAN_BATCH?: string; NETWORK_REQUESTS_PER_DAY?: string; NETWORK_REQUESTS_PER_MONTH?: string; NETWORK_PROFILE_REFRESH_HOURS?: string; NETWORK_WALLETS_ENABLED?: string; NEYNAR_API_KEY?: string; NETWORK_WALLET_CREDITS?: string }
export function bounded(value: string | undefined, fallback: number, maximum: number) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, maximum) : fallback; }
export async function syncGet<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare('SELECT value FROM network_sync WHERE key=?').bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : fallback;
}
export async function syncSet(db: D1Database, key: string, value: unknown) {
  await db.prepare('INSERT INTO network_sync(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key, JSON.stringify(value), Date.now()).run();
}
export async function reserveRequest(env: NetworkEnv, provider: string) {
  const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
  const daily = bounded(env.NETWORK_REQUESTS_PER_DAY, 100_000, 100_000), monthly = bounded(env.NETWORK_REQUESTS_PER_MONTH, 600_000, 1_000_000);
  const row = await env.WARPLETS.prepare(`INSERT INTO network_budgets(day,provider,attempts)
    SELECT ?,?,1 WHERE COALESCE((SELECT SUM(attempts) FROM network_budgets WHERE day=?),0)<? AND COALESCE((SELECT SUM(attempts) FROM network_budgets WHERE substr(day,1,7)=?),0)<?
    ON CONFLICT(day,provider) DO UPDATE SET attempts=network_budgets.attempts+1
    RETURNING attempts`).bind(day, provider, day, daily, month, monthly).first();
  if (!row) throw new Error('Network request budget exhausted');
}
export async function saveEvents(db: D1Database, events: AcceptanceEvent[]) {
  for (let i = 0; i < events.length; i += 50) {
    await db.batch(events.slice(i, i + 50).map(e => db.prepare(`INSERT INTO network_events(tx_hash,log_index,block_number,block_hash,event_at,fid,recipient,observed_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(tx_hash,log_index) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,event_at=excluded.event_at,fid=excluded.fid,recipient=excluded.recipient,observed_at=excluded.observed_at`)
      .bind(e.tx, e.logIndex, e.block, e.blockHash, e.at, e.fid, e.recipient, Date.now())));
  }
}
export async function saveProfile(db: D1Database, p: NetworkProfile) {
  const geo = await resolveNetworkLocation(db, p.publicLocation ?? '', p.country);
  await db.prepare(`INSERT INTO network_profile_locations(fid,description,place_id,country,state,city,observed_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(fid) DO UPDATE SET description=excluded.description,place_id=excluded.place_id,country=excluded.country,state=excluded.state,city=excluded.city,observed_at=excluded.observed_at`)
    .bind(p.fid,p.country ? p.publicLocation ?? '' : '',p.country ? p.placeId ?? null : null,p.country,geo.state,geo.city,p.observedAt).run();
  await db.prepare(`INSERT INTO network_member_profiles(fid,username,display_name,avatar_url,observed_at,source) VALUES(?,?,?,?,?,'official-client')
    ON CONFLICT(fid) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar_url=excluded.avatar_url,observed_at=excluded.observed_at,source=excluded.source`)
    .bind(p.fid, p.username, p.displayName, p.avatarUrl, p.observedAt).run();
  await db.prepare(`INSERT INTO network_profiles(fid,country,location_status,token_id,token_status,token_name,token_symbol,opt_in_status,observed_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(fid) DO UPDATE SET country=excluded.country,location_status=excluded.location_status,token_id=excluded.token_id,token_status=excluded.token_status,token_name=excluded.token_name,token_symbol=excluded.token_symbol,opt_in_status=excluded.opt_in_status,observed_at=excluded.observed_at`)
    .bind(p.fid, p.country, p.locationStatus, p.token, p.tokenStatus, p.tokenName, p.tokenSymbol, p.vote, p.observedAt).run();
}
export async function publishSnapshot(db: D1Database, force = false): Promise<NetworkSnapshot | null> {
  const previous = await db.prepare('SELECT created_at FROM network_snapshots ORDER BY created_at DESC LIMIT 1').first<{ created_at: number }>();
  if (!force && previous && previous.created_at > Date.now() - 600_000) return null;
  const wallet = await walletSnapshot(db);
  const warplets = await refreshNetworkWarplets(db);
  // The FID rows are folded into a private aggregate cube before publication.
  const data = await db.prepare(`WITH cohort AS (${NETWORK_CURRENT_COHORT}), signers AS (SELECT c.fid,MIN(e.event_at) AS first_at FROM cohort c LEFT JOIN network_events e ON e.fid=c.fid GROUP BY c.fid)
    SELECT s.fid,p.country,g.state,g.city,COALESCE(p.location_status,'unavailable') AS location,p.token_id AS token,
    COALESCE(p.token_status,'unavailable') AS tokenStatus,COALESCE(p.opt_in_status,'unavailable') AS vote,date(s.first_at/1000,'unixepoch') AS acceptedDay,1 AS count
    FROM signers s LEFT JOIN network_profiles p ON p.fid=s.fid LEFT JOIN network_profile_locations g ON g.fid=s.fid AND g.country=p.country`).all<NetworkCell & {fid:number}>();
  const activity = await db.prepare(`SELECT a.fid,a.month FROM network_activity_months a JOIN
    (SELECT fid,MIN(event_at) AS first_at FROM network_events GROUP BY fid) s ON s.fid=a.fid
    WHERE a.action_at>=s.first_at AND a.action_at<=? ORDER BY a.fid,a.month`).bind(Date.now()).all<{fid:number;month:string}>();
  const months = new Map<number,string[]>();
  for (const row of activity.results) { const list=months.get(row.fid)??[]; list.push(row.month); months.set(row.fid,list); }
  for (const row of data.results) { row.ogMember=row.fid<=NETWORK_OG_LAST_FID; row.activityMonths=months.get(row.fid)??[]; row.warpletHolder=warplets.holders.has(row.fid); }
  const coverage = await db.prepare(`SELECT COUNT(*) AS population,COUNT(p.fid) AS observed,MIN(p.observed_at) AS oldest FROM (${NETWORK_CURRENT_COHORT}) s LEFT JOIN network_profiles p ON p.fid=s.fid`).first<{ population: number; observed: number; oldest: number | null }>();
  const tokens = await db.prepare(`SELECT token_id AS id,MAX(COALESCE(token_name,token_id)) AS name,MAX(COALESCE(token_symbol,'')) AS symbol FROM network_profiles p WHERE p.opt_in_status='opted_in' AND token_id IS NOT NULL AND (EXISTS(SELECT 1 FROM network_events e WHERE e.fid=p.fid) OR EXISTS(SELECT 1 FROM network_confirmed c WHERE c.fid=p.fid)) GROUP BY token_id`).all<NetworkToken>();
  const adoption = await db.prepare(`SELECT date(first_at/1000,'unixepoch') AS day,COUNT(*) AS count FROM (SELECT MIN(event_at) AS first_at FROM network_events WHERE fid IN (${NETWORK_CURRENT_COHORT}) GROUP BY fid) GROUP BY day ORDER BY day`).all<{ day: string; count: number }>();
  const cursor = await syncGet(db, 'scan', { block: NETWORK_DEPLOY_BLOCK - 1, hash: '', target: NETWORK_DEPLOY_BLOCK - 1 });
  const sources = await db.prepare(`SELECT (SELECT COUNT(DISTINCT fid) FROM network_events WHERE fid IN (${NETWORK_CURRENT_COHORT})) AS chainVerified,(SELECT COUNT(*) FROM network_confirmed WHERE fid IN (${NETWORK_CURRENT_COHORT})) AS officialConfirmed,(SELECT COUNT(*) FROM network_candidates) AS candidates,(SELECT COUNT(*) FROM network_candidates c JOIN network_profiles p ON p.fid=c.fid) AS candidatesObserved`).first<NonNullable<NetworkSnapshot['sources']>>();
  const states = await db.prepare(`SELECT id,country,name FROM network_geo_states WHERE id IN (SELECT DISTINCT state FROM network_profile_locations WHERE state IS NOT NULL)`).all<import('../../../shared/network/model').NetworkPlace>();
  const cities = await db.prepare(`SELECT id,country,state,name,lat,lon FROM network_geo_cities WHERE id IN (SELECT DISTINCT city FROM network_profile_locations WHERE city IS NOT NULL)`).all<import('../../../shared/network/model').NetworkPlace>();
  const at = Date.now();
  const snapshot: NetworkSnapshot = { id: `${at}-${crypto.randomUUID()}`, createdAt: at, cohort: 'currently-opted-in', chain: 'Base',
    scan: { fromBlock: NETWORK_DEPLOY_BLOCK, throughBlock: cursor.block, targetBlock: cursor.target, complete: cursor.block >= cursor.target },
    population: Number(coverage?.population ?? 0), profilesObserved: Number(coverage?.observed ?? 0), profileOldestAt: coverage?.oldest ?? null,
    geography: {resolverVersion:NETWORK_GEOGRAPHY_VERSION,states:states.results,cities:cities.results},
    cells: mergeWalletCells(data.results,wallet.presentation), wallet: wallet.summary, warplets:warplets.summary, tokens: tokens.results, adoption: adoption.results, sources: sources ?? undefined };
  if (snapshot.cells.reduce((sum, c) => sum + c.count, 0) !== snapshot.population || snapshot.adoption.reduce((sum, c) => sum + c.count, 0) !== (sources?.chainVerified ?? 0)) throw new Error('Snapshot reconciliation failed');
  // Optional defaults need no storage. Extra cross-filter dimensions split
  // cells; omit empty fields rather than raising the snapshot size budget.
  for(const cell of snapshot.cells){
    if(!cell.warpletHolder)delete cell.warpletHolder;
    if(!cell.state)delete cell.state;if(!cell.city)delete cell.city;
    if(cell.walletUsdUnits==='0')delete cell.walletUsdUnits;
    if(!cell.portfolioValues?.length)delete cell.portfolioValues;
    if(!cell.activityMonths?.length)delete cell.activityMonths;
    if(cell.held==='unavailable')delete cell.held;
  }
  const payload = await encodeNetworkSnapshot(snapshot);
  await db.prepare('INSERT INTO network_snapshots(id,created_at,day,complete,payload) VALUES(?,?,?,?,?)').bind(snapshot.id, at, new Date(at).toISOString().slice(0, 10), snapshot.scan.complete ? 1 : 0, payload).run();
  // Keep recent detail plus the latest available snapshot per older UTC day.
  await db.prepare(`DELETE FROM network_snapshots WHERE created_at<? AND id NOT IN (SELECT id FROM network_snapshots n WHERE created_at=(SELECT MAX(created_at) FROM network_snapshots x WHERE x.day=n.day))`).bind(at - 7 * 86_400_000).run();
  return snapshot;
}
