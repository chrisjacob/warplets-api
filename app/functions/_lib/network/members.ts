import { NETWORK_CURRENT_COHORT } from './cohort';
import { parseNetworkFilters, validateNetworkParams } from '../../../shared/network/model';
import { acceptedQuote, decimalScale, NATIVE_ASSET, type PricedPosition } from './wallets';
import { networkIdentity } from '../../../shared/network/normalize';

export interface NetworkMember { fid: number; username: string | null; displayName: string | null; avatarUrl: string | null; profileUrl: string; observedAt: number | null; source: string | null; location: string | null; wallet: { status: 'measured' | 'partial' | 'pending' | 'shared' | 'no-wallet'; usd: string | null; measured: number; expected: number; observedAt: number | null; stale: boolean } }
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
  if (filters.country === 'UNAVAILABLE') clauses.push('p.fid IS NULL');
  else if(filters.country==='UNKNOWN')clauses.push('p.fid IS NOT NULL AND p.country IS NULL');
  else if(filters.country!=='all')add('p.country=?',filters.country);
  if (filters.state && filters.state !== 'all') add("COALESCE(g.state,'UNKNOWN')=?", filters.state);
  if (filters.city && filters.city !== 'all') add("COALESCE(g.city,'UNKNOWN')=?", filters.city);
  if (filters.location !== 'all') add(`COALESCE(p.location_status,'unavailable')=?`, filters.location);
  if (filters.vote !== 'all') add(`COALESCE(p.opt_in_status,'unavailable')=?`, filters.vote);
  if (filters.tokens.length) { clauses.push(`CASE WHEN p.token_status='assigned' THEN p.token_id WHEN p.token_status='none' THEN 'none' ELSE 'unavailable' END IN (${filters.tokens.map(() => '?').join(',')})`); values.push(...filters.tokens); }
  if(filters.warplet==='holders')clauses.push('EXISTS(SELECT 1 FROM network_warplet_holders w WHERE w.fid=c.fid)');
  if (filters.held && filters.held!=='all') add("COALESCE(h.asset,h.status,'unavailable')=?",filters.held);
  if (/^\d+$/.test(search)) add('CAST(c.fid AS TEXT)=?', search);
  else if (search) { clauses.push(`(instr(lower(COALESCE(m.username,'')),lower(?))>0 OR instr(lower(COALESCE(m.display_name,'')),lower(?))>0)`); values.push(search.replace(/^@/, ''), search); }
  const cohort=`(${NETWORK_CURRENT_COHORT}) c`;
  const profileJoin=' LEFT JOIN network_profiles p ON p.fid=c.fid',geoJoin=' LEFT JOIN network_profile_locations g ON g.fid=c.fid AND g.country=p.country',identityJoin=' LEFT JOIN network_member_profiles m ON m.fid=c.fid',holdingJoin=' LEFT JOIN network_holdings h ON h.fid=c.fid';
  const where=` WHERE ${clauses.join(' AND ') || '1=1'}`;
  const from=`FROM ${cohort}${profileJoin}${geoJoin}${identityJoin}${holdingJoin}${where}`;
  const needsGeo=filters.state&&filters.state!=='all'||filters.city&&filters.city!=='all';
  const needsProfile=needsGeo||filters.country!=='all'||filters.location!=='all'||filters.vote!=='all'||filters.tokens.length;
  const countFrom=`FROM ${cohort}${needsProfile?profileJoin:''}${needsGeo?geoJoin:''}${search&&!/^\d+$/.test(search)?identityJoin:''}${filters.held&&filters.held!=='all'?holdingJoin:''}${where}`;
  return { from, countFrom, values, after };
}
export async function readNetworkMembers(db: D1Database, params: URLSearchParams): Promise<NetworkMembers> {
  const query = memberQuery(params);
  const total = await db.prepare(`SELECT COUNT(*) AS n ${query.countFrom}`).bind(...query.values).first<{ n: number }>();
  const ids=await db.prepare(`SELECT c.fid ${query.from} AND c.fid>? ORDER BY c.fid LIMIT 25`).bind(...query.values,query.after).all<{fid:number}>();
  // Page before joining geographic names; large global joins needlessly sort
  // the entire cohort and can exhaust the local runtime's query resources.
  const result=await db.prepare(`SELECT c.fid,m.username,m.display_name AS displayName,m.avatar_url AS avatarUrl,m.observed_at AS observedAt,m.source,p.country,gs.name AS stateName,gc.name AS cityName
    FROM (SELECT value AS fid FROM json_each(?)) c LEFT JOIN network_profiles p ON p.fid=c.fid
    LEFT JOIN network_profile_locations g ON g.fid=c.fid AND g.country=p.country
    LEFT JOIN network_member_profiles m ON m.fid=c.fid
    LEFT JOIN network_geo_states gs ON gs.id=g.state LEFT JOIN network_geo_cities gc ON gc.id=g.city ORDER BY c.fid`)
    .bind(JSON.stringify(ids.results.slice(0,24).map(row=>row.fid))).all<NetworkMember & {country:string|null;stateName:string|null;cityName:string|null}>();
  const page = result.results;
  const wallets = await memberWallets(db,page.map(row=>row.fid));
  const countries=new Intl.DisplayNames(['en'],{type:'region'});
  const members = page.map(({country,stateName,cityName,...row}) => ({ ...row, ...networkIdentity(row.username, row.displayName, row.avatarUrl),
    location: [cityName,stateName,country?countries.of(country):null].filter(Boolean).join(', ') || null,
    wallet:wallets.get(row.fid)!,profileUrl: `https://farcaster.xyz/~/profiles/${row.fid}` }));
  return { members, total: total?.n ?? 0, next: ids.results.length > 24 ? members.at(-1)!.fid : null };
}

// Only load portfolios for this page; resolve shared ownership across the entire
// signer cohort, never just the active directory filters. No provider requests.
async function memberWallets(db:D1Database,fids:number[]) {
  const output=new Map<number,NetworkMember['wallet']>();
  if(!fids.length)return output;
  const placeholders=fids.map(()=>'?').join(',');
  const associations=await db.prepare(`SELECT fid FROM network_wallet_associations WHERE fid IN (${placeholders})`).bind(...fids).all<{fid:number}>();
  const known=new Set(associations.results.map(row=>row.fid));
  const links=await db.prepare(`SELECT l.fid,l.address AS linkedAddress,v.address,v.positions,v.observed_at
    FROM network_wallet_links l LEFT JOIN network_wallet_values v ON v.address=l.address WHERE l.fid IN (${placeholders})`).bind(...fids).all<{fid:number;linkedAddress:string;address:string|null;positions:string|null;observed_at:number|null}>();
  const addresses=[...new Set(links.results.map(row=>row.linkedAddress))],owners=new Map<string,number>();
  for(let i=0;i<addresses.length;i+=90){
    const batch=addresses.slice(i,i+90);
    const rows=await db.prepare(`SELECT l.address,COUNT(*) AS owners FROM network_wallet_links l WHERE l.address IN (${batch.map(()=>'?').join(',')}) AND l.fid IN (${NETWORK_CURRENT_COHORT}) GROUP BY l.address`).bind(...batch).all<{address:string;owners:number}>();
    for(const row of rows.results)owners.set(row.address,row.owners);
  }
  const assets=[...new Set(links.results.flatMap(row=>(JSON.parse(row.positions??'[]') as PricedPosition[]).map(p=>p.id)))];
  const quotes=new Map<string,unknown>();
  for(let i=0;i<assets.length;i+=90){const batch=assets.slice(i,i+90);const rows=await db.prepare(`SELECT asset,payload FROM network_asset_prices WHERE asset IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all<{asset:string;payload:string}>();for(const row of rows.results)quotes.set(row.asset,JSON.parse(row.payload));}
  for(const fid of fids){
    const rows=links.results.filter(row=>row.fid===fid),measured=rows.filter(row=>row.address!==null);
    let usd=0n,stale=false;
    for(const row of measured){
      if(row.observed_at!<Date.now()-7*86_400_000)stale=true;
      for(const p of JSON.parse(row.positions!) as PricedPosition[]){
        const quote=acceptedQuote(quotes.get(p.id),p.id);
        if(quote&&p.decimals===(p.id===NATIVE_ASSET?18:quote.decimals))usd+=BigInt(p.balance)*decimalScale(String(quote.price),24)/10n**BigInt(p.decimals)/10n**16n;
        else {usd+=BigInt(p.usdUnits);if(p.quotedAt<Date.now()-7_200_000)stale=true;}
      }
    }
    const status:NetworkMember['wallet']['status']=rows.some(row=>(owners.get(row.linkedAddress)??0)>1)?'shared':!known.has(fid)?'pending':!rows.length?'no-wallet':measured.length===rows.length?'measured':measured.length?'partial':'pending';
    const visible=status==='measured'||status==='partial';
    output.set(fid,{status,usd:visible?`${usd/100_000_000n}.${(usd%100_000_000n).toString().padStart(8,'0')}`:null,expected:rows.length,measured:measured.length,
      observedAt:measured.length?Math.min(...measured.map(row=>row.observed_at!)):null,stale});
  }
  return output;
}
