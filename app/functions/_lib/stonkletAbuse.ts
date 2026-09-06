import { sha256Hex } from "./security.js";

/** Atomic, fixed-window limits. Stable hashed keys avoid storing IPs or growing a row per window. */
export async function allowStonkletAction(db: D1Database, scope: string, subject: string, limit: number, seconds = 60): Promise<boolean> {
  const key = `stonklets-limit:${scope}:${await sha256Hex(subject)}`;
  const row = await db.prepare(`INSERT INTO notification_job_state (job_key, value, updated_at)
    VALUES (?, '1', CURRENT_TIMESTAMP)
    ON CONFLICT(job_key) DO UPDATE SET
      value = CASE WHEN julianday(notification_job_state.updated_at) <= julianday('now', ?) THEN '1' ELSE CAST(CAST(notification_job_state.value AS INTEGER) + 1 AS TEXT) END,
      updated_at = CASE WHEN julianday(notification_job_state.updated_at) <= julianday('now', ?) THEN CURRENT_TIMESTAMP ELSE notification_job_state.updated_at END
    WHERE julianday(notification_job_state.updated_at) <= julianday('now', ?) OR CAST(notification_job_state.value AS INTEGER) < ?
    RETURNING value`).bind(key, `-${seconds} seconds`, `-${seconds} seconds`, `-${seconds} seconds`, limit).first();
  return Boolean(row);
}

const AVATAR_HOSTS = new Set(["imagedelivery.net", "res.cloudinary.com", "i.imgur.com", "pbs.twimg.com", "wrpcd.net", "i.seadn.io", "ipfs.decentralized-content.com"]);
export function allowedRenderAvatar(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && AVATAR_HOSTS.has(url.hostname);
  } catch { return false; }
}

/** No redirects, bounded transfer, and raster-only responses from explicitly trusted CDNs. */
export async function fetchRenderAvatar(raw: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (!allowedRenderAvatar(raw)) return null;
  try {
    const response = await fetch(raw, { redirect: "manual", signal: AbortSignal.timeout(4000) });
    const type = response.headers.get("content-type")?.split(";")[0];
    if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(type ?? "") || Number(response.headers.get("content-length")) > 512 * 1024) {
      await response.body?.cancel(); return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 512 * 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return { body: result, contentType: type! };
  } catch { return null; }
}
