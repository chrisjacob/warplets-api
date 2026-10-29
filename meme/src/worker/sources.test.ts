import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import {
  beginSource,
  collectSource,
  requireDependableSources,
  requireIndependentQuote,
} from "./sources";
import { heliusAdapter, parseOracle, type HistoryPage } from "./sourceAdapters";
import { encode58 } from "../shared/base58";
const wallet = "1".repeat(32),
  mint = encode58(new Uint8Array(32).fill(3)),
  sig = encode58(new Uint8Array(64).fill(1));
function setup() {
  const t = testDb(),
    now = Math.floor(Date.now() / 1000) * 1000,
    launch = now - 86400000,
    cutoff = now - 180000;
  t.raw
    .prepare(
      "INSERT INTO meme_campaigns VALUES('c',?,'C',?,?, '10000',0,'observed','test')",
    )
    .run(mint, launch, launch + 864000000);
  return { ...t, now, launch, cutoff };
}
function receipt(at: number): HistoryPage["data"][number] {
  return {
    slot: 400000000,
    blockTime: at / 1000,
    version: 0,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000],
      postBalances: [995000],
      preTokenBalances: [],
      postTokenBalances: [
        { owner: wallet, mint, uiTokenAmount: { amount: "100" } },
      ],
    },
    transaction: { signatures: [sig], message: { accountKeys: [wallet] } },
  };
}
test("real source adapters make no request without a specifically approved allowance", async () => {
  const t = setup();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Should not fetch");
  };
  try {
    await assert.rejects(
      heliusAdapter(t.db, "secret-not-logged").page({
        wallet,
        fromAt: t.launch,
        throughAt: t.cutoff,
        cursor: null,
      }),
      /allowance/,
    );
    assert.equal(calls, 0);
    assert.equal(
      t.raw
        .prepare("SELECT used FROM meme_source_budgets WHERE provider='helius'")
        .get()?.used,
      0,
    );
  } finally {
    globalThis.fetch = original;
    t.close();
  }
});

test("history requests preserve the finalized token-account scope and never reset reserved provider credits", async () => {
  const t = setup(),
    original = globalThis.fetch;
  let calls = 0;
  try {
    t.raw
      .prepare(
        "UPDATE meme_source_budgets SET ceiling=20 WHERE provider='helius'",
      )
      .run();
    globalThis.fetch = async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://mainnet.helius-rpc.com");
      const request = JSON.parse(String(init?.body)),
        options = request.params[1];
      assert.equal(options.commitment, "finalized");
      assert.equal(options.filters.tokenAccounts, "all");
      assert.equal(options.sortOrder, "asc");
      assert.equal(options.limit, 20);
      assert.equal(options.maxSupportedTransactionVersion, 1);
      assert.equal(init?.redirect, "manual");
      return calls === 1
        ? Response.json({ result: { data: [], paginationToken: null } })
        : new Response(null, { status: 503 });
    };
    const adapter = heliusAdapter(t.db, "test-key"),
      query = { wallet, fromAt: t.launch, throughAt: t.cutoff, cursor: null };
    await adapter.page(query);
    await assert.rejects(adapter.page(query), /failed/);
    assert.equal(
      t.raw
        .prepare("SELECT used FROM meme_source_budgets WHERE provider='helius'")
        .get()?.used,
      20,
    );
    await assert.rejects(adapter.page(query), /allowance/);
    assert.equal(calls, 2);
    const ancient = Date.UTC(2022, 0, 1);
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('ancient',?,'OLD',?,?, '10000',0,'observed','test')",
      )
      .run(encode58(new Uint8Array(32).fill(9)), ancient, ancient + 864000000);
    await assert.rejects(
      beginSource(t.db, "ancient", wallet, t.cutoff),
      /archival adapter/,
    );
  } finally {
    globalThis.fetch = original;
    t.close();
  }
});
test("history pagination is immutable, resumable after a lost response and cannot falsely cover unclassified movements", async () => {
  const t = setup();
  try {
    const { id } = await beginSource(t.db, "c", wallet, t.cutoff),
      r = receipt(t.launch + 10000);
    const adapter = {
      provider: "helius" as const,
      async page(q: { cursor: string | null }) {
        return q.cursor
          ? { data: [], paginationToken: null }
          : { data: [r], paginationToken: "400000000:1" };
      },
    };
    t.interruptNextBatch();
    await assert.rejects(collectSource(t.db, id, adapter), /lost response/);
    assert.equal(
      t.raw.prepare("SELECT pages FROM meme_source_runs").get()?.pages,
      1,
    );
    assert.equal((await collectSource(t.db, id, adapter)).state, "ready");
    assert.equal((await collectSource(t.db, id, adapter)).state, "ready");
    await assert.rejects(
      requireDependableSources(
        t.db,
        "c",
        mint,
        t.launch,
        t.cutoff,
        new Set([wallet]),
      ),
      /unclassified/,
    );
    const event = {
      signature: sig,
      index: 0,
      slot: r.slot,
      at: r.blockTime! * 1000,
      kind: "airdrop",
      quantity: "100",
      wallet,
    };
    t.raw
      .prepare("INSERT INTO meme_ledger_events VALUES(?,?,?,?,?,?,?,?)")
      .run("e", "c", sig, 0, r.slot, event.at, JSON.stringify(event), "hash");
    t.raw
      .prepare("INSERT INTO meme_receipt_claims VALUES(?,?,?,?)")
      .run("c", sig, wallet, "e");
    await requireDependableSources(
      t.db,
      "c",
      mint,
      t.launch,
      t.cutoff,
      new Set([wallet]),
    );
    await assert.rejects(
      requireDependableSources(
        t.db,
        "c",
        mint,
        t.launch,
        t.cutoff + 1,
        new Set([wallet]),
      ),
      /Complete/,
    );
    assert.throws(
      () => t.raw.prepare("UPDATE meme_source_pages SET payload='{}'").run(),
      /immutable/,
    );
  } finally {
    t.close();
  }
});
test("looping cursors, unsupported versions, ancient owner metadata and contradictory receipts retain the checkpoint", async () => {
  const t = setup();
  try {
    const { id } = await beginSource(t.db, "c", wallet, t.cutoff);
    for (const changed of [
      { slot: 1 },
      { version: 1 },
      { version: undefined },
      { blockTime: null },
    ])
      await assert.rejects(
        collectSource(t.db, id, {
          provider: "helius",
          page: async () => ({
            data: [{ ...receipt(t.launch + 10000), ...changed }],
            paginationToken: null,
          }),
        }),
        /unsupported/,
      );
    assert.equal(
      t.raw.prepare("SELECT pages FROM meme_source_runs").get()?.pages,
      0,
    );
    const r = receipt(t.launch + 10000);
    await collectSource(t.db, id, {
      provider: "helius",
      page: async () => ({ data: [r], paginationToken: "cursor" }),
    });
    await assert.rejects(
      collectSource(t.db, id, {
        provider: "helius",
        page: async () => ({ data: [r], paginationToken: "cursor" }),
      }),
      /cursor/,
    );
    assert.equal(
      t.raw.prepare("SELECT pages FROM meme_source_runs").get()?.pages,
      1,
    );
  } finally {
    t.close();
  }
});
test("oracle evidence requires the exact approved mint/feed/time, integer precision and a bounded confidence interval", async () => {
  const t = setup();
  try {
    const feed = {
      payment_mint: "native:SOL",
      feed_id: "ab".repeat(32),
      decimals: 9,
      max_age_seconds: 5,
      max_confidence_bps: 100,
    };
    const raw = {
      parsed: [
        {
          id: feed.feed_id,
          price: {
            price: "12345678900",
            conf: "1000",
            expo: -8,
            publish_time: t.cutoff / 1000,
          },
        },
      ],
    };
    assert.equal(parseOracle(raw, feed, t.cutoff).usdMicros, "123456789");
    assert.throws(
      () => parseOracle(raw, { ...feed, feed_id: "cd".repeat(32) }, t.cutoff),
      /feed/,
    );
    assert.throws(() => parseOracle(raw, feed, t.cutoff + 6000), /stale/);
    assert.throws(
      () =>
        parseOracle(
          {
            ...raw,
            parsed: [
              {
                ...raw.parsed[0],
                price: { ...raw.parsed[0].price, conf: "999999999" },
              },
            ],
          },
          feed,
          t.cutoff,
        ),
      /uncertain/,
    );
    const event = {
      signature: sig,
      index: 0,
      slot: 400000000,
      at: t.cutoff,
      kind: "purchase" as const,
      quantity: "100",
      wallet,
      quote: {
        paidUnits: "1000",
        paymentMint: "native:SOL",
        paymentDecimals: 9,
        usdPriceMicros: "123456789",
        at: t.cutoff,
        source: "operator",
        evidenceHash: "unsupported",
      },
    };
    await assert.rejects(requireIndependentQuote(t.db, event), /Independent/);
  } finally {
    t.close();
  }
});
