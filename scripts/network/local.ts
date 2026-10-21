import { networkCountry } from '../../app/shared/network/normalize';
import { NETWORK_GEOGRAPHY_VERSION, resolveNetworkLocation } from '../../app/functions/_lib/network/geography';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advanceNetwork } from '../../app/functions/_lib/network/ingest';
import { refreshNetworkCandidates } from '../../app/functions/_lib/network/ingest';
import { publishSnapshot, type NetworkEnv } from '../../app/functions/_lib/network/store';
import { importWalletAssociations, importWalletValue, type WalletEnv } from '../../app/functions/_lib/network/wallets';
import { importNetworkActivity } from '../../app/functions/_lib/network/activity';
const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, 'app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const candidates = readdirSync(directory).filter(n => /^[a-f0-9]{64}\.sqlite$/.test(n));
if (candidates.length !== 1) throw new Error('Expected exactly one existing shared local D1 database');
const db = new DatabaseSync(resolve(directory, candidates[0]));
db.exec('PRAGMA busy_timeout=10000');
db.exec(readFileSync(resolve(root, 'migrations/0095_network.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0096_network_members.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0097_network_wallets.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0098_network_activity.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0099_network_alchemy.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0100_network_geography.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0101_network_geography_matching.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0102_network_warplet_holders.sql'), 'utf8'));
// Local counterpart of D1's prepared statements and atomic batch. All changes
// are restricted to network_* tables; unrelated migration state is untouched.
let inBatch=false;
async function waitForPublicRead(){
  // Workerd's emulator and Node SQLite share this file locally. Give a public
  // read a bounded window before the next write; no provider or production change.
  for(let i=0;i<1500;i++){
    let until=0;try{until=Number(readFileSync(resolve(root,'.tmp/network-public-read-lease'),'utf8'));}catch{}
    if(!Number.isFinite(until)||until<=Date.now())return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}
function prepare(sql: string) {
  let values: (string | number | null)[] = [];
  return {
    bind(...args: (string | number | null)[]) { values = args; return this; },
    async first(column?: string) { if(!inBatch&&/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))await waitForPublicRead(); const row = db.prepare(sql).get(...values); return row ? column ? row[column] : row : null; },
    async all() { if(!inBatch&&/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))await waitForPublicRead(); return { success: true, results: db.prepare(sql).all(...values), meta: {} }; },
    async run() { if(!inBatch)await waitForPublicRead(); const r = db.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  };
}
const d1 = { prepare, async batch(statements: ReturnType<typeof prepare>[]) { await waitForPublicRead(); db.exec('BEGIN IMMEDIATE'); inBatch=true; try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } finally {inBatch=false;} } } as unknown as D1Database;
const secrets = { ...process.env };
for (const file of ['.dev.vars','app/.dev.vars']) { try { for (const line of readFileSync(resolve(root,file),'utf8').split(/\r?\n/)) { const match=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/); if(match&&!secrets[match[1]]) secrets[match[1]]=match[2].trim().replace(/^(["'])(.*)\1$/,'$2'); } } catch {} }
const env: WalletEnv = { WARPLETS: d1, NETWORK_INGEST_ENABLED: 'true', NETWORK_RPC_URL: process.env.NETWORK_RPC_URL ?? 'https://1rpc.io/base', ALCHEMY_API_KEY: secrets.ALCHEMY_API_KEY, NETWORK_ALCHEMY_CU: secrets.NETWORK_ALCHEMY_CU, NEYNAR_API_KEY: secrets.NEYNAR_API_KEY, NETWORK_WALLET_CREDITS: secrets.NETWORK_WALLET_CREDITS, NETWORK_WALLETS_ENABLED: secrets.NETWORK_WALLETS_ENABLED,
  NETWORK_REQUESTS_PER_DAY: secrets.NETWORK_REQUESTS_PER_DAY, NETWORK_REQUESTS_PER_MONTH: secrets.NETWORK_REQUESTS_PER_MONTH, NETWORK_SCAN_BATCH: '50', NETWORK_PROFILE_BATCH: '100' };
const flag = (name: string) => process.argv.includes(name);
const count = Number(process.argv.find(a => a.startsWith('--steps='))?.split('=')[1] ?? 1);
if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('steps must be 1..1000');
try {
  if (flag('--alchemy') && !env.ALCHEMY_API_KEY) throw Error('Alchemy key is required for this importer');
  if (flag('--wallet-addresses')) { for (let i=0;i<count;i++) { const saved=await importWalletAssociations(env); console.log(JSON.stringify({step:i+1,associationFids:saved})); if (!saved) break; await new Promise(r=>setTimeout(r,250)); } console.log(JSON.stringify(db.prepare('SELECT COUNT(*) AS links,COUNT(DISTINCT address) AS uniqueWallets,COUNT(DISTINCT fid) AS withWallets FROM network_wallet_links').get())); }
  else if (flag('--wallet-values')) {
    try {
      for(let i=0;i<count;i++) {
        const result=await importWalletValue(env);
        if(i%10===0 || ['complete','cooldown','busy','waiting'].includes(result.status)) console.log(JSON.stringify({step:i+1,...result}));
        if(['complete','cooldown','busy','waiting'].includes(result.status)) break;
        if(i%100===99) await publishSnapshot(d1);
        await new Promise(r=>setTimeout(r,300));
      }
    } finally { await publishSnapshot(d1,true); }
    console.log(JSON.stringify(db.prepare('SELECT COUNT(*) AS measuredWallets,SUM(excluded) AS excludedBalances FROM network_wallet_values').get()));
  }
  else if (flag('--activity')) { for(let i=0;i<count;i++) { const result=await importNetworkActivity(env); console.log(JSON.stringify(result)); if(['complete','unavailable','cooldown','busy'].includes(result.status))break; } await publishSnapshot(d1,true); }
  else if (flag('--members')) await refreshNetworkCandidates(env, true);
  else if (flag('--geography')||flag('--geography-audit')) {
    const rows=db.prepare(`SELECT g.fid,g.description,g.country,g.state,g.city,g.observed_at AS observedAt FROM network_profile_locations g JOIN network_profiles p ON p.fid=g.fid AND p.observed_at=g.observed_at ORDER BY g.fid`).all() as {fid:number;description:string;country:string|null;state:string|null;city:string|null;observedAt:number}[];
    const summary={profiles:rows.length,nonempty:0,before:{countries:0,states:0,cities:0},after:{countries:0,states:0,cities:0},changed:0,applied:0,skipped:0,countryChanges:0,stateChanges:0,cityChanges:0,upstreamRequests:0,dryRun:flag('--geography-audit')};
    const changes:unknown[]=[],byCountry:Record<string,{profiles:number;beforeStates:number;afterStates:number;beforeCities:number;afterCities:number}>={};
    const cache=new Map<string,Awaited<ReturnType<typeof resolveNetworkLocation>>>();
    for(const row of rows){
      const country=networkCountry(row.description);let geo=cache.get(row.description);
      if(!geo){geo=await resolveNetworkLocation(d1,row.description,country);cache.set(row.description,geo);}
      if(row.description)summary.nonempty++;
      for(const [key,before,after] of [['countries',row.country,country],['states',row.state,geo.state],['cities',row.city,geo.city]] as const){if(before)summary.before[key]++;if(after)summary.after[key]++;}
      const group=byCountry[country??row.country??'UNKNOWN']??={profiles:0,beforeStates:0,afterStates:0,beforeCities:0,afterCities:0};group.profiles++;if(row.state)group.beforeStates++;if(geo.state)group.afterStates++;if(row.city)group.beforeCities++;if(geo.city)group.afterCities++;
      if(row.country!==country||row.state!==geo.state||row.city!==geo.city){
        summary.changed++;if(row.country!==country)summary.countryChanges++;if(row.state!==geo.state)summary.stateChanges++;if(row.city!==geo.city)summary.cityChanges++;
        changes.push({description:row.description,before:{country:row.country,state:row.state,city:row.city},after:{country,...geo}});
        if(!summary.dryRun){const results=await d1.batch([
          d1.prepare('UPDATE network_profile_locations SET country=?,state=?,city=? WHERE fid=? AND observed_at=? AND description=?').bind(country,geo.state,geo.city,row.fid,row.observedAt,row.description),
          d1.prepare('UPDATE network_profiles SET country=?,location_status=? WHERE fid=? AND observed_at=? AND EXISTS(SELECT 1 FROM network_profile_locations WHERE fid=? AND description=? AND observed_at=?)').bind(country,country?'known':'unknown',row.fid,row.observedAt,row.fid,row.description,row.observedAt),
        ]);if(results[0].meta.changes)summary.applied++;else summary.skipped++;}
      }
    }
    writeFileSync(resolve(root,summary.dryRun?'.tmp/network-geo/audit-preview.json':'.tmp/network-geo/audit-applied.json'),JSON.stringify({resolverVersion:NETWORK_GEOGRAPHY_VERSION,calculatedAt:Date.now(),sources:JSON.parse(readFileSync(resolve(root,'app/public/network/geography-sources.json'),'utf8')),summary,byCountry,changes},null,2));
    if(!summary.dryRun)await publishSnapshot(d1,true);
    console.log(JSON.stringify(summary));
  }
  else if (flag('--publish')) await publishSnapshot(d1, true);
  else if (!flag('--status')) {
    for (let i = 0; i < count; i++) {
      const result = await advanceNetwork(env, { scanOnly: flag('--scan'), profilesOnly: flag('--profiles') || flag('--location-backfill'), locationBackfillOnly: flag('--location-backfill'), publish: i === 0 || i === count - 1 });
      const cursor = db.prepare("SELECT value FROM network_sync WHERE key='scan'").get()?.value;
      console.log(JSON.stringify({ step: i + 1, ...result, scan: cursor ? JSON.parse(String(cursor)) : null }));
      const scan = cursor ? JSON.parse(String(cursor)) : null;
      if (flag('--scan') && scan && scan.block >= scan.target) break;
      if(flag('--location-backfill') && result.status==='busy') break;
      if ((flag('--profiles') || flag('--location-backfill')) && result.status === 'advanced' && result.profilesSaved === 0) { if(!flag('--location-backfill'))await publishSnapshot(d1, true); break; }
    }
  }
  console.log(JSON.stringify({ signers: db.prepare('SELECT COUNT(*) AS n FROM (SELECT fid FROM network_events UNION SELECT fid FROM network_confirmed)').get()?.n,
    profiles: db.prepare('SELECT COUNT(*) AS n FROM network_profiles').get()?.n,
    locationBackfill: db.prepare(`SELECT COUNT(*) AS remaining,SUM(CASE WHEN p.country IS NULL THEN 1 ELSE 0 END) AS unknownCountry FROM (SELECT fid FROM network_events UNION SELECT fid FROM network_confirmed) s JOIN network_profiles p ON p.fid=s.fid LEFT JOIN network_profile_locations g ON g.fid=p.fid WHERE g.fid IS NULL OR g.observed_at<>p.observed_at`).get(),
    snapshots: db.prepare('SELECT COUNT(*) AS n FROM network_snapshots').get()?.n }));
} finally { db.close(); }
