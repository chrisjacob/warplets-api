/**
 * KV helpers for Farcaster notification token storage.
 *
 * Tokens are stored in Cloudflare KV under the key:
 *   miniapp:token:{fid}
 *
 * Value shape matches MiniAppNotificationDetails from @farcaster/miniapp-sdk:
 *   { url: string; token: string }
 */

export interface NotificationDetails {
  url: string;
  token: string;
}

function tokenKey(fid: number): string {
  return `miniapp:token:${fid}`;
}

export async function getNotificationToken(
  kv: KVNamespace,
  fid: number
): Promise<NotificationDetails | null> {
  return kv.get<NotificationDetails>(tokenKey(fid), "json");
}

export async function setNotificationToken(
  kv: KVNamespace,
  fid: number,
  details: NotificationDetails
): Promise<void> {
  await kv.put(tokenKey(fid), JSON.stringify(details));
}

export async function deleteNotificationToken(
  kv: KVNamespace,
  fid: number
): Promise<void> {
  await kv.delete(tokenKey(fid));
}
