import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { NOTIFICATION_SCOPE, setNotificationSettings } from "./notifications";
import {
  syncBaseNoticeStatus,
  enqueueBaseNotice,
  drainBaseNotices,
  reconcileBaseNotice,
  reserveBaseNoticeRequest,
  type BaseNoticeConfig,
  type FakeBaseNoticeTransport,
} from "./baseNotifications";
const now = 1793400000000,
  wallet = "0x1111111111111111111111111111111111111111",
  config: BaseNoticeConfig = {
    scope: NOTIFICATION_SCOPE,
    origin: "https://launchpad.example",
    mode: "fake",
    maximumRequestsPerMinute: 20,
  };
function seed(t: ReturnType<typeof testDb>) {
  t.raw
    .prepare(
      "INSERT INTO meme_wallet_links VALUES(42,'base',?,'boost',?,NULL,?)",
    )
    .run(wallet, now - 1000, "a".repeat(64));
  t.raw
    .prepare(
      "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version) VALUES('round',?,?,'cast','open','snap','local-v1')",
    )
    .run(now - 1000, now + 3600000);
  t.raw
    .prepare(
      "INSERT INTO meme_ownership_snapshots(id,round_id,source,mode,source_at,captured_at,expected_tokens,state,manifest) VALUES('snap','round','fixture','simulated',?,?,0,'ready','{}')",
    )
    .run(now - 2000, now - 1000);
}
test("Base/web uses independent verified wallet permission, canonical app scope and no real transport", async () => {
  const t = testDb();
  try {
    seed(t);
    let current = now,
      sends = 0;
    const received = new Set<string>();
    const adapter: FakeBaseNoticeTransport = {
      mode: "fake",
      async status(w, appUrl) {
        return {
          wallet: w,
          appUrl,
          appPinned: true,
          notificationsEnabled: true,
          observedAt: current,
          proofHash: "a".repeat(64),
        };
      },
      async send(id, payload) {
        sends++;
        assert.equal(payload.app_url, config.origin);
        assert.deepEqual(payload.wallet_addresses, [wallet]);
        assert(payload.target_path.startsWith("/?baseNotificationId="));
        received.add(id);
        throw Error("Accepted then response lost");
      },
      async receipt(id) {
        return received.has(id) ? "sent" : "unknown";
      },
    };
    await assert.rejects(
      syncBaseNoticeStatus(t.db, config, 43, wallet, adapter, now),
      /exclusively linked/,
    );
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    assert.equal(
      (
        await enqueueBaseNotice(
          t.db,
          config,
          "voting",
          "round",
          42,
          wallet,
          now,
        )
      ).queued,
      false,
    );
    assert.equal(
      (await syncBaseNoticeStatus(t.db, config, 42, wallet, adapter, now))
        .state,
      "enabled",
    );
    const item = await enqueueBaseNotice(
      t.db,
      config,
      "voting",
      "round",
      42,
      wallet,
      now,
    );
    assert.equal(
      (await drainBaseNotices(t.db, config, adapter, now)).paused,
      true,
    );
    t.raw.exec("UPDATE meme_notification_control SET paused=0");
    current = now + 3100;
    await drainBaseNotices(t.db, config, adapter, current);
    assert.equal(sends, 1);
    assert.equal(
      t.raw.prepare("SELECT state FROM meme_base_notification_outbox").get()!
        .state,
      "unknown",
    );
    await drainBaseNotices(t.db, config, adapter, current + 6200);
    assert.equal(sends, 1);
    await reconcileBaseNotice(t.db, item.id!, adapter);
    assert.equal(
      t.raw.prepare("SELECT state FROM meme_base_notification_outbox").get()!
        .state,
      "sent",
    );
    await assert.rejects(
      syncBaseNoticeStatus(
        t.db,
        config,
        42,
        wallet,
        {
          ...adapter,
          async status() {
            return {
              wallet,
              appUrl: "https://another-app.example",
              appPinned: true,
              notificationsEnabled: true,
              observedAt: current + 10000,
              proofHash: "a".repeat(64),
            };
          },
        },
        current + 10000,
      ),
      /registered app/,
    );
  } finally {
    t.close();
  }
});
test("Base status/send attempts share durable pacing, cannot exceed the configured fake cap or reset a consumed minute", async () => {
  const t = testDb();
  try {
    const minute = Math.floor(now / 60000) * 60000;
    assert.equal(
      await reserveBaseNoticeRequest(
        t.db,
        { ...config, maximumRequestsPerMinute: 0 },
        minute,
      ),
      false,
    );
    for (let i = 0; i < 3; i++)
      assert.equal(
        await reserveBaseNoticeRequest(
          t.db,
          { ...config, maximumRequestsPerMinute: 3 },
          minute + i * 3100,
        ),
        true,
      );
    assert.equal(
      await reserveBaseNoticeRequest(
        t.db,
        { ...config, maximumRequestsPerMinute: 3 },
        minute + 20000,
      ),
      false,
    );
    assert.equal(
      await reserveBaseNoticeRequest(
        t.db,
        { ...config, maximumRequestsPerMinute: 3 },
        minute + 60000,
      ),
      true,
    );
    assert.equal(
      t.raw
        .prepare(
          "SELECT used FROM meme_base_notification_request_usage WHERE minute=?",
        )
        .get(Math.floor(minute / 60000))!.used,
      3,
    );
    assert.equal(
      await reserveBaseNoticeRequest(t.db, config, minute + 60001),
      false,
    );
  } finally {
    t.close();
  }
});
test("Base permission expiry, wallet revocation and app opt-out stop queued sends; daily event cap is shared", async () => {
  const t = testDb();
  try {
    seed(t);
    const adapter: FakeBaseNoticeTransport = {
      mode: "fake",
      async status(w, appUrl) {
        return {
          wallet: w,
          appUrl,
          appPinned: true,
          notificationsEnabled: true,
          observedAt: now,
          proofHash: "a".repeat(64),
        };
      },
      async send() {
        throw Error("Must not send");
      },
      async receipt() {
        return "unknown";
      },
    };
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    await syncBaseNoticeStatus(t.db, config, 42, wallet, adapter, now);
    for (let i = 0; i < 3; i++)
      t.raw
        .prepare("INSERT INTO meme_notification_events VALUES(?,?,?,?,?,?)")
        .run("fc-history:" + i, "voting", "old", 42, "{}", now);
    assert.equal(
      (
        await enqueueBaseNotice(
          t.db,
          config,
          "voting",
          "round",
          42,
          wallet,
          now,
        )
      ).queued,
      false,
    );
    // A separately eligible identity exercises permission expiry without rewriting the immutable cap history.
    const second = "0x2222222222222222222222222222222222222222";
    t.raw
      .prepare(
        "INSERT INTO meme_wallet_links VALUES(43,'base',?,'boost',?,NULL,?)",
      )
      .run(second, now - 1000, "b".repeat(64));
    await setNotificationSettings(
      t.db,
      43,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    await syncBaseNoticeStatus(
      t.db,
      config,
      43,
      second,
      {
        ...adapter,
        async status(w, appUrl) {
          return {
            wallet: w,
            appUrl,
            appPinned: true,
            notificationsEnabled: true,
            observedAt: now + 3100,
            proofHash: "b".repeat(64),
          };
        },
      },
      now + 3100,
    );
    await enqueueBaseNotice(
      t.db,
      config,
      "voting",
      "round",
      43,
      second,
      now + 3100,
    );
    await setNotificationSettings(
      t.db,
      43,
      { enabled: 0, voting: 1, launch: 1, rewards: 1 },
      now + 3101,
    );
    assert.equal(
      t.raw.prepare("SELECT state FROM meme_base_notification_outbox").get()!
        .state,
      "cancelled",
    );
    t.raw.exec(
      "UPDATE meme_base_notification_outbox SET state='queued';UPDATE meme_notification_control SET paused=0",
    );
    await setNotificationSettings(
      t.db,
      43,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now + 3102,
    );
    await drainBaseNotices(t.db, config, adapter, now + 400000);
    assert.equal(
      t.raw.prepare("SELECT state FROM meme_base_notification_outbox").get()!
        .state,
      "cancelled",
    );
    // Fresh permission cannot override a revoked cryptographic wallet link.
    t.raw.exec(
      "UPDATE meme_base_notification_outbox SET state='queued';UPDATE meme_base_notification_status SET observed_at=" +
        (now + 400001),
    );
    t.raw
      .prepare("UPDATE meme_wallet_links SET revoked_at=? WHERE fid=43")
      .run(now + 400001);
    await drainBaseNotices(t.db, config, adapter, now + 400002);
    assert.equal(
      t.raw.prepare("SELECT state FROM meme_base_notification_outbox").get()!
        .state,
      "cancelled",
    );
  } finally {
    t.close();
  }
});
