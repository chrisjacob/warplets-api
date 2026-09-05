import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { onRequestGet } from "./voters";
import { STONKLETS_CATALOG } from "../../../shared/stonkletsCatalog";
import { isStonkletsVotesPreview, mockVoteCount } from "../../../shared/stonkletsVotes";

const databases: DatabaseSync[] = [];
function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE stonklet_asset_favourites(identity_wallet TEXT, pair_id TEXT, asset TEXT, active INTEGER, favourited_at TEXT);
    CREATE TABLE wallet_farcaster_links(wallet TEXT, fid INTEGER, score REAL, username TEXT, pfp_url TEXT);
    CREATE TABLE warplets_users(fid INTEGER, primary_eth_address TEXT, username TEXT, pfp_url TEXT);`);
  const binding = { prepare(sql: string) {
    let values: (string | number | null)[] = [];
    return { bind(...args: typeof values) { values = args; return this; }, async first() { return db.prepare(sql).get(...values) ?? null; }, async all() { return { results: db.prepare(sql).all(...values) }; } };
  } };
  return { db, binding };
}
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
async function get(binding: unknown, query = "", host = "localhost") {
  const response = await onRequestGet({ request: new Request(`https://${host}/api/stonklets/voters?id=apple${query}`), env: { WARPLETS: binding } } as never) as Response;
  return { response, body: await response.json() as { total: number; voters: { wallet: string; username: string | null; image: string | null }[]; nextCursor: string | null } };
}

describe("Stonklet voter pages", () => {
  it("counts only active Stonklet favourites and paginates tied timestamps without duplicate wallets", async () => {
    const { db, binding } = database();
    const insert = db.prepare("INSERT INTO stonklet_asset_favourites VALUES (?, 'apple', ?, ?, ?)");
    for (let n = 1; n <= 45; n++) insert.run(wallet(n), "stonklet", 1, "2026-09-01T00:00:00.000Z");
    insert.run(wallet(100), "stock", 1, "2026-09-02T00:00:00.000Z");
    insert.run(wallet(101), "stonklet", 0, "2026-09-02T00:00:00.000Z");
    db.prepare("INSERT INTO wallet_farcaster_links VALUES (?, 1, 1, 'older-link', 'https://example.com/1.png'), (?, 2, 2, 'best-link', 'https://example.com/2.png')").run(wallet(1), wallet(1));
    db.prepare("INSERT INTO warplets_users VALUES (3, ?, 'primary', 'https://example.com/3.png')").run(` ${wallet(2).toUpperCase()} `);
    const first = (await get(binding)).body;
    expect(first.total).toBe(45);
    expect(first.voters).toHaveLength(20);
    expect(first.voters[0].username).toBe("best-link");
    expect(first.voters[1].username).toBe("primary");
    const second = (await get(binding, `&cursor=${encodeURIComponent(first.nextCursor!)}`)).body;
    const third = (await get(binding, `&cursor=${encodeURIComponent(second.nextCursor!)}`)).body;
    expect(second.voters).toHaveLength(20);
    expect(third.voters).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    expect(new Set([...first.voters, ...second.voters, ...third.voters].map((v) => v.wallet)).size).toBe(45);
    const stack = (await get(binding, "&stack=1")).body;
    expect(stack.total).toBe(45);
    expect(stack.voters.map((v) => v.username)).toEqual(["best-link", "primary"]);
  });

  it("returns the ten newest eligible Farcaster images, excluding wallet-only voters", async () => {
    const { db, binding } = database();
    for (let n = 1; n <= 30; n++) {
      db.prepare("INSERT INTO stonklet_asset_favourites VALUES (?, 'apple', 'stonklet', 1, ?)").run(wallet(n), new Date(Date.UTC(2026, 8, n)).toISOString());
      if (n % 2 === 0) db.prepare("INSERT INTO warplets_users VALUES (?, ?, ?, ?)").run(n, wallet(n), `user${n}`, `https://example.com/${n}.png`);
    }
    const { body } = await get(binding, "&stack=1");
    expect(body.total).toBe(30);
    expect(body.voters).toHaveLength(10);
    expect(body.voters.map((v) => v.wallet)).toEqual(Array.from({ length: 10 }, (_, n) => wallet(30 - n * 2)));
  });

  it("limits mocks to local hosts and rejects malformed cursors", async () => {
    const { db, binding } = database();
    db.exec("INSERT INTO warplets_users VALUES (1, NULL, 'sample', 'https://example.com/sample.png')");
    expect((await get(binding, "&votes=1")).body.total).toBe(1234);
    expect((await get(binding, "&votes=1&self=1")).body.total).toBe(1235);
    expect((await get(binding, "&votes=1", "stonklet.10x.meme")).body.total).toBe(0);
    expect((await get(binding, "&cursor=broken")).response.status).toBe(400);
    expect((await get(binding, "&votes=1&cursor=-1")).response.status).toBe(400);
    expect(isStonkletsVotesPreview(new URL("https://stonklet-local.10x.meme.evil.test/?votes=1"))).toBe(false);
    expect(STONKLETS_CATALOG.some((entry) => mockVoteCount(entry.id) === 0)).toBe(true);
    expect(STONKLETS_CATALOG.some((entry) => mockVoteCount(entry.id) === 1)).toBe(true);
  });
});
