import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { advanceNetwork } from '../../app/functions/_lib/network/ingest';
import { refreshNetworkCandidates } from '../../app/functions/_lib/network/ingest';
import { publishSnapshot, type NetworkEnv } from '../../app/functions/_lib/network/store';
import { importWalletAssociations, importWalletValue, type WalletEnv } from '../../app/functions/_lib/network/wallets';
const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, 'app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const candidates = readdirSync(directory).filter(n => /^[a-f0-9]{64}\.sqlite$/.test(n));
if (candidates.length !== 1) throw new Error('Expected exactly one existing shared local D1 database');
const db = new DatabaseSync(resolve(directory, candidates[0]));
db.exec('PRAGMA busy_timeout=10000');
db.exec(readFileSync(resolve(root, 'migrations/0095_network.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0096_network_members.sql'), 'utf8'));
db.exec(readFileSync(resolve(root, 'migrations/0097_network_wallets.sql'), 'utf8'));
// Local counterpart of D1's prepared statements and atomic batch. All changes
// are restricted to network_* tables; unrelated migration state is untouched.
function prepare(sql: string) {
  let values: (string | number | null)[] = [];
  return {
    bind(...args: (string | number | null)[]) { values = args; return this; },
    async first(column?: string) { const row = db.prepare(sql).get(...values); return row ? column ? row[column] : row : null; },
    async all() { return { success: true, results: db.prepare(sql).all(...values), meta: {} }; },
    async run() { const r = db.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
  };
}
const d1 = { prepare, async batch(statements: ReturnType<typeof prepare>[]) { db.exec('BEGIN IMMEDIATE'); try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } } } as unknown as D1Database;
const secrets = { ...process.env };
for (const file of ['.dev.vars','app/.dev.vars']) { try { for (const line of readFileSync(resolve(root,file),'utf8').split(/\r?\n/)) { const match=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/); if(match&&!secrets[match[1]]) secrets[match[1]]=match[2].trim().replace(/^(["'])(.*)\1$/,'$2'); } } catch {} }
const env: WalletEnv = { WARPLETS: d1, NETWORK_INGEST_ENABLED: 'true', NETWORK_RPC_URL: process.env.NETWORK_RPC_URL ?? 'https://1rpc.io/base', NEYNAR_API_KEY: secrets.NEYNAR_API_KEY, NETWORK_WALLET_CREDITS: secrets.NETWORK_WALLET_CREDITS, NETWORK_WALLETS_ENABLED: secrets.NETWORK_WALLETS_ENABLED,
  NETWORK_SCAN_BATCH: '50', NETWORK_PROFILE_BATCH: '100' };
const flag = (name: string) => process.argv.includes(name);
const count = Number(process.argv.find(a => a.startsWith('--steps='))?.split('=')[1] ?? 1);
if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('steps must be 1..1000');
try {
  if (flag('--wallet-addresses')) { for (let i=0;i<count;i++) { const saved=await importWalletAssociations(env); console.log(JSON.stringify({step:i+1,associationFids:saved})); if (!saved) break; await new Promise(r=>setTimeout(r,250)); } console.log(JSON.stringify(db.prepare('SELECT COUNT(*) AS links,COUNT(DISTINCT address) AS uniqueWallets,COUNT(DISTINCT fid) AS withWallets FROM network_wallet_links').get())); }
  else if (flag('--wallet-values')) {
    try {
      for(let i=0;i<count;i++) {
        const result=await importWalletValue(env);
        if(i%10===0) console.log(JSON.stringify({step:i+1,...result}));
        if(['complete','cooldown','busy','waiting'].includes(result.status)) break;
        if(i%100===99) await publishSnapshot(d1,true);
        await new Promise(r=>setTimeout(r,300));
      }
    } finally { await publishSnapshot(d1,true); }
    console.log(JSON.stringify(db.prepare('SELECT COUNT(*) AS measuredWallets,SUM(excluded) AS excludedBalances FROM network_wallet_values').get()));
  }
  else if (flag('--members')) await refreshNetworkCandidates(env, true);
  else if (flag('--publish')) await publishSnapshot(d1, true);
  else if (!flag('--status')) {
    for (let i = 0; i < count; i++) {
      const result = await advanceNetwork(env, { scanOnly: flag('--scan'), profilesOnly: flag('--profiles'), publish: i === 0 || i === count - 1 });
      const cursor = db.prepare("SELECT value FROM network_sync WHERE key='scan'").get()?.value;
      console.log(JSON.stringify({ step: i + 1, ...result, scan: cursor ? JSON.parse(String(cursor)) : null }));
      const scan = cursor ? JSON.parse(String(cursor)) : null;
      if (flag('--scan') && scan && scan.block >= scan.target) break;
      if (flag('--profiles') && result.status === 'advanced' && result.profilesSaved === 0) { await publishSnapshot(d1, true); break; }
    }
  }
  console.log(JSON.stringify({ signers: db.prepare('SELECT COUNT(*) AS n FROM (SELECT fid FROM network_events UNION SELECT fid FROM network_confirmed)').get()?.n,
    profiles: db.prepare('SELECT COUNT(*) AS n FROM network_profiles').get()?.n,
    snapshots: db.prepare('SELECT COUNT(*) AS n FROM network_snapshots').get()?.n }));
} finally { db.close(); }
