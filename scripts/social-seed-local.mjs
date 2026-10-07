// One-off local test data only. No remote writes, casting, or reward allocation.
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
if (!process.argv.includes("--local"))
  throw Error("Pass --local; this script cannot target a remote database.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(root, ".tmp/social-seed");
mkdirSync(cache, { recursive: true });
const feeds = [
  [
    "personalized",
    "feed?feed_type=following&fid=1129138&limit=100&with_recasts=false",
  ],
  ["youtube", "cast/search/?q=youtube.com&limit=100"],
  ["twitter", "cast/search/?q=x.com&limit=100"],
];
const sources = [];
for (const [name, path] of feeds) {
  const file = resolve(cache, name + ".json");
  if (!existsSync(file) || process.argv.includes("--refresh")) {
    const key = readFileSync(resolve(root, "app/.dev.vars"), "utf8")
      .match(/^NEYNAR_API_KEY\s*=\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (!key) throw Error("Configure NEYNAR_API_KEY in app/.dev.vars");
    const r = await fetch("https://api.neynar.com/v2/farcaster/" + path, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error(`Provider ${name} returned HTTP ${r.status}`);
    const d = await r.json();
    writeFileSync(file, JSON.stringify(d.casts || d.result?.casts || []));
  }
  for (const cast of JSON.parse(readFileSync(file, "utf8")))
    sources.push({ cast, source: name });
}
const safe = (url) => {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? url : null;
  } catch {
    return null;
  }
};
const urls = (c) =>
  (c.embeds || []).flatMap((e) =>
    e.url
      ? [safe(e.url)].filter(Boolean)
      : e.cast_id || e.cast?.hash
        ? [
            `https://farcaster.xyz/~/conversations/${e.cast_id?.hash || e.cast.hash}`,
          ]
        : [],
  );
function types(c) {
  const u = urls(c);
  return [
    !u.length ? "text" : null,
    u.some((x) =>
      /\.(png|jpe?g|gif|webp|avif)(\?|$)|imagedelivery\.net|images\.|wrpcd\.net/i.test(
        x,
      ),
    )
      ? "image"
      : null,
    u.some((x) => /\.(mp4|webm|m3u8)(\?|$)/i.test(x)) ? "video" : null,
    u.some((x) => /https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(x))
      ? "youtube"
      : null,
    u.some((x) => /https?:\/\/(www\.)?(x|twitter)\.com\//i.test(x))
      ? "twitter"
      : null,
    u.some((x) => /farcaster.xyz\/~\/conversations/.test(x)) ? "quote" : null,
    u.length ? "link" : null,
  ].filter(Boolean);
}
const pool = [
  ...new Map(
    sources
      .filter(
        ({ cast: c }) =>
          !c.parent_hash &&
          /^0x[0-9a-f]{40}$/i.test(c.hash) &&
          c.author?.fid &&
          Number.isFinite(Date.parse(c.timestamp)),
      )
      .map((x) => [x.cast.hash, x]),
  ).values(),
];
const selected = [],
  used = new Set();
function take(test, count) {
  for (const x of pool.filter(test)) {
    if (!used.has(x.cast.hash) && selected.length < 25) {
      used.add(x.cast.hash);
      selected.push(x);
      if (--count === 0) break;
    }
  }
}
take((x) => types(x.cast).includes("youtube"), 3);
take((x) => types(x.cast).includes("twitter"), 3);
take((x) => x.source === "personalized" && types(x.cast).includes("video"), 4);
take((x) => x.source === "personalized" && types(x.cast).includes("image"), 7);
take(
  (x) =>
    x.source === "personalized" &&
    types(x.cast).includes("text") &&
    x.cast.text.length > 240,
  2,
);
take(
  (x) =>
    x.source === "personalized" &&
    types(x.cast).includes("text") &&
    x.cast.text.length < 100,
  2,
);
take((x) => x.source === "personalized" && types(x.cast).includes("quote"), 1);
take((x) => x.source === "personalized", 25 - selected.length);
if (selected.length !== 25)
  throw Error(`Only ${selected.length} suitable casts; no database changed.`);
const state = resolve(
  root,
  "app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject",
);
let db;
for (const name of readdirSync(state).filter((n) =>
  /^[a-f0-9]{64}\.sqlite$/.test(n),
)) {
  const candidate = new DatabaseSync(resolve(state, name));
  if (
    candidate
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='social_posts'",
      )
      .get()
  ) {
    if (db) {
      candidate.close();
      db.close();
      throw Error("Ambiguous local Social database");
    }
    db = candidate;
  } else candidate.close();
}
if (!db) throw Error("Initialize the local Social database first.");
const now = Date.now(),
  manifest = [];
try {
  db.exec("PRAGMA busy_timeout=10000; BEGIN IMMEDIATE");
  for (const { cast: c, source } of selected) {
    const identity = "fid:" + c.author.fid;
    let member = db
      .prepare(
        "SELECT m.* FROM social_members m JOIN social_identities i ON i.member_id=m.id WHERE i.identity=?",
      )
      .get(identity);
    if (!member) {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO social_members(id,group_id,username,avatar,created_at) VALUES(?,?,?,?,?)",
      ).run(
        id,
        id,
        c.author.username || "fid-" + c.author.fid,
        safe(c.author.pfp_url),
        now,
      );
      db.prepare(
        "INSERT INTO social_identities(identity,member_id,created_at) VALUES(?,?,?)",
      ).run(identity, id, now);
      member = { id, status: "active" };
    }
    if (member.status !== "active")
      throw Error(
        "A selected author is locally moderated; choose a different sample.",
      );
    const previous = db
      .prepare("SELECT submitted_at FROM social_posts WHERE id=?")
      .get(c.hash);
    // Existing submissions are preserved; only new/imported casts are promoted for local testing.
    db.prepare(
      `INSERT INTO social_posts(id,member_id,fid,cast_hash,text,embeds_json,raw_json,kind,created_at,submitted_at,likes,comments,recasts,refreshed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET submitted_at=COALESCE(social_posts.submitted_at,excluded.submitted_at)`,
    ).run(
      c.hash,
      member.id,
      c.author.fid,
      c.hash,
      c.text,
      JSON.stringify(urls(c)),
      JSON.stringify(c),
      types(c).includes("quote") ? "quote" : "original",
      Date.parse(c.timestamp),
      now,
      c.reactions?.likes_count || 0,
      c.replies?.count || 0,
      c.reactions?.recasts_count || 0,
      now,
    );
    db.prepare(
      "INSERT INTO social_audit(id,actor,action,target,details,created_at) VALUES(?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      "local-test-seed",
      "test_import",
      c.hash,
      JSON.stringify({
        source,
        originalTimestamp: c.timestamp,
        previousSubmittedAt: previous?.submitted_at ?? null,
      }),
      now,
    );
    manifest.push({
      hash: c.hash,
      author: c.author.username,
      source,
      types: types(c),
      length: c.text.length,
      embeds: urls(c),
      originalTimestamp: c.timestamp,
    });
  }
  db.exec("COMMIT");
  writeFileSync(
    resolve(cache, "manifest.json"),
    JSON.stringify(
      {
        importedAt: new Date(now).toISOString(),
        feedVisibleUntil: new Date(now + 86400000).toISOString(),
        posts: manifest,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        imported: manifest.length,
        fromFollowing: manifest.filter((x) => x.source === "personalized")
          .length,
        types: Object.fromEntries(
          ["text", "image", "video", "youtube", "twitter", "quote"].map((t) => [
            t,
            manifest.filter((x) => x.types.includes(t)).length,
          ]),
        ),
        textLengths: [
          Math.min(...manifest.map((x) => x.length)),
          Math.max(...manifest.map((x) => x.length)),
        ],
        manifest: ".tmp/social-seed/manifest.json",
        dailyFeedExpires: new Date(now + 86400000).toISOString(),
      },
      null,
      2,
    ),
  );
} catch (e) {
  if (db.isTransaction) db.exec("ROLLBACK");
  throw e;
} finally {
  db.close();
}
