import { ingestSocial } from "./socialIngestion";
import * as socialProvider from "./socialProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleSocial } from "./socialApi";
import {
  award,
  ensureIdentity,
  socialMember,
  type SocialEnv,
} from "./socialStore";
import {
  calculateBoost,
  DEFAULT_SOCIAL_CONFIG,
  DAY,
  nextStreak,
  safeSocialUrl,
  utcDay,
  validateSocialConfig,
} from "../../shared/social";
import { validateCast } from "./socialProvider";
import { socialHtml, socialManifest } from "../../shared/socialMetadata";
import type { AppSession } from "./appAuth";

vi.mock("./appAuth", () => ({
  getAppSession: vi.fn(async (request: Request) =>
    request.headers.get("x-test-wallet") || request.headers.get("x-test-fid")
      ? {
          sessionHash: "test",
          farcasterFid: Number(request.headers.get("x-test-fid")) || null,
          walletAddress: request.headers.get("x-test-wallet"),
          farcasterSignerUuid: null,
          createdAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + DAY).toISOString(),
          absoluteExpiresAt: new Date(Date.now() + DAY).toISOString(),
        }
      : null,
  ),
}));

// Execute production SQL against SQLite, including uniqueness and trigger failures.
function sqliteD1(sqlite: DatabaseSync) {
  function prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        if (args.length > 100) throw new Error("D1 binding limit exceeded");
        values = args;
        return statement;
      },
      async first(column?: string) {
        const row = sqlite
          .prepare(sql)
          .get(...(values as (string | number | null)[]));
        return row ? (column ? row[column] : row) : null;
      },
      async all() {
        return {
          success: true,
          results: sqlite
            .prepare(sql)
            .all(...(values as (string | number | null)[])),
          meta: {},
        };
      },
      async run() {
        const result = sqlite
          .prepare(sql)
          .run(...(values as (string | number | null)[]));
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        };
      },
    };
    return statement;
  }
  return {
    prepare,
    async batch(statements: Array<ReturnType<typeof prepare>>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
let db: DatabaseSync, env: SocialEnv;
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
async function request(
  route: string,
  body?: unknown,
  asWallet: string | null = wallet,
  fid?: number,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://social.10x.meme",
  };
  if (asWallet) headers["x-test-wallet"] = asWallet;
  if (fid) headers["x-test-fid"] = String(fid);
  return handleSocial({
    request: new Request(`https://social.10x.meme/api/social/${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  } as Parameters<typeof handleSocial>[0]);
}
async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../../../migrations/0076_social.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    "CREATE TABLE app_identity_links(farcaster_fid INTEGER,wallet_address TEXT)",
  );
  env = {
    WARPLETS: sqliteD1(db),
    APP_SESSION_SECRET: "test-secret-with-at-least-32-characters",
  };
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
describe("Social submission and reward integrity", () => {
  it("renders stored cast attachments without provider calls or creating feed posts", async () => {
    const hash = `0x${"a".repeat(40)}`;
    const url = `https://farcaster.xyz/~/conversations/${hash}`;
    await request("publish", {
      operationId: crypto.randomUUID(),
      text: `Read this ${url}`,
    });
    const parent = db.prepare("SELECT id FROM social_posts LIMIT 1").get()!.id;
    db.prepare("UPDATE social_posts SET raw_json=? WHERE id=?").run(
      JSON.stringify({
        embeds: [
          {
            cast: {
              hash,
              text: "A quoted cast",
              timestamp: new Date().toISOString(),
              author: { fid: 123, username: "alice" },
              embeds: [{ url: "https://example.com/image.jpg" }],
            },
          },
        ],
      }),
      parent,
    );
    const provider = vi.spyOn(socialProvider, "neynar");
    const route = `embed/cast?postId=${parent}&url=${encodeURIComponent(url)}`;
    const preview = await request(route, undefined, null);
    expect(preview.status).toBe(200);
    expect((await json(preview)).cast).toMatchObject({
      username: "alice",
      text: "A quoted cast",
      embeds: ["https://example.com/image.jpg"],
    });
    expect(provider).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS n FROM social_posts").get()?.n).toBe(
      1,
    );
    expect(
      (
        await request(
          `embed/cast?postId=${parent}&url=${encodeURIComponent(url.replace(hash, `0x${"b".repeat(40)}`))}`,
          undefined,
          null,
        )
      ).status,
    ).toBe(400);
    db.prepare("UPDATE social_posts SET status='hidden' WHERE id=?").run(
      parent,
    );
    expect((await request(route, undefined, null)).status).toBe(404);
  });
  it("allows public browsing but requires verified identity to publish", async () => {
    expect((await request("feed", undefined, null)).status).toBe(200);
    expect(
      (
        await request(
          "publish",
          { operationId: crypto.randomUUID(), text: "test" },
          null,
        )
      ).status,
    ).toBe(401);
  });
  it("persists a wallet post, indexes it, rewards exactly once, and enforces rolling 24 hours", async () => {
    const body = {
      operationId: crypto.randomUUID(),
      source: "local",
      text: "Original alpha about discovery",
    };
    expect((await request("publish", body)).status).toBe(200);
    expect((await request("publish", body)).status).toBe(200);
    expect(
      (await request("publish", { ...body, operationId: crypto.randomUUID() }))
        .status,
    ).toBe(409);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM social_rewards WHERE action='post'")
        .get()?.n,
    ).toBe(1);
    const feed = await json(await request("feed?q=alpha"));
    expect(feed.posts).toHaveLength(1);
    expect(feed.posts[0].text).toContain("Original alpha");
    db.prepare("UPDATE social_members SET next_post_at=?").run(Date.now() - 1);
    expect(
      (
        await request("publish", {
          ...body,
          operationId: crypto.randomUUID(),
          text: "Next day",
        })
      ).status,
    ).toBe(200);
  });
  it("does not restore the post allowance after deletion", async () => {
    const id = crypto.randomUUID();
    await request("publish", { operationId: id, text: "Original" });
    expect((await request("delete", { postId: id })).status).toBe(200);
    expect(
      (
        await request("publish", {
          operationId: crypto.randomUUID(),
          text: "Replacement",
        })
      ).status,
    ).toBe(409);
    expect((await json(await request("feed"))).posts).toHaveLength(0);
  });
  it("rejects operation reuse with changed content", async () => {
    const id = crypto.randomUUID();
    await request("publish", { operationId: id, text: "First" });
    expect(
      (await request("publish", { operationId: id, text: "Changed" })).status,
    ).toBe(409);
  });
  it("rewards local engagement once and never rewards self-engagement", async () => {
    const id = crypto.randomUUID();
    await request("publish", { operationId: id, text: "Useful post" });
    await request("interact", { postId: id, kind: "like" });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM social_rewards WHERE action='like'")
        .get()?.n,
    ).toBe(0);
    await request("interact", { postId: id, kind: "like" }, other);
    await request("interact", { postId: id, kind: "like" }, other);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM social_rewards WHERE action='like'")
        .get()?.n,
    ).toBe(1);
  });
  it("does not trust client multiplier or runtime bonus flags", async () => {
    await request("visit", { multiplier: 999, context: true });
    await request("visit", {});
    const me = await json(await request("me"));
    expect(me.boost.multiplier).toBe(1);
    expect(me.totals.points).toBe(5);
  });
  it("merges verified identities without resetting cooldown, duplicate daily rewards or bans", async () => {
    await request("visit", {});
    await request("visit", {}, null, 123);
    await request("publish", {
      operationId: crypto.randomUUID(),
      text: "Wallet post",
    });
    db.prepare("INSERT INTO app_identity_links VALUES(?,?)").run(123, wallet);
    const me = await json(await request("me", undefined, wallet, 123));
    expect(me.member.next_post_at).toBeGreaterThan(Date.now());
    expect(me.totals.points).toBe(25);
    db.prepare("UPDATE social_members SET status='suspended' WHERE id=?").run(
      me.member.id,
    );
    expect((await request("visit", {}, wallet, 123)).status).toBe(403);
  });
  it("does not merge independently signed-in accounts without a verified link", async () => {
    await request("visit", {});
    await request("visit", {}, null, 123);
    const me = await json(await request("me", undefined, wallet, 123));
    expect(me.totals.points).toBe(7.5);
  });
  it("blocks premature exploration and makes replay idempotent", async () => {
    const id = crypto.randomUUID();
    await request("publish", { operationId: id, text: "Read me" });
    const started = await json(
      await request("view/start", { postId: id }, other),
    );
    expect(
      (await json(await request("view/complete", { id: started.id }, other)))
        .ok,
    ).toBe(false);
    db.prepare("UPDATE social_views SET started_at=? WHERE id=?").run(
      Date.now() - 6000,
      started.id,
    );
    expect(
      (await json(await request("view/complete", { id: started.id }, other)))
        .ok,
    ).toBe(true);
    expect(
      (await json(await request("view/complete", { id: started.id }, other)))
        .ok,
    ).toBe(true);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM social_rewards WHERE action='explore'",
        )
        .get()?.n,
    ).toBe(1);
  });
  it("repairs a saved engagement whose reward write was interrupted", async () => {
    const id = crypto.randomUUID();
    await request("publish", { operationId: id, text: "Retry recovery" });
    await request(
      "interact",
      { postId: id, kind: "comment", text: "Useful comment" },
      other,
    );
    db.prepare(
      "DELETE FROM social_rewards WHERE action IN ('comment','explore')",
    ).run();
    await request(
      "interact",
      { postId: id, kind: "comment", text: "Useful comment" },
      other,
    );
    await request(
      "interact",
      { postId: id, kind: "comment", text: "Useful comment" },
      other,
    );
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM social_rewards WHERE action='comment'",
        )
        .get()?.n,
    ).toBe(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM social_rewards WHERE action='explore'",
        )
        .get()?.n,
    ).toBe(2);
  });
  it("repairs a completed view without granting another reward", async () => {
    const id = crypto.randomUUID();
    await request("publish", { operationId: id, text: "View recovery" });
    const started = await json(
      await request("view/start", { postId: id }, other),
    );
    db.prepare(
      "UPDATE social_views SET started_at=?,completed_at=? WHERE id=?",
    ).run(Date.now() - 10000, Date.now() - 5000, started.id);
    await request("view/complete", { id: started.id }, other);
    await request("view/complete", { id: started.id }, other);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM social_rewards WHERE action='explore'",
        )
        .get()?.n,
    ).toBe(1);
  });
  it("hydrates a busy feed within D1's 100-parameter limit", async () => {
    await request("visit", {});
    const member = db.prepare("SELECT id FROM social_members LIMIT 1").get()!
      .id;
    const insert = db.prepare(
      "INSERT INTO social_posts(id,member_id,text,created_at,submitted_at) VALUES(?,?,?,?,?)",
    );
    for (let i = 0; i < 105; i++)
      insert.run(
        `bulk-${i}`,
        member,
        `Post ${i}`,
        Date.now() - i,
        Date.now() - i,
      );
    const response = await request("feed");
    expect(response.status).toBe(200);
    const result = await json(response);
    expect(result.posts).toHaveLength(20);
    expect(result.next).toBe(20);
  });
  it("hides muted authors from both feed sections", async () => {
    const id = crypto.randomUUID();
    await request("publish", { operationId: id, text: "Mute test" });
    await request("mute", { postId: id }, other);
    expect(
      (await json(await request("feed", undefined, other))).posts,
    ).toHaveLength(0);
  });
  it("rejects cross-origin writes", async () => {
    const response = await handleSocial({
      request: new Request("https://social.10x.meme/api/social/visit", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      env,
    } as Parameters<typeof handleSocial>[0]);
    expect(response.status).toBe(403);
  });
});
describe("Rules and metadata", () => {
  it("caps all four categories at a total of 10x and ranking at 2x", () => {
    const result = calculateBoost(DEFAULT_SOCIAL_CONFIG, {
      connection: true,
      context: true,
      notifications: true,
      signer: true,
      follow: true,
      email: true,
      streak: 100,
      warpletLevel: 100,
      stonklets: 100,
    });
    expect(result.multiplier).toBe(10);
    expect(result.ranking).toBe(2);
    expect(result.contributions.warplets).toBe(2.5);
  });
  it("resets the streak after a missing UTC day, not after a timezone change", () => {
    const now = Date.parse("2026-10-07T00:01:00Z");
    expect(nextStreak("2026-10-06", 9, now)).toBe(10);
    expect(nextStreak("2026-10-05", 9, now)).toBe(1);
    expect(nextStreak("2026-10-07", 10, now)).toBe(10);
  });
  it("rejects comments, wrong authors and old casts as feed submissions", () => {
    const cast = {
      hash: `0x${"a".repeat(40)}`,
      text: "test",
      timestamp: new Date().toISOString(),
      author: { fid: 123 },
    };
    expect(() => validateCast(cast, 123)).not.toThrow();
    expect(() => validateCast({ ...cast, parent_hash: "parent" }, 123)).toThrow(
      /Comments/,
    );
    expect(() => validateCast(cast, 456)).toThrow(/own account/);
    expect(() =>
      validateCast(
        { ...cast, timestamp: new Date(Date.now() - DAY - 1).toISOString() },
        123,
      ),
    ).toThrow(/24 hours/);
  });
  it("validates settings and URLs instead of accepting arbitrary JSON", () => {
    expect(() => validateSocialConfig(DEFAULT_SOCIAL_CONFIG)).not.toThrow();
    expect(() =>
      validateSocialConfig({
        ...DEFAULT_SOCIAL_CONFIG,
        boosts: { ...DEFAULT_SOCIAL_CONFIG.boosts, maximum: Infinity },
      }),
    ).toThrow();
    expect(safeSocialUrl("javascript:alert(1)")).toBeNull();
  });
  it("renders Social metadata without leaking another app's identity or unescaped post content", () => {
    const html = socialHtml(
      '<html><head><title>Old</title><meta property="og:title" content="Old"><meta name="base:app_id" content="old"></head></html>',
      "https://social.10x.meme",
      "/post/123",
      "Alice <script>",
      '"test"',
    );
    expect(html).not.toContain('content="Old"');
    expect(html).not.toContain('content="old"');
    expect(html).toContain("Alice &lt;script&gt;");
    expect(html).toContain("fc:miniapp");
    expect(socialManifest("social-local.10x.meme").miniapp.noindex).toBe(true);
  });
});

describe("Retired automatic holder feed", () => {
  it("does not expose imported-only casts through bonus feeds or archive search", async () => {
    const id = crypto.randomUUID();
    await request("publish", {
      operationId: id,
      text: "Imported-only fixture",
    });
    db.prepare("UPDATE social_posts SET submitted_at=NULL WHERE id=?").run(id);
    db.prepare(
      "INSERT INTO social_bonus(fid,post_id,expires_at) VALUES(?,?,?)",
    ).run(7, id, Date.now() + DAY);
    expect((await json(await request("feed?section=bonus"))).posts).toEqual([]);
    expect(
      (await json(await request("feed?section=bonus&q=fixture"))).posts,
    ).toEqual([]);
    expect((await json(await request("feed?q=fixture"))).posts).toEqual([]);
  });
  it("refreshes only submitted casts, even for forced jobs, without scanning holders", async () => {
    const member = await ensureIdentity(env.WARPLETS, "fid:7", "holder");
    const manual = "0x" + "1".repeat(40),
      imported = "0x" + "2".repeat(40);
    const insert = db.prepare(
      "INSERT INTO social_posts(id,member_id,fid,cast_hash,text,created_at,submitted_at) VALUES(?,?,?,?,?,?,?)",
    );
    insert.run(
      manual,
      member.id,
      7,
      manual,
      "Submitted",
      Date.now(),
      Date.now(),
    );
    insert.run(imported, member.id, 7, imported, "Imported", Date.now(), null);
    const fetch = vi.spyOn(socialProvider, "fetchCast").mockResolvedValue({
      hash: manual,
      text: "Submitted updated",
      timestamp: new Date().toISOString(),
      author: { fid: 7 },
      reactions: { likes_count: 9 },
    });
    env.NEYNAR_API_KEY = "test-only";
    const result = await ingestSocial(env, true);
    expect(result).toMatchObject({ status: "complete", requests: 1, saved: 1 });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(env, manual);
    expect(
      db.prepare("SELECT likes FROM social_posts WHERE id=?").get(manual)
        ?.likes,
    ).toBe(9);
    expect(
      db.prepare("SELECT text FROM social_posts WHERE id=?").get(imported)
        ?.text,
    ).toBe("Imported");
    expect(db.prepare("SELECT COUNT(*) AS n FROM social_bonus").get()?.n).toBe(
      0,
    );
  });
});
