import {
  NOTIFICATION_SCOPE,
  deriveNotice,
  notificationSettings,
} from "./notifications";
import { canonical } from "../shared/canonical";
import { one, rows, run, sha, random, requireThat, type Database } from "./db";
export interface BaseNoticeConfig {
  scope: typeof NOTIFICATION_SCOPE;
  origin: string;
  mode: "fake";
  maximumRequestsPerMinute: number;
}
export interface BaseStatusObservation {
  appUrl: string;
  wallet: string;
  appPinned: boolean | null;
  notificationsEnabled: boolean | null;
  observedAt: number;
  proofHash: string;
}
type Notice = Awaited<ReturnType<typeof deriveNotice>>;
export interface BaseNoticePayload {
  app_url: string;
  wallet_addresses: string[];
  title: string;
  message: string;
  target_path: string;
}
export interface FakeBaseNoticeTransport {
  mode: "fake";
  status(wallet: string, appUrl: string): Promise<BaseStatusObservation>;
  send(
    id: string,
    payload: BaseNoticePayload,
  ): Promise<"sent" | "invalid" | "rate-limited">;
  receipt(id: string): Promise<"sent" | "unknown">;
}
function configuration(c: BaseNoticeConfig) {
  const u = new URL(c.origin);
  requireThat(
    c.scope === NOTIFICATION_SCOPE &&
      c.mode === "fake" &&
      u.origin === c.origin &&
      !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) &&
      Number.isSafeInteger(c.maximumRequestsPerMinute) &&
      c.maximumRequestsPerMinute >= 0 &&
      c.maximumRequestsPerMinute <= 20,
    503,
    "Isolated Base notification configuration required",
  );
}
const normalize = (wallet: string) => {
  requireThat(
    typeof wallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(wallet),
    400,
    "Verified Base wallet required",
  );
  return wallet.toLowerCase();
};
async function linked(db: Database, fid: number, wallet: string) {
  const links = await rows<{ fid: number }>(
    db,
    "SELECT fid FROM meme_wallet_links WHERE chain='base' AND address=? AND revoked_at IS NULL LIMIT 2",
    wallet,
  );
  return links.length === 1 && links[0].fid === fid;
}
/** Persistent per-app pacing and attempt accounting. The only configured transport is fake. */
export async function reserveBaseNoticeRequest(
  db: Database,
  c: BaseNoticeConfig,
  now: number,
) {
  configuration(c);
  if (!c.maximumRequestsPerMinute) return false;
  const minute = Math.floor(now / 60000);
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO meme_base_notification_pacer SELECT ?,?,? WHERE COALESCE((SELECT used FROM meme_base_notification_request_usage WHERE scope=? AND app_url=? AND minute=?),0)<? ON CONFLICT(scope,app_url) DO UPDATE SET next_at=excluded.next_at WHERE meme_base_notification_pacer.next_at<=?",
      )
      .bind(
        c.scope,
        c.origin,
        now + 3100,
        c.scope,
        c.origin,
        minute,
        c.maximumRequestsPerMinute,
        now,
      ),
    db
      .prepare(
        "INSERT INTO meme_base_notification_request_usage SELECT ?,?,?,1 WHERE changes()=1 ON CONFLICT(scope,app_url,minute) DO UPDATE SET used=used+1 WHERE used<?",
      )
      .bind(c.scope, c.origin, minute, c.maximumRequestsPerMinute),
  ]);
  return result[1].meta.changes === 1;
}
export async function syncBaseNoticeStatus(
  db: Database,
  c: BaseNoticeConfig,
  fid: number,
  wallet: string,
  adapter: FakeBaseNoticeTransport,
  now = Date.now(),
) {
  configuration(c);
  requireThat(
    adapter.mode === "fake",
    403,
    "Real Base notification requests are disabled",
  );
  wallet = normalize(wallet);
  requireThat(
    await linked(db, fid, wallet),
    403,
    "Base wallet is not exclusively linked to this identity",
  );
  if (!(await reserveBaseNoticeRequest(db, c, now)))
    return { state: "unknown", deferred: true };
  let observation: BaseStatusObservation;
  try {
    observation = await adapter.status(wallet, c.origin);
  } catch {
    observation = {
      wallet,
      appUrl: c.origin,
      appPinned: null,
      notificationsEnabled: null,
      observedAt: now,
      proofHash: await sha("Base status unavailable"),
    };
  }
  requireThat(
    observation.wallet.toLowerCase() === wallet &&
      observation.appUrl === c.origin &&
      Number.isSafeInteger(observation.observedAt) &&
      observation.observedAt <= now + 1000 &&
      now - observation.observedAt <= 300000 &&
      /^[a-f0-9]{64}$/.test(observation.proofHash) &&
      [true, false, null].includes(observation.appPinned) &&
      [true, false, null].includes(observation.notificationsEnabled),
    409,
    "Base status does not match the registered app/wallet or freshness",
  );
  const state =
    observation.appPinned === null || observation.notificationsEnabled === null
      ? "unknown"
      : observation.appPinned && observation.notificationsEnabled
        ? "enabled"
        : "disabled";
  await db
    .prepare(
      "INSERT INTO meme_base_notification_status VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope,app_url,wallet) DO UPDATE SET fid=excluded.fid,status=excluded.status,observed_at=excluded.observed_at,proof_hash=excluded.proof_hash WHERE excluded.observed_at>=meme_base_notification_status.observed_at",
    )
    .bind(
      c.scope,
      c.origin,
      wallet,
      fid,
      state,
      observation.observedAt,
      observation.proofHash,
    )
    .run();
  return { state, deferred: false };
}
export async function enqueueBaseNotice(
  db: Database,
  c: BaseNoticeConfig,
  kind: Notice["kind"],
  subject: string,
  fid: number,
  wallet: string,
  now = Date.now(),
) {
  configuration(c);
  wallet = normalize(wallet);
  const settings = await notificationSettings(db, fid);
  if (!settings.enabled || !settings[kind]) return { queued: false };
  requireThat(
    await linked(db, fid, wallet),
    403,
    "Base wallet identity changed",
  );
  const status = await one<{ status: string; observed_at: number }>(
    db,
    "SELECT status,observed_at FROM meme_base_notification_status WHERE scope=? AND app_url=? AND wallet=? AND fid=?",
    c.scope,
    c.origin,
    wallet,
    fid,
  );
  if (
    !status ||
    status.status !== "enabled" ||
    status.observed_at > now + 1000 ||
    now - status.observed_at > 300000
  )
    return { queued: false, permission: "unknown-or-disabled" };
  const notice = await deriveNotice(db, c, kind, subject, fid, now),
    eventId = notice.notificationId,
    id =
      "base:" + (await sha(canonical({ eventId, wallet, origin: c.origin }))),
    day = Math.floor(now / 86400000) * 86400000;
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_notification_events SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM meme_notification_events WHERE fid=? AND created_at>=? AND created_at<?)<3",
      )
      .bind(
        eventId,
        kind,
        subject,
        fid,
        canonical(notice),
        now,
        fid,
        day,
        day + 86400000,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_base_notification_outbox(id,event_id,scope,app_url,wallet,fid,state,retry_at,created_at) SELECT ?,?,?,?,?,?,'queued',?,? WHERE EXISTS(SELECT 1 FROM meme_notification_events WHERE id=?)",
      )
      .bind(id, eventId, c.scope, c.origin, wallet, fid, now, now, eventId),
  ]);
  return {
    queued: !!(await one(
      db,
      "SELECT id FROM meme_base_notification_outbox WHERE id=?",
      id,
    )),
    id,
  };
}
export function baseNoticePayload(
  c: BaseNoticeConfig,
  wallet: string,
  notice: Notice,
  id: string,
): BaseNoticePayload {
  const target = new URL(notice.targetUrl);
  requireThat(
    target.origin === c.origin &&
      notice.title.length <= 30 &&
      notice.body.length <= 200,
    400,
    "Base notification destination/content invalid",
  );
  target.searchParams.set("baseNotificationId", id);
  const path = target.pathname + target.search;
  requireThat(path.length <= 500, 400, "Base notification path too long");
  return {
    app_url: c.origin,
    wallet_addresses: [normalize(wallet)],
    title: notice.title,
    message: notice.body,
    target_path: path,
  };
}
export async function drainBaseNotices(
  db: Database,
  c: BaseNoticeConfig,
  adapter: FakeBaseNoticeTransport,
  now = Date.now(),
) {
  configuration(c);
  requireThat(adapter.mode === "fake", 403, "Real Base delivery is disabled");
  if (
    (
      await one<{ paused: number }>(
        db,
        "SELECT paused FROM meme_notification_control WHERE id=1",
      )
    )?.paused !== 0
  )
    return { processed: 0, paused: true };
  const due = await rows<{
    id: string;
    fid: number;
    wallet: string;
    attempts: number;
    state: string;
    payload: string;
  }>(
    db,
    "SELECT o.id,o.fid,o.wallet,o.attempts,o.state,e.payload FROM meme_base_notification_outbox o JOIN meme_notification_events e ON e.id=o.event_id WHERE o.scope=? AND o.app_url=? AND (o.state IN('queued','retry') AND retry_at<=? OR o.state='processing' AND lease_until<=?) ORDER BY retry_at,o.id LIMIT 20",
    c.scope,
    c.origin,
    now,
    now,
  );
  let processed = 0;
  for (const row of due) {
    if (row.state === "processing") {
      const receipt = await adapter.receipt(row.id).catch(() => "unknown");
      await run(
        db,
        "UPDATE meme_base_notification_outbox SET state=?,lease=NULL,lease_until=NULL WHERE id=? AND state='processing' AND lease_until<=?",
        receipt === "sent" ? "sent" : "unknown",
        row.id,
        now,
      );
      continue;
    }
    const notice = JSON.parse(row.payload) as Notice,
      settings = await notificationSettings(db, row.fid),
      status = await one<{ status: string; observed_at: number }>(
        db,
        "SELECT status,observed_at FROM meme_base_notification_status WHERE scope=? AND app_url=? AND wallet=? AND fid=?",
        c.scope,
        c.origin,
        row.wallet,
        row.fid,
      );
    if (
      !settings.enabled ||
      !settings[notice.kind] ||
      !status ||
      status.status !== "enabled" ||
      now - status.observed_at > 300000 ||
      status.observed_at > now + 1000 ||
      !(await linked(db, row.fid, row.wallet)) ||
      notice.expiresAt <= now ||
      row.attempts >= 5
    ) {
      await run(
        db,
        "UPDATE meme_base_notification_outbox SET state='cancelled' WHERE id=? AND state IN('queued','retry')",
        row.id,
      );
      continue;
    }
    const lease = random(),
      claim = await run(
        db,
        "UPDATE meme_base_notification_outbox SET state='processing',lease=?,lease_until=? WHERE id=? AND state IN('queued','retry') AND retry_at<=?",
        lease,
        now + 60000,
        row.id,
        now,
      );
    if (claim.meta.changes !== 1) continue;
    if (!(await reserveBaseNoticeRequest(db, c, now))) {
      await run(
        db,
        "UPDATE meme_base_notification_outbox SET state='retry',retry_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
        now + 3100,
        row.id,
        lease,
      );
      continue;
    }
    await run(
      db,
      "UPDATE meme_base_notification_outbox SET attempts=attempts+1 WHERE id=? AND lease=?",
      row.id,
      lease,
    );
    try {
      const current = await notificationSettings(db, row.fid),
        paused = await one<{ paused: number }>(
          db,
          "SELECT paused FROM meme_notification_control WHERE id=1",
        );
      const currentStatus = await one<{ status: string; observed_at: number }>(
        db,
        "SELECT status,observed_at FROM meme_base_notification_status WHERE scope=? AND app_url=? AND wallet=? AND fid=?",
        c.scope,
        c.origin,
        row.wallet,
        row.fid,
      );
      if (
        !current.enabled ||
        !current[notice.kind] ||
        paused?.paused !== 0 ||
        !currentStatus ||
        currentStatus.status !== "enabled" ||
        now - currentStatus.observed_at > 300000 ||
        !(await linked(db, row.fid, row.wallet))
      ) {
        await run(
          db,
          "UPDATE meme_base_notification_outbox SET state='cancelled',lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
          row.id,
          lease,
        );
        continue;
      }
      const result = await adapter.send(
        row.id,
        baseNoticePayload(c, row.wallet, notice, row.id),
      );
      requireThat(
        ["sent", "invalid", "rate-limited"].includes(result),
        502,
        "Unknown Base delivery outcome",
      );
      await db.batch([
        db
          .prepare(
            "UPDATE meme_base_notification_outbox SET state=?,retry_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
          )
          .bind(
            result === "sent"
              ? "sent"
              : result === "invalid"
                ? "cancelled"
                : "retry",
            now + Math.min(3600000, 60000 * 2 ** row.attempts),
            row.id,
            lease,
          ),
        ...(result === "invalid"
          ? [
              db
                .prepare(
                  "UPDATE meme_base_notification_status SET status='disabled' WHERE scope=? AND app_url=? AND wallet=? AND observed_at=?",
                )
                .bind(c.scope, c.origin, row.wallet, status.observed_at),
            ]
          : []),
      ]);
      processed++;
    } catch {
      await run(
        db,
        "UPDATE meme_base_notification_outbox SET state='unknown',lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
        row.id,
        lease,
      );
    }
  }
  return { processed };
}
export async function reconcileBaseNotice(
  db: Database,
  id: string,
  adapter: FakeBaseNoticeTransport,
) {
  requireThat(adapter.mode === "fake", 403, "Real Base delivery is disabled");
  const result = await adapter.receipt(id).catch(() => "unknown");
  if (result === "sent")
    await run(
      db,
      "UPDATE meme_base_notification_outbox SET state='sent' WHERE id=? AND state='unknown'",
      id,
    );
  return { result };
}
