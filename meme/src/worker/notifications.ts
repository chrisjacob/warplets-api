import { parseWebhookEvent, type VerifyAppKey } from "@farcaster/miniapp-node";
import { canonical } from "../shared/canonical";
import {
  one,
  rows,
  run,
  sha,
  json,
  payload,
  requireThat,
  random,
  type Database,
} from "./db";
import { principal } from "./auth";
export const NOTIFICATION_SCOPE = "10x-launchpad-local-v1";
export interface NotificationConfig {
  scope: typeof NOTIFICATION_SCOPE;
  origin: string;
  clientFids: readonly number[];
  receiverUrls: readonly string[];
  encryptionKey: Uint8Array;
  mode: "fake";
}
type Settings = {
  enabled: number;
  voting: number;
  launch: number;
  rewards: number;
  milestones?: number;
};
type EventKind = "voting" | "launch" | "rewards" | "milestones";
interface Notice {
  notificationId: string;
  title: string;
  body: string;
  targetUrl: string;
  kind: EventKind;
  subject: string;
  mode: "simulated" | "observed";
  expiresAt: number;
}
const encode = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function configValid(c: NotificationConfig) {
  requireThat(
    c.scope === NOTIFICATION_SCOPE &&
      c.mode === "fake" &&
      c.encryptionKey?.length === 32 &&
      new URL(c.origin).origin === c.origin &&
      c.clientFids.length > 0 &&
      c.clientFids.every((n) => Number.isSafeInteger(n) && n > 0),
    503,
    "Isolated notification configuration required",
  );
}
async function secret(
  c: NotificationConfig,
  fid: number,
  client: number,
  token: string | null,
  cipher?: string,
) {
  const key = await crypto.subtle.importKey(
      "raw",
      c.encryptionKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    ),
    aad = new TextEncoder().encode(`${c.scope}:${c.origin}:${fid}:${client}`);
  if (token !== null) {
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      bytes = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        key,
        new TextEncoder().encode(token),
      );
    return encode(iv) + "." + encode(new Uint8Array(bytes));
  }
  const [iv, bytes, ...rest] = (cipher ?? "").split(".");
  requireThat(!rest.length && iv && bytes, 503, "Token unavailable");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(iv), additionalData: aad },
      key,
      decode(bytes),
    ),
  );
}
/** The injected verifier must establish the signing key's current FID/requester association. No provider call is implicit. */
export async function acceptSignedNotification(
  db: Database,
  raw: unknown,
  c: NotificationConfig,
  verifyAppKey: VerifyAppKey,
  now = Date.now(),
) {
  configValid(c);
  requireThat(canonical(raw).length <= 16000, 413, "Webhook too large");
  const verified = await parseWebhookEvent(raw, verifyAppKey),
    { fid, appFid, event } = verified;
  requireThat(c.clientFids.includes(appFid), 403, "Unapproved signing client");
  const eventId = await sha(canonical(raw));
  if (
    await one(
      db,
      "SELECT id FROM meme_notification_webhooks WHERE id=?",
      eventId,
    )
  )
    return { replayed: true };
  const disable = ["notifications_disabled", "miniapp_removed"].includes(
      event.event,
    ),
    details =
      "notificationDetails" in event ? event.notificationDetails : undefined;
  requireThat(
    disable || ["notifications_enabled", "miniapp_added"].includes(event.event),
    400,
    "Unsupported notification event",
  );
  let cipher: string | null = null,
    url: string | null = null;
  if (details) {
    const receiver = new URL(details.url);
    requireThat(
      receiver.protocol === "https:" &&
        !receiver.username &&
        !receiver.password &&
        !receiver.hash &&
        c.receiverUrls.includes(receiver.href) &&
        typeof details.token === "string" &&
        details.token.length > 0 &&
        details.token.length <= 2048,
      400,
      "Unapproved notification receiver/token",
    );
    url = receiver.href;
    cipher = await secret(c, fid, appFid, details.token);
  }
  const acceptToken = random();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_notification_webhooks VALUES(?,?,?,?,?,?,?)",
      )
      .bind(eventId, c.scope, fid, appFid, event.event, now, acceptToken),
    db
      .prepare(
        "INSERT INTO meme_notification_subscriptions SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meme_notification_webhooks WHERE id=? AND accept_token=?) ON CONFLICT(scope,fid,client_fid) DO UPDATE SET url=excluded.url,encrypted_token=excluded.encrypted_token,enabled=excluded.enabled,updated_at=excluded.updated_at",
      )
      .bind(
        c.scope,
        fid,
        appFid,
        url,
        cipher,
        !disable && details ? 1 : 0,
        now,
        eventId,
        acceptToken,
      ),
    // Explicit in-app opt-in is required again after a host disable/removal. An old enable event never overrides opt-out.
    ...(disable
      ? [
          db
            .prepare(
              "UPDATE meme_notification_settings SET enabled=0,updated_at=? WHERE fid=? AND EXISTS(SELECT 1 FROM meme_notification_webhooks WHERE id=? AND accept_token=?)",
            )
            .bind(now, fid, eventId, acceptToken),
          db
            .prepare(
              "UPDATE meme_notification_outbox SET state='cancelled',lease=NULL,lease_until=NULL WHERE scope=? AND fid=? AND client_fid=? AND state IN('queued','retry') AND EXISTS(SELECT 1 FROM meme_notification_webhooks WHERE id=? AND accept_token=?)",
            )
            .bind(c.scope, fid, appFid, eventId, acceptToken),
        ]
      : []),
  ]);
  return { replayed: false };
}
export async function notificationSettings(
  db: Database,
  fid: number,
): Promise<Settings> {
  return (
    (await one<Settings>(
      db,
      "SELECT enabled,voting,launch,rewards,milestones FROM meme_notification_settings WHERE fid=?",
      fid,
    )) ?? { enabled: 0, voting: 1, launch: 1, rewards: 1, milestones: 0 }
  );
}
export async function setNotificationSettings(
  db: Database,
  fid: number,
  settings: Settings,
  now = Date.now(),
) {
  requireThat(
    Number.isSafeInteger(fid) &&
      fid > 0 &&
      [
        "enabled,launch,rewards,voting",
        "enabled,launch,milestones,rewards,voting",
      ].includes(Object.keys(settings).sort().join()) &&
      Object.values(settings).every((v) => v === 0 || v === 1),
    400,
    "Invalid notification preferences",
  );
  await db.batch([
    db
      .prepare(
        "INSERT INTO meme_notification_settings(fid,enabled,voting,launch,rewards,updated_at,milestones) VALUES(?,?,?,?,?,?,?) ON CONFLICT(fid) DO UPDATE SET enabled=excluded.enabled,voting=excluded.voting,launch=excluded.launch,rewards=excluded.rewards,milestones=excluded.milestones,updated_at=excluded.updated_at",
      )
      .bind(
        fid,
        settings.enabled,
        settings.voting,
        settings.launch,
        settings.rewards,
        now,
        settings.milestones ?? 0,
      ),
    ...(!settings.enabled
      ? [
          db
            .prepare(
              "UPDATE meme_notification_outbox SET state='cancelled',lease=NULL,lease_until=NULL WHERE fid=? AND state IN('queued','retry')",
            )
            .bind(fid),
          db
            .prepare(
              "UPDATE meme_base_notification_outbox SET state='cancelled',lease=NULL,lease_until=NULL WHERE fid=? AND state IN('queued','retry')",
            )
            .bind(fid),
        ]
      : []),
  ]);
  return settings;
}
export async function deriveNotice(
  db: Database,
  c: Pick<NotificationConfig, "scope" | "origin">,
  kind: EventKind,
  subject: string,
  fid: number,
  now: number,
): Promise<Notice> {
  requireThat(
    typeof subject === "string" && subject.length > 0 && subject.length <= 160,
    400,
    "Invalid notice subject",
  );
  const targetUrl = c.origin + (kind === "rewards" ? "/?view=Rewards" : "/");
  let mode: "simulated" | "observed" = "simulated",
    expiresAt = now + 3600000,
    title = "",
    body = "";
  if (kind === "voting") {
    const round = await one<{
      state: string;
      opens_at: number;
      closes_at: number;
      mode: string;
    }>(
      db,
      "SELECT r.state,r.opens_at,r.closes_at,s.mode FROM meme_rounds r JOIN meme_ownership_snapshots s ON s.id=r.snapshot_id WHERE r.id=?",
      subject,
    );
    requireThat(
      round &&
        round.state === "open" &&
        round.opens_at <= now &&
        round.closes_at > now,
      409,
      "A ready open round is required",
    );
    mode = round.mode as typeof mode;
    expiresAt = round.closes_at;
    title = "Voting is open";
    body = "Today’s shortlist is ready. Make your pick.";
  } else if (kind === "launch") {
    const launch = await one<{
      symbol: string;
      mode: typeof mode;
      launched_at: number;
    }>(
      db,
      "SELECT c.symbol,c.mode,c.launched_at FROM meme_campaigns c JOIN meme_financial_receipts f ON f.subject=c.id AND f.operation='launch' WHERE c.id=?",
      subject,
    );
    requireThat(
      launch && launch.launched_at <= now,
      409,
      "A confirmed launch receipt is required",
    );
    mode = launch.mode;
    title = "Launch confirmed";
    body = launch.symbol + " is live. Follow your campaign.";
    expiresAt = launch.launched_at + 86400000;
  } else if (kind === "milestones") {
    const crossing = await one<{
      symbol: string;
      mode: typeof mode;
      threshold_usd: string;
      at: number;
    }>(
      db,
      "SELECT c.symbol,c.mode,m.threshold_usd,m.at FROM meme_milestone_crossings m JOIN meme_campaigns c ON c.id=m.edition_id WHERE m.id=?",
      subject,
    );
    requireThat(
      crossing && crossing.at <= now,
      409,
      "A verified milestone crossing is required",
    );
    mode = crossing.mode;
    title = "FDV milestone";
    body = crossing.symbol + " crossed $" + crossing.threshold_usd + " FDV.";
    expiresAt = crossing.at + 3600000;
  } else {
    requireThat(kind === "rewards", 400, "Unsupported notification kind");
    const reward = await one<{
      release_at: number;
      mode: typeof mode;
      amount: string;
      confirmed_at: number;
    }>(
      db,
      "SELECT a.release_at,a.mode,e.amount,f.confirmed_at FROM meme_allocations a JOIN meme_entitlements e ON e.allocation_id=a.id JOIN meme_settlements s ON s.round_id=a.round_id AND s.state='finalized' JOIN meme_financial_receipts f ON f.subject=a.id AND f.operation='fund' WHERE a.id=? AND e.fid=?",
      subject,
      fid,
    );
    requireThat(
      reward &&
        BigInt(reward.amount) > 0n &&
        now >= Math.ceil(reward.release_at / 1000) * 1000 + 1000 &&
        reward.confirmed_at <= now,
      409,
      "Finalized, funded and fully released rewards are required",
    );
    mode = reward.mode;
    title = "Rewards released";
    body = "Your funded reward allocation is ready to review.";
    expiresAt = reward.release_at + 86400000;
  }
  requireThat(
    expiresAt > now && title.length <= 32 && body.length <= 128,
    409,
    "Notification is stale",
  );
  return {
    notificationId: await sha(
      canonical({ scope: c.scope, kind, subject, fid }),
    ),
    title,
    body,
    targetUrl,
    kind,
    subject,
    mode,
    expiresAt,
  };
}
export async function enqueueNotification(
  db: Database,
  c: NotificationConfig,
  kind: EventKind,
  subject: string,
  fid: number,
  now = Date.now(),
) {
  configValid(c);
  const settings = await notificationSettings(db, fid);
  if (!settings.enabled || !settings[kind]) return { queued: 0 };
  const notice = await deriveNotice(db, c, kind, subject, fid, now),
    id = notice.notificationId;
  const existing = await one(
    db,
    "SELECT id FROM meme_notification_events WHERE id=?",
    id,
  );
  if (!existing) {
    const day = Math.floor(now / 86400000) * 86400000;
    const n = await one<{ n: number }>(
      db,
      "SELECT COUNT(*) n FROM meme_notification_events WHERE fid=? AND created_at>=? AND created_at<?",
      fid,
      day,
      day + 86400000,
    );
    if (n!.n >= 3) return { queued: 0, capped: true };
  }
  const subscriptions = await rows<{ client_fid: number }>(
    db,
    "SELECT client_fid FROM meme_notification_subscriptions WHERE scope=? AND fid=? AND enabled=1 ORDER BY client_fid LIMIT 10",
    c.scope,
    fid,
  );
  if (!subscriptions.length) return { queued: 0 };
  const day = Math.floor(now / 86400000) * 86400000;
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_notification_events SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM meme_notification_events WHERE fid=? AND created_at>=? AND created_at<?)<3",
      )
      .bind(
        id,
        kind,
        subject,
        fid,
        canonical(notice),
        now,
        fid,
        day,
        day + 86400000,
      ),
    ...subscriptions.map((s) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_notification_outbox(id,event_id,scope,fid,client_fid,state,retry_at,created_at) SELECT ?,?,?,?,?, 'queued',?,? WHERE EXISTS(SELECT 1 FROM meme_notification_events WHERE id=?)",
        )
        .bind(
          id + ":" + s.client_fid,
          id,
          c.scope,
          fid,
          s.client_fid,
          now,
          now,
          id,
        ),
    ),
  ]);
  return { queued: subscriptions.length, id };
}
export interface FakeNotificationTransport {
  mode: "fake";
  send(input: {
    id: string;
    url: string;
    token: string;
    notice: Notice;
  }): Promise<"sent" | "invalid" | "rate-limited">;
  receipt(id: string): Promise<"sent" | "absent" | "unknown">;
}
/** No HTTP transport exists. A lease lost during I/O becomes unknown, never blindly resent. */
export async function drainNotifications(
  db: Database,
  c: NotificationConfig,
  transport: FakeNotificationTransport,
  now = Date.now(),
) {
  configValid(c);
  requireThat(
    transport.mode === "fake",
    403,
    "Real notification delivery is disabled",
  );
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
    event_id: string;
    fid: number;
    client_fid: number;
    state: string;
    attempts: number;
    lease_until: number | null;
    payload: string;
  }>(
    db,
    "SELECT o.*,e.payload FROM meme_notification_outbox o JOIN meme_notification_events e ON e.id=o.event_id WHERE o.scope=? AND (o.state IN('queued','retry') AND o.retry_at<=? OR o.state='processing' AND o.lease_until<=?) ORDER BY o.retry_at,o.id LIMIT 20",
    c.scope,
    now,
    now,
  );
  let processed = 0;
  for (const row of due) {
    if (row.state === "processing") {
      const receipt = await transport
        .receipt(row.id)
        .catch(() => "unknown" as const);
      await run(
        db,
        "UPDATE meme_notification_outbox SET state=?,lease=NULL,lease_until=NULL WHERE id=? AND state='processing' AND lease_until<=?",
        receipt === "sent" ? "sent" : "unknown",
        row.id,
        now,
      );
      continue;
    }
    const notice = JSON.parse(row.payload) as Notice,
      settings = await notificationSettings(db, row.fid),
      sub = await one<{
        enabled: number;
        url: string;
        encrypted_token: string;
      }>(
        db,
        "SELECT enabled,url,encrypted_token FROM meme_notification_subscriptions WHERE scope=? AND fid=? AND client_fid=?",
        c.scope,
        row.fid,
        row.client_fid,
      );
    if (
      !settings.enabled ||
      !settings[notice.kind] ||
      !sub?.enabled ||
      notice.expiresAt <= now ||
      row.attempts >= 5
    ) {
      await run(
        db,
        "UPDATE meme_notification_outbox SET state='cancelled' WHERE id=? AND state IN('queued','retry')",
        row.id,
      );
      continue;
    }
    requireThat(
      c.receiverUrls.includes(sub.url),
      403,
      "Notification receiver is no longer allowlisted",
    );
    const lease = random();
    const claim = await run(
      db,
      "UPDATE meme_notification_outbox SET state='processing',lease=?,lease_until=?,attempts=attempts+1 WHERE id=? AND state IN('queued','retry') AND retry_at<=?",
      lease,
      now + 60000,
      row.id,
      now,
    );
    if (claim.meta.changes !== 1) continue;
    try {
      // Recheck the independent pause after claiming, immediately before fake delivery.
      if (
        (
          await one<{ paused: number }>(
            db,
            "SELECT paused FROM meme_notification_control WHERE id=1",
          )
        )?.paused !== 0
      ) {
        await run(
          db,
          "UPDATE meme_notification_outbox SET state='retry',retry_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
          now + 60000,
          row.id,
          lease,
        );
        continue;
      }
      const token = await secret(
        c,
        row.fid,
        row.client_fid,
        null,
        sub.encrypted_token,
      );
      const currentSettings = await notificationSettings(db, row.fid);
      const currentSub = await one<{
        enabled: number;
        encrypted_token: string;
      }>(
        db,
        "SELECT enabled,encrypted_token FROM meme_notification_subscriptions WHERE scope=? AND fid=? AND client_fid=?",
        c.scope,
        row.fid,
        row.client_fid,
      );
      if (
        !currentSettings.enabled ||
        !currentSettings[notice.kind] ||
        !currentSub?.enabled ||
        currentSub.encrypted_token !== sub.encrypted_token
      ) {
        await run(
          db,
          "UPDATE meme_notification_outbox SET state='cancelled',lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
          row.id,
          lease,
        );
        continue;
      }
      const result = await transport.send({
        id: row.id,
        url: sub.url,
        token,
        notice,
      });
      requireThat(
        ["sent", "invalid", "rate-limited"].includes(result),
        502,
        "Unknown delivery outcome",
      );
      await db.batch([
        db
          .prepare(
            "UPDATE meme_notification_outbox SET state=?,retry_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
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
                  "UPDATE meme_notification_subscriptions SET enabled=0,encrypted_token=NULL,url=NULL WHERE scope=? AND fid=? AND client_fid=? AND encrypted_token=?",
                )
                .bind(c.scope, row.fid, row.client_fid, sub.encrypted_token),
            ]
          : []),
      ]);
      processed++;
    } catch {
      await run(
        db,
        "UPDATE meme_notification_outbox SET state='unknown',lease=NULL,lease_until=NULL WHERE id=? AND lease=?",
        row.id,
        lease,
      );
    }
  }
  return { processed };
}
export async function reconcileNotification(
  db: Database,
  id: string,
  transport: FakeNotificationTransport,
) {
  requireThat(transport.mode === "fake", 403, "Real delivery disabled");
  const result = await transport.receipt(id);
  if (result === "sent")
    await run(
      db,
      "UPDATE meme_notification_outbox SET state='sent' WHERE id=? AND state='unknown'",
      id,
    );
  return { result };
}
export async function notificationsRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/meme/notifications/webhook")
    return json(
      { error: "Launchpad notification registration is not configured" },
      503,
    );
  if (path !== "/api/meme/notifications") return null;
  const { fid } = await principal(db, request);
  if (["GET", "HEAD"].includes(request.method))
    return json({
      viewerFid: fid,
      settings: await notificationSettings(db, fid),
      registered: false,
      deliveryEnabled: false,
      channels: {
        farcaster: { registered: false },
        base: { registered: false },
      },
    });
  requireThat(request.method === "POST", 405, "Method not allowed");
  const p = await payload(request, [
    "enabled",
    "voting",
    "launch",
    "rewards",
    "milestones",
  ]);
  requireThat(
    p.enabled === 0,
    409,
    "Live notification permissions require app registration",
  );
  return json({
    settings: await setNotificationSettings(db, fid, p as Settings),
    viewerFid: fid,
    registered: false,
    deliveryEnabled: false,
    channels: { farcaster: { registered: false }, base: { registered: false } },
  });
}
