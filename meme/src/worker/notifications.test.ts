import test from "node:test";
import assert from "node:assert/strict";
import {
  createJsonFarcasterSignature,
  type VerifyAppKey,
} from "@farcaster/miniapp-node";
import { testDb } from "./testDb";
import {
  acceptSignedNotification,
  NOTIFICATION_SCOPE,
  setNotificationSettings,
  enqueueNotification,
  drainNotifications,
  reconcileNotification,
  type NotificationConfig,
  type FakeNotificationTransport,
} from "./notifications";
const privateKey = new Uint8Array(32).fill(7),
  now = 1793400000000;
const config: NotificationConfig = {
  scope: NOTIFICATION_SCOPE,
  origin: "https://launchpad.example",
  clientFids: [9152],
  receiverUrls: ["https://api.farcaster.xyz/v1/frame-notifications"],
  encryptionKey: new Uint8Array(32).fill(9),
  mode: "fake",
};
const sign = (event: unknown) =>
  createJsonFarcasterSignature({
    fid: 42,
    type: "app_key",
    privateKey,
    payload: new TextEncoder().encode(JSON.stringify(event)),
  });
const verifier: VerifyAppKey = async (fid, key) => ({
  valid: fid === 42 && key.length === 66,
  appFid: 9152,
});
const enabled = () =>
  sign({
    event: "notifications_enabled",
    notificationDetails: {
      url: config.receiverUrls[0],
      token: "fake-secret-notification-token",
    },
  });
async function seedRound(t: ReturnType<typeof testDb>, id: string) {
  t.raw
    .prepare(
      "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version,selected_candidate,outcome_reason) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      now - 1000,
      now + 3600000,
      "cast",
      "open",
      "snapshot:" + id,
      "local-v1",
      null,
      null,
    );
  t.raw
    .prepare(
      "INSERT INTO meme_ownership_snapshots(id,round_id,source,mode,source_at,captured_at,expected_tokens,state,manifest) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "snapshot:" + id,
      id,
      "fixture",
      "simulated",
      now - 2000,
      now - 1000,
      0,
      "ready",
      "{}",
    );
}
test("real signed notification events bind app-key verification and client allowlist; tokens stay encrypted and replays cannot undo opt-out", async () => {
  const t = testDb();
  try {
    const raw = enabled();
    await acceptSignedNotification(t.db, raw, config, verifier, now);
    const sub = t.raw
      .prepare("SELECT * FROM meme_notification_subscriptions")
      .get()!;
    assert(!String(sub.encrypted_token).includes("fake-secret"));
    assert.equal(sub.enabled, 1);
    await assert.rejects(
      acceptSignedNotification(
        t.db,
        { ...raw, payload: raw.payload.slice(0, -1) + "A" },
        config,
        verifier,
        now,
      ),
    );
    await assert.rejects(
      acceptSignedNotification(
        t.db,
        raw,
        { ...config, clientFids: [12] },
        verifier,
        now,
      ),
      /client/,
    );
    await assert.rejects(
      acceptSignedNotification(
        t.db,
        sign({
          event: "notifications_enabled",
          notificationDetails: {
            url: "http://127.0.0.1/private",
            token: "bad",
          },
        }),
        config,
        verifier,
        now,
      ),
      /receiver/,
    );
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    await acceptSignedNotification(
      t.db,
      sign({ event: "notifications_disabled" }),
      config,
      verifier,
      now + 1,
    );
    assert.equal(
      (await acceptSignedNotification(t.db, raw, config, verifier, now + 2))
        .replayed,
      true,
    );
    assert.equal(
      t.raw.prepare("SELECT enabled FROM meme_notification_settings").get()!
        .enabled,
      0,
    );
    assert.equal(
      t.raw
        .prepare("SELECT enabled FROM meme_notification_subscriptions")
        .get()!.enabled,
      0,
    );
  } finally {
    t.close();
  }
});
test("invalid tokens and expired leases stop delivery; opt-out cancels queued notices", async () => {
  const t = testDb();
  try {
    await acceptSignedNotification(t.db, enabled(), config, verifier, now);
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    await seedRound(t, "a");
    await enqueueNotification(t.db, config, "voting", "a", 42, now);
    t.raw.exec("UPDATE meme_notification_control SET paused=0");
    let sends = 0;
    const transport: FakeNotificationTransport = {
      mode: "fake",
      async send() {
        sends++;
        return "invalid";
      },
      async receipt() {
        return "unknown";
      },
    };
    await drainNotifications(t.db, config, transport, now);
    assert.equal(sends, 1);
    assert.equal(
      t.raw
        .prepare("SELECT encrypted_token FROM meme_notification_subscriptions")
        .get()!.encrypted_token,
      null,
    );
    t.raw
      .prepare(
        "UPDATE meme_notification_outbox SET state='processing',lease='expired',lease_until=?",
      )
      .run(now - 1);
    await drainNotifications(t.db, config, transport, now);
    assert.equal(
      t.raw.prepare("SELECT state FROM meme_notification_outbox").get()!.state,
      "unknown",
    );
    assert.equal(sends, 1);
    t.raw.exec("UPDATE meme_notification_outbox SET state='queued'");
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 0, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    assert.equal(
      t.raw.prepare("SELECT state FROM meme_notification_outbox").get()!.state,
      "cancelled",
    );
  } finally {
    t.close();
  }
});
test("daily cap counts distinct events across clients and stops at three", async () => {
  const t = testDb();
  try {
    await acceptSignedNotification(t.db, enabled(), config, verifier, now);
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    await seedRound(t, "a");
    for (const id of ["previous:1", "previous:2", "previous:3"])
      t.raw
        .prepare("INSERT INTO meme_notification_events VALUES(?,?,?,?,?,?)")
        .run(id, "voting", id, 42, "{}", now);
    assert.equal(
      (await enqueueNotification(t.db, config, "voting", "a", 42, now)).capped,
      true,
    );
    assert.equal(
      t.raw.prepare("SELECT count(*) n FROM meme_notification_outbox").get()!.n,
      0,
    );
  } finally {
    t.close();
  }
});
test("bounded outbox deduplicates across client subscriptions, retries rate limits and never resends an ambiguous accepted message", async () => {
  const t = testDb();
  try {
    const multi = { ...config, clientFids: [9152, 9153, 9154] };
    for (const client of multi.clientFids)
      await acceptSignedNotification(
        t.db,
        sign({
          event: "notifications_enabled",
          notificationDetails: {
            url: config.receiverUrls[0],
            token: "fake-secret-notification-token-" + client,
          },
        }),
        multi,
        async () => ({ valid: true, appFid: client }),
        now,
      );
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    await seedRound(t, "a");
    await enqueueNotification(t.db, multi, "voting", "a", 42, now);
    await enqueueNotification(t.db, config, "voting", "a", 42, now);
    assert.equal(
      t.raw.prepare("SELECT count(*) n FROM meme_notification_events").get()!.n,
      1,
    );
    const sent = new Set<string>();
    let sends = 0,
      rateLimit = true;
    const fake: FakeNotificationTransport = {
      mode: "fake",
      async send({ id, token }) {
        sends++;
        assert.match(token, /^fake-secret-notification-token-915[234]$/);
        if (rateLimit) {
          rateLimit = false;
          return "rate-limited";
        }
        sent.add(id);
        if (sends === 2) throw Error("Accepted then response lost");
        return "sent";
      },
      async receipt(id) {
        return sent.has(id) ? "sent" : "unknown";
      },
    };
    assert.equal(
      (await drainNotifications(t.db, config, fake, now)).paused,
      true,
    );
    t.raw.exec("UPDATE meme_notification_control SET paused=0");
    await Promise.all([
      drainNotifications(t.db, config, fake, now),
      drainNotifications(t.db, config, fake, now),
    ]);
    const ambiguous = t.raw
      .prepare("SELECT id FROM meme_notification_outbox WHERE state='unknown'")
      .get()!;
    assert(ambiguous);
    const before = sends;
    await drainNotifications(t.db, config, fake, now);
    assert.equal(sends, before);
    await reconcileNotification(t.db, String(ambiguous.id), fake);
    await drainNotifications(t.db, config, fake, now + 120000);
    assert.equal(sends, 4);
    assert.equal(
      t.raw
        .prepare(
          "SELECT count(*) n FROM meme_notification_outbox WHERE state='sent'",
        )
        .get()!.n,
      3,
    );
    await assert.rejects(
      enqueueNotification(t.db, config, "launch", "not-confirmed", 42, now),
      /confirmed launch/,
    );
    await assert.rejects(
      enqueueNotification(t.db, config, "rewards", "unfunded", 42, now),
      /funded/,
    );
  } finally {
    t.close();
  }
});
