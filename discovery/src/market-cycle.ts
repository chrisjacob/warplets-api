import { CandidateSchema, DEFAULT_POLICY, shortlist } from "./model";
import { marketsForPools } from "./market";
import { candidates, captureCohort, control, reserveQuota } from "./store";
import { SourceError } from "./rpc";
import type { Settings } from "./ingest";

export async function runMarketCycle(settings: Settings, now = new Date()): Promise<Record<string, unknown>> {
  if (!settings.marketEnabled) return { state: "disabled" };
  const db = settings.db, at = now.toISOString();
  if ((await control(db)).paused) return { state: "paused" };
  const lease = await db.prepare(`UPDATE tenx_market_control SET lease_until=?1,next_refresh_at=?2 WHERE id=1
    AND (lease_until IS NULL OR lease_until<?3) AND (next_refresh_at IS NULL OR next_refresh_at<=?3) RETURNING id`)
    .bind(new Date(now.getTime() + 120000).toISOString(), new Date(now.getTime() + 180000).toISOString(), at).first();
  if (!lease) return { state: "waiting" };
  try {
    const all = await candidates(db), active = shortlist(all, DEFAULT_POLICY, now);
    const cohort = await db.prepare(`SELECT address FROM tenx_cohorts WHERE selected_at>=?1 GROUP BY address ORDER BY MIN(selected_at) DESC LIMIT 200`).bind(new Date(now.getTime() - 26 * 3600000).toISOString()).all<{ address: string }>();
    const tracked = new Set([...active.map(c => c.address), ...cohort.results.map(c => c.address)]);
    const attempts = await db.prepare("SELECT address,attempted_at FROM tenx_market_attempts").all<{ address: string; attempted_at: string }>();
    const attempted = new Map(attempts.results.map(row => [row.address, row.attempted_at]));
    const rows = all.filter(c => tracked.has(c.address)).sort((a, b) => (attempted.get(a.address) ?? "").localeCompare(attempted.get(b.address) ?? "") || a.address.localeCompare(b.address)).slice(0, 30);
    if (!rows.length) { await db.prepare("UPDATE tenx_market_control SET lease_until=NULL WHERE id=1").run(); return { state: "empty" }; }
    const reserve = reserveQuota(db, { rpc: settings.rpcDailyLimit, market: settings.marketDailyLimit }, now);
    const markets = await marketsForPools(rows, reserve, at, settings.transport);
    const statements: D1PreparedStatement[] = [];
    for (const row of rows) {
      statements.push(db.prepare("INSERT INTO tenx_market_attempts(address,attempted_at) VALUES(?1,?2) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at").bind(row.address, at));
      const market = markets.get(row.address); if (!market) continue;
      statements.push(db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.market',json(?1)) WHERE address=?2 AND mode='live'").bind(JSON.stringify(market), row.address));
      statements.push(db.prepare("INSERT OR IGNORE INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(row.address, at, JSON.stringify(market)));
    }
    statements.push(db.prepare("UPDATE tenx_market_control SET lease_until=NULL,last_success=?1,last_error=NULL WHERE id=1").bind(at));
    await db.batch(statements);
    for (const row of rows) if (markets.has(row.address)) {
      const saved = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1").bind(row.address).first<{ payload: string }>();
      if (saved) await captureCohort(db, CandidateSchema.parse(JSON.parse(saved.payload)), at);
    }
    return { state: "succeeded", requested: rows.length, updated: markets.size };
  } catch (error) {
    const code = error instanceof SourceError ? error.code : "market_schema_invalid";
    const retry = error instanceof SourceError ? error.retryAfterSeconds : 300;
    await db.prepare("UPDATE tenx_market_control SET lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1").bind(new Date(now.getTime() + retry * 1000).toISOString(), code).run();
    return { state: "failed", error_code: code };
  }
}
