import { afterEach, expect, it, vi } from "vitest";
import { ingestCmcMarketIfDue } from "./stonkletCmc";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const writes: { sql: string; args: unknown[] }[] = [];
  const db = { prepare: (sql: string) => {
    let args: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => { args = values; return statement; },
      all: async () => ({ results: [] }),
      first: async () => sql.includes("RETURNING credits") ? { credits: 1 } : { lease_until: args[1] },
      run: async () => { writes.push({ sql, args }); return {}; },
    };
    return statement;
  }};
  return { writes, env: { WARPLETS: db, STONKLETS_CMC_ENABLED: "true", COINMARKETCAP_API_KEY: "test" } };
}

it("refunds explicitly zero-credit errors and backs off failed mappings across cron runs", async () => {
  const { env, writes } = fixture();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: { error_code: 429, error_message: "rate limited", credit_count: 0 } }, { status: 429 })));
  await ingestCmcMarketIfDue(env as never);
  expect(writes.find(w => w.sql.includes("SET credits"))?.args[0]).toBe(-1);
  const release = writes.find(w => w.sql.includes("UPDATE stonklet_cmc_ingest_locks") && w.args[2] === "mapping")!;
  expect(Date.parse(release.args[0] as string) - Date.parse(release.args[1] as string)).toBeGreaterThanOrEqual(15 * 60_000);
});

it.each([undefined, "network"])("retains reservations when provider charge is unknown (%s)", async mode => {
  const { env, writes } = fixture();
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (mode === "network") throw new Error("timeout");
    return Response.json({ status: { error_code: 500 } }, { status: 500 });
  }));
  await ingestCmcMarketIfDue(env as never);
  expect(writes.filter(w => w.sql.includes("SET credits"))).toHaveLength(0);
});

it("accounts for provider charges above the reserved credit even on errors", async () => {
  const { env, writes } = fixture();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: { error_code: 500, credit_count: 3 } }, { status: 500 })));
  await ingestCmcMarketIfDue(env as never);
  expect(writes.find(w => w.sql.includes("SET credits"))?.args[0]).toBe(2);
});
