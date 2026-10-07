// Local-only bootstrap. Never accepts a remote database or prints credentials.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { ingestSocial } from "../app/functions/_lib/socialIngestion";
import type { SocialEnv } from "../app/functions/_lib/socialStore";
if (!process.argv.includes("--local"))
  throw new Error("Pass --local to confirm local-only ingestion");
const root = resolve("app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = readdirSync(root).find((name) =>
  /^[a-f0-9]{64}\.sqlite$/.test(name),
);
if (!file) throw new Error("Initialize local D1 first");
const db = new DatabaseSync(resolve(root, file));
db.exec("PRAGMA busy_timeout=10000");
function prepare(sql: string) {
  let values: unknown[] = [];
  return {
    bind(...args: unknown[]) {
      values = args;
      return this;
    },
    async first() {
      return (
        db.prepare(sql).get(...(values as (string | number | null)[])) ?? null
      );
    },
    async all() {
      return {
        results: db.prepare(sql).all(...(values as (string | number | null)[])),
      };
    },
    async run() {
      return {
        meta: {
          changes: Number(
            db.prepare(sql).run(...(values as (string | number | null)[]))
              .changes,
          ),
        },
      };
    },
  };
}
const d1 = {
  prepare,
  async batch(statements: Array<ReturnType<typeof prepare>>) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
} as unknown as D1Database;
const vars = readFileSync("app/.dev.vars", "utf8");
const match = vars.match(/^NEYNAR_API_KEY\s*=\s*(.+)$/m);
if (!match) throw new Error("Configure NEYNAR_API_KEY in app/.dev.vars");
const key = match[1]!.trim().replace(/^["']|["']$/g, "");
try {
  // Browser smoke-test content is local-only and never enters the review feed.
  db.exec(
    "UPDATE social_members SET status='suspended' WHERE id IN(SELECT member_id FROM social_posts WHERE text LIKE '[Local QA]%'); UPDATE social_posts SET status='hidden' WHERE text LIKE '[Local QA]%' AND status='visible'",
  );
  const result = await ingestSocial(
    { WARPLETS: d1, NEYNAR_API_KEY: key } as SocialEnv,
    true,
  );
  console.log(JSON.stringify(result));
  console.log(
    "Local submitted posts:",
    db.prepare("SELECT COUNT(*) AS posts FROM social_posts WHERE submitted_at IS NOT NULL").get(),
  );
} finally {
  db.close();
}
