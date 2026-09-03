import { stonkletChangeRangeSeconds, type StonkletChangeRange } from "../../shared/stonkletsTime.js";

export interface StonkletHistorySnapshot {
  pairId: string;
  price: number | null;
  marketCap: number | null;
  updatedAt: string | null;
}

export interface StonkletHistoryPoint { time: number; price: number }

type HistoryGranularity = "5m" | "1h" | "1d";

interface HistoryRow { bucket_at: string; price: number }

export function historyGranularity(range: StonkletChangeRange): HistoryGranularity {
  if (range === "1h" || range === "24h") return "5m";
  if (range === "all") return "1d";
  return "1h";
}

function bucketIso(timestamp: string, granularity: HistoryGranularity): string | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  const bucketMs = granularity === "5m" ? 5 * 60_000 : granularity === "1h" ? 60 * 60_000 : 24 * 60 * 60_000;
  return new Date(Math.floor(parsed / bucketMs) * bucketMs).toISOString();
}

export function mergeStonkletHistoryPoints(...groups: readonly StonkletHistoryPoint[][]): StonkletHistoryPoint[] {
  const byTime = new Map<number, StonkletHistoryPoint>();
  for (const group of groups) for (const point of group) {
    if (Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0) byTime.set(Math.floor(point.time), { time: Math.floor(point.time), price: point.price });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export async function persistStonkletHistory(db: D1Database, snapshots: readonly StonkletHistorySnapshot[], now = new Date()): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.price == null || !Number.isFinite(snapshot.price) || snapshot.price <= 0 || !snapshot.updatedAt) continue;
    for (const granularity of ["5m", "1h", "1d"] as const) {
      const bucketAt = bucketIso(snapshot.updatedAt, granularity);
      if (!bucketAt) continue;
      statements.push(db.prepare(
        `INSERT INTO stonklet_market_history
          (pair_id, granularity, bucket_at, price, market_cap, source_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(pair_id, granularity, bucket_at) DO UPDATE SET
           price = excluded.price,
           market_cap = excluded.market_cap,
           source_updated_at = excluded.source_updated_at
         WHERE excluded.source_updated_at >= stonklet_market_history.source_updated_at`,
      ).bind(snapshot.pairId, granularity, bucketAt, snapshot.price, snapshot.marketCap, snapshot.updatedAt));
    }
  }
  statements.push(
    db.prepare("DELETE FROM stonklet_market_history WHERE granularity = '5m' AND bucket_at < ?").bind(new Date(now.getTime() - 48 * 60 * 60_000).toISOString()),
    db.prepare("DELETE FROM stonklet_market_history WHERE granularity = '1h' AND bucket_at < ?").bind(new Date(now.getTime() - 90 * 24 * 60 * 60_000).toISOString()),
  );
  await db.batch(statements);
}

export async function loadLocalStonkletHistory(db: D1Database, pairId: string, range: StonkletChangeRange, now = Date.now()): Promise<StonkletHistoryPoint[]> {
  const granularity = historyGranularity(range);
  const seconds = stonkletChangeRangeSeconds(range);
  const cutoff = seconds == null ? null : new Date(now - seconds * 1000).toISOString();
  const statement = cutoff
    ? db.prepare("SELECT bucket_at, price FROM stonklet_market_history WHERE pair_id = ? AND granularity = ? AND bucket_at >= ? ORDER BY bucket_at").bind(pairId, granularity, cutoff)
    : db.prepare("SELECT bucket_at, price FROM stonklet_market_history WHERE pair_id = ? AND granularity = ? ORDER BY bucket_at").bind(pairId, granularity);
  const result = await statement.all<HistoryRow>().catch(() => ({ results: [] as HistoryRow[] }));
  return (result.results ?? []).flatMap((row) => {
    const time = Date.parse(row.bucket_at);
    const price = Number(row.price);
    return Number.isFinite(time) && Number.isFinite(price) && price > 0 ? [{ time: Math.floor(time / 1000), price }] : [];
  });
}
