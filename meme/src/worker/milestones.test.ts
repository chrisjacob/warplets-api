import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { observeMilestone, type VerifiedFdv } from "./milestones";
import { commsCommand } from "./adminComms";
import {
  notificationSettings,
  setNotificationSettings,
  enqueueNotification,
  NOTIFICATION_SCOPE,
  type NotificationConfig,
} from "./notifications";
const now = 1793400000000,
  mint = "So11111111111111111111111111111111111111112";
const config: NotificationConfig = {
  scope: NOTIFICATION_SCOPE,
  origin: "https://launchpad.example",
  clientFids: [9152],
  receiverUrls: ["https://notify.example"],
  encryptionKey: new Uint8Array(32),
  mode: "fake",
};
test("verified FDV requires a below baseline and sustained fresh crossing; replay/dips never create duplicate alerts", async () => {
  const t = testDb();
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('edition',?,'ATTN',?,?,?,6,'simulated','fixture')",
      )
      .run(mint, now - 86400000, now + 9 * 86400000, "1000000000000000");
    const rule = (await commsCommand(
      t.db,
      "milestone.save",
      {
        editionId: "edition",
        thresholdUsd: "1000000",
        enabled: true,
        ruleVersion: 0,
      },
      "comms",
      "rule-save",
      now,
    )) as { id: string };
    const proof = (at: number, priceUsd: string): VerifiedFdv => ({
      editionId: "edition",
      mint,
      supplyRaw: "1000000000000000",
      decimals: 6,
      mintAuthority: null,
      priceUsd,
      at,
      verifiedAt: at,
      supplyHash: "a".repeat(64),
      priceHash: at.toString(16).padStart(64, "0"),
      mode: "simulated",
    });
    assert.equal(
      (await observeMilestone(t.db, rule.id, proof(now - 240000, "0.002"), now))
        .state,
      "baseline",
    );
    assert.equal(
      (
        await observeMilestone(
          t.db,
          rule.id,
          proof(now - 180000, "0.0009"),
          now,
        )
      ).state,
      "below",
    );
    assert.equal(
      (
        await observeMilestone(
          t.db,
          rule.id,
          proof(now - 120000, "0.0011"),
          now,
        )
      ).state,
      "confirming",
    );
    const fired = await observeMilestone(
      t.db,
      rule.id,
      proof(now - 60000, "0.0012"),
      now,
    );
    assert.equal(fired.state, "fired");
    assert.ok(fired.eventId);
    await observeMilestone(t.db, rule.id, proof(now - 60000, "0.0012"), now);
    await observeMilestone(t.db, rule.id, proof(now - 30000, "0.0008"), now);
    await observeMilestone(t.db, rule.id, proof(now, "0.002"), now);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_milestone_crossings").get()!.n,
      1,
    );
    await assert.rejects(
      observeMilestone(
        t.db,
        rule.id,
        { ...proof(now + 1000, "0.002"), supplyRaw: "123" },
        now + 1000,
      ),
      /fixed supply/,
    );
    await assert.rejects(
      observeMilestone(t.db, rule.id, proof(now - 400000, "0.002"), now),
      /Fresh/,
    );
    const defaults = await notificationSettings(t.db, 42);
    assert.equal(defaults.milestones, 0);
    t.raw
      .prepare(
        "INSERT INTO meme_notification_subscriptions VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        NOTIFICATION_SCOPE,
        42,
        9152,
        "https://notify.example",
        "test-only-not-decrypted",
        1,
        now,
      );
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1 },
      now,
    );
    assert.equal(
      (
        await enqueueNotification(
          t.db,
          config,
          "milestones",
          fired.eventId!,
          42,
          now,
        )
      ).queued,
      0,
    );
    await setNotificationSettings(
      t.db,
      42,
      { enabled: 1, voting: 1, launch: 1, rewards: 1, milestones: 1 },
      now,
    );
    await enqueueNotification(
      t.db,
      config,
      "milestones",
      fired.eventId!,
      42,
      now,
    );
    await enqueueNotification(
      t.db,
      config,
      "milestones",
      fired.eventId!,
      42,
      now,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_notification_events").get()!.n,
      1,
    );
  } finally {
    t.close();
  }
});
test("a source gap above the threshold restarts the baseline and rule edits preserve event identity", async () => {
  const t = testDb();
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('edition',?,'ATTN',?,?,?,6,'simulated','fixture')",
      )
      .run(mint, now - 86400000, now + 9 * 86400000, "1000000000000000");
    const params = {
        editionId: "edition",
        thresholdUsd: "1000000",
        enabled: true,
        ruleVersion: 0,
      },
      rule = (await commsCommand(
        t.db,
        "milestone.save",
        params,
        "comms",
        "create",
        now,
      )) as { id: string };
    const proof = (at: number, priceUsd: string): VerifiedFdv => ({
      editionId: "edition",
      mint,
      supplyRaw: "1000000000000000",
      decimals: 6,
      mintAuthority: null,
      priceUsd,
      at,
      verifiedAt: at,
      supplyHash: "a".repeat(64),
      priceHash: at.toString(16).padStart(64, "0"),
      mode: "simulated",
    });
    await observeMilestone(t.db, rule.id, proof(now, "0.0009"), now);
    assert.equal(
      (
        await observeMilestone(
          t.db,
          rule.id,
          proof(now + 360000, "0.002"),
          now + 360000,
        )
      ).state,
      "baseline",
    );
    await commsCommand(
      t.db,
      "milestone.save",
      { ...params, enabled: false, ruleVersion: 1 },
      "comms",
      "disable",
      now + 360000,
    );
    await commsCommand(
      t.db,
      "milestone.save",
      { ...params, ruleVersion: 2 },
      "comms",
      "enable",
      now + 360000,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_milestone_rules").get()!.n,
      1,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_milestone_crossings").get()!.n,
      0,
    );
  } finally {
    t.close();
  }
});
