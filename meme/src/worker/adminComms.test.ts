import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { refreshAdminMetrics } from "./admin";
import { collectNoticeCandidates } from "./adminComms";
import { deriveNotice, NOTIFICATION_SCOPE } from "./notifications";
test("admin previews and metrics respect the full locked interval for fractional launch timestamps", async () => {
  const t = testDb(),
    now = 1793400000000,
    release = now + 1;
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('edition','So11111111111111111111111111111111111111112','ATTN',?,?,?,0,'simulated','fixture')",
      )
      .run(now - 86400000, now + 9 * 86400000, "1000");
    t.raw
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version) VALUES('round',?,?,'cast','closed',NULL,'local-v1')",
      )
      .run(now - 86400000, now - 2000);
    t.raw
      .prepare(
        "INSERT INTO meme_settlements VALUES('round',?,'input','result','{}',1,1,1,'finalized','simulated',?,?)",
      )
      .run(now - 2000, now - 1500, now - 1500);
    t.raw
      .prepare(
        "INSERT INTO meme_allocations VALUES('allocation','edition',1,?,'round','100','100','0','input','result','simulated',NULL)",
      )
      .run(release);
    t.raw
      .prepare(
        "INSERT INTO meme_entitlements VALUES('allocation',42,1,'So11111111111111111111111111111111111111112','100','finalized_unfunded')",
      )
      .run();
    t.raw
      .prepare(
        "INSERT INTO meme_transaction_intents(id,business_key,network,operation,subject,plan,plan_hash,state,created_at,updated_at) VALUES('intent','solana-local:fund:allocation','solana-local','fund','allocation','{}','hash','confirmed',?,?)",
      )
      .run(now - 1000, now - 1000);
    t.raw
      .prepare(
        "INSERT INTO meme_financial_receipts VALUES('solana-local:fund:allocation','intent','fund','allocation','fixture-signature','hash',?)",
      )
      .run(now - 1000);
    await collectNoticeCandidates(t.db, now + 1999);
    await refreshAdminMetrics(t.db, now + 1999);
    assert.equal(
      t.raw
        .prepare("SELECT COUNT(*) n FROM meme_admin_notice_candidates")
        .get()!.n,
      0,
    );
    assert.equal(
      JSON.parse(
        String(
          t.raw.prepare("SELECT payload FROM meme_admin_metrics_meta").get()!
            .payload,
        ),
      ).releasedAllocations,
      0,
    );
    await assert.rejects(
      deriveNotice(
        t.db,
        { scope: NOTIFICATION_SCOPE, origin: "https://launchpad.example" },
        "rewards",
        "allocation",
        42,
        now + 1999,
      ),
      /fully released/,
    );
    await collectNoticeCandidates(t.db, now + 2000);
    await collectNoticeCandidates(t.db, now + 2000);
    await refreshAdminMetrics(t.db, now + 2000);
    assert.equal(
      t.raw
        .prepare("SELECT COUNT(*) n FROM meme_admin_notice_candidates")
        .get()!.n,
      1,
    );
    assert.equal(
      JSON.parse(
        String(
          t.raw.prepare("SELECT payload FROM meme_admin_metrics_meta").get()!
            .payload,
        ),
      ).releasedAllocations,
      1,
    );
    assert.equal(
      (
        await deriveNotice(
          t.db,
          { scope: NOTIFICATION_SCOPE, origin: "https://launchpad.example" },
          "rewards",
          "allocation",
          42,
          now + 2000,
        )
      ).kind,
      "rewards",
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_social_drafts").get()!.n,
      1,
    );
  } finally {
    t.close();
  }
});
