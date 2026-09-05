import { STONKLETS_CATALOG, emptyMarketMetrics } from "../../shared/stonkletsCatalog.js";
import { dailyTopBody, dailyTopDate, selectDailyTopTokens, type DailyTopToken } from "../../shared/stonkletsDailyTop.js";
import { loadStockMetricsBatch, loadStockPeriodChanges } from "./stonkletMarket.js";
import { loadStonkletDemoMarket, loadStonkletPeriodChanges, marketSnapshotsByPair, type StonkletMarketIngestEnv } from "./stonkletIngestion.js";
import { loadCmcMarket, mergeCmcMetrics } from "./stonkletCmc.js";
import { dispatchNotification } from "./dispatch.js";
import { buildClickTrackingUrl } from "./notificationTracking.js";

export interface StonkletsDailyNotificationEnv extends StonkletMarketIngestEnv {
  STONKLETS_DAILY_NOTIFICATIONS_ENABLED?: string;
}

async function loadDailyTop(env: StonkletsDailyNotificationEnv): Promise<DailyTopToken[]> {
  const [stocks, stockChanges, snapshots, cmc] = await Promise.all([
    loadStockMetricsBatch(STONKLETS_CATALOG, env.WARPLETS_KV),
    loadStockPeriodChanges(STONKLETS_CATALOG, "24h", env.WARPLETS_KV),
    loadStonkletDemoMarket(env), loadCmcMarket(env),
  ]);
  const stonkletChanges = await loadStonkletPeriodChanges(env, "24h", snapshots);
  const byPair = marketSnapshotsByPair(snapshots);
  const candidates: DailyTopToken[] = [];
  for (const entry of STONKLETS_CATALOG) {
    for (const asset of ["stock", "stonklet"] as const) {
      if (asset === "stonklet" && entry.launchStatus !== "launched") continue;
      const metrics = mergeCmcMetrics((asset === "stock" ? stocks.get(entry.id) : byPair.get(entry.id)?.metrics) ?? emptyMarketMetrics(), cmc.get(`${entry.id}:${asset}`));
      const change = (asset === "stock" ? stockChanges : stonkletChanges).get(entry.id) ?? null;
      candidates.push({ id: entry.id, asset, symbol: entry[asset].symbol, change, marketCap: metrics.marketCap });
    }
  }
  return selectDailyTopTokens(candidates);
}

/** Cron processes a bounded batch; the daily body is frozen and dispatch IDs
 * are stable across retries. Only this app's enabled Farcaster tokens qualify. */
export async function runStonkletsDailyNotifications(env: StonkletsDailyNotificationEnv): Promise<number> {
  if (!/^(1|true)$/i.test(env.STONKLETS_DAILY_NOTIFICATIONS_ENABLED ?? "")) return 0;
  const day = dailyTopDate(new Date());
  if (!day) return 0;
  const db = env.WARPLETS;
  const campaignId = `stonklets:daily-top:${day}`;
  const lockKey = "stonklets:daily-top:lock";
  const owner = crypto.randomUUID();
  const lock = await db.prepare(`INSERT INTO notification_job_state (job_key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(job_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    WHERE julianday(notification_job_state.updated_at) < julianday('now', '-10 minutes') RETURNING value`)
    .bind(lockKey, owner).first<{ value: string }>();
  if (lock?.value !== owner) return 0;
  try {
    const recipients = await db.prepare(`SELECT t.fid, t.notification_url, t.notification_token
      FROM miniapp_notification_tokens t
      LEFT JOIN notification_dispatches d ON d.fid = t.fid AND d.notification_id = ?
      WHERE t.app_slug = 'stonklets' AND t.enabled = 1
        AND (d.id IS NULL OR (d.status NOT IN ('delivered', 'invalid') AND d.attempt_count < 6
          AND julianday(d.updated_at) <= julianday('now', '-5 minutes')))
      ORDER BY COALESCE(d.attempt_count, 0), t.fid LIMIT 50`)
      .bind(campaignId).all<{ fid: number; notification_url: string; notification_token: string }>();
    if (!recipients.results?.length) return 0;
    let body = (await db.prepare("SELECT value FROM notification_job_state WHERE job_key = ?").bind(campaignId).first<{ value: string }>())?.value;
    if (!body) {
      const top = await loadDailyTop(env);
      if (!top.length) return 0;
      body = dailyTopBody(top);
      if (body.length > 128) throw new Error("Daily Top notification exceeds 128 characters");
      await db.prepare("INSERT OR IGNORE INTO notification_job_state (job_key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
        .bind(campaignId, body).run();
    }
    let sent = 0;
    const deadline = Date.now() + 45_000;
    for (const token of recipients.results) {
      if (Date.now() >= deadline) break;
      // Renew the lease before each network send and stop if another worker took it.
      const lease = await db.prepare("UPDATE notification_job_state SET updated_at = CURRENT_TIMESTAMP WHERE job_key = ? AND value = ? RETURNING value")
        .bind(lockKey, owner).first<{ value: string }>();
      if (!lease) break;
      const result = await dispatchNotification(db, {
        signal: AbortSignal.timeout(15_000),
        fid: token.fid, appSlug: "stonklets", notificationUrl: token.notification_url, notificationToken: token.notification_token,
        notificationId: campaignId, title: "Stonklets", body,
        targetUrl: buildClickTrackingUrl({ notificationId: campaignId, appSlug: "stonklets", fid: token.fid,
          trackingBaseUrl: "https://stonklet.10x.meme", targetUrl: "https://stonklet.10x.meme/?change=24h&order=change&dir=desc" }),
      });
      if (result.state === "success") sent++;
    }
    return sent;
  } finally {
    await db.prepare("DELETE FROM notification_job_state WHERE job_key = ? AND value = ?").bind(lockKey, owner).run();
  }
}
