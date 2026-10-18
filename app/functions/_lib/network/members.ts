import { parseNetworkFilters, validateNetworkParams } from '../../../shared/network/model';
import { networkIdentity } from '../../../shared/network/normalize';

export interface NetworkMember { fid: number; username: string | null; displayName: string | null; avatarUrl: string | null; profileUrl: string; observedAt: number | null; source: string | null }
export interface NetworkMembers { members: NetworkMember[]; total: number; next: number | null }

export function memberQuery(params: URLSearchParams) {
  validateNetworkParams(params, ['q', 'after']);
  const filters = parseNetworkFilters(params);
  if (filters.snapshot !== 'current') throw new Error('Member profiles are available for the latest observation only');
  const search = (params.get('q') ?? '').trim();
  const after = Number(params.get('after') ?? 0);
  if (search.length > 100 || !Number.isSafeInteger(after) || after < 0) throw new Error('Invalid member search or cursor');
  const clauses: string[] = [], values: (string | number)[] = [];
  const add = (sql: string, value: string | number) => { clauses.push(sql); values.push(value); };
  if (filters.country !== 'all') add(`CASE WHEN p.fid IS NULL THEN 'UNAVAILABLE' ELSE COALESCE(p.country,'UNKNOWN') END=?`, filters.country);
  if (filters.location !== 'all') add(`COALESCE(p.location_status,'unavailable')=?`, filters.location);
  if (filters.vote !== 'all') add(`COALESCE(p.opt_in_status,'unavailable')=?`, filters.vote);
  if (filters.tokens.length) { clauses.push(`CASE WHEN p.token_status='assigned' THEN p.token_id WHEN p.token_status='none' THEN 'none' ELSE 'unavailable' END IN (${filters.tokens.map(() => '?').join(',')})`); values.push(...filters.tokens); }
  if (filters.held && filters.held!=='all') add("COALESCE(h.asset,h.status,'unavailable')=?",filters.held);
  if (/^\d+$/.test(search)) add('CAST(c.fid AS TEXT)=?', search);
  else if (search) { clauses.push(`(instr(lower(COALESCE(m.username,'')),lower(?))>0 OR instr(lower(COALESCE(m.display_name,'')),lower(?))>0)`); values.push(search.replace(/^@/, ''), search); }
  const from = `FROM (SELECT fid FROM network_events UNION SELECT fid FROM network_confirmed) c LEFT JOIN network_profiles p ON p.fid=c.fid LEFT JOIN network_member_profiles m ON m.fid=c.fid LEFT JOIN network_holdings h ON h.fid=c.fid WHERE ${clauses.join(' AND ') || '1=1'}`;
  return { from, values, after };
}
export async function readNetworkMembers(db: D1Database, params: URLSearchParams): Promise<NetworkMembers> {
  const query = memberQuery(params);
  const total = await db.prepare(`SELECT COUNT(*) AS n ${query.from}`).bind(...query.values).first<{ n: number }>();
  const result = await db.prepare(`SELECT c.fid,m.username,m.display_name AS displayName,m.avatar_url AS avatarUrl,m.observed_at AS observedAt,m.source ${query.from} AND c.fid>? ORDER BY c.fid LIMIT 25`)
    .bind(...query.values, query.after).all<NetworkMember>();
  const members = result.results.slice(0, 24).map(row => ({ ...row, ...networkIdentity(row.username, row.displayName, row.avatarUrl), profileUrl: `https://farcaster.xyz/~/profiles/${row.fid}` }));
  return { members, total: total?.n ?? 0, next: result.results.length > 24 ? members.at(-1)!.fid : null };
}
