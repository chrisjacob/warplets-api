import {
  registerMarket,
  appendMarketEvidence,
  publishMarket,
} from "../../../meme/src/worker/markets";
import {
  importTrading,
  publishTrading,
} from "../../../meme/src/worker/trading";
import type { Database } from "../../../meme/src/worker/db";
import { encode58 } from "../../../meme/src/shared/base58";
export async function seedMarkets(db: Database, now = Date.now()) {
  const og = encode58(new Uint8Array(32).fill(2)),
    attn = encode58(new Uint8Array(32).fill(3)),
    wallet = encode58(new Uint8Array(32).fill(4));
  await registerMarket(db, {
    id: "fixture-alpha",
    symbol: "ATTNALPHA",
    ogSymbol: "ALPHA",
    ogMint: og,
    attnMint: attn,
    pool: null,
    launchedAt: now - 7200000,
    mode: "simulated",
  });
  await appendMarketEvidence(
    db,
    "fixture-alpha",
    "fixture:prices",
    [0, 1, 2, 3, 4].map((i) => ({
      at: now - 7200000 + i * 1800000,
      observedAt: now,
      ogUsd: ["1", "1.1", "0.9", "1.05", "1.2"][i],
      attnOg: ["1", "1.3", "0.8", "1.2", "1.5"][i],
      intervalMs: 1800000,
      source: "simulated-browser-fixture",
      evidenceHash: String(i + 1).repeat(64),
    })),
    now,
  );
  for (const w of ["24h", "30d", "all"] as const)
    await publishMarket(db, "fixture-alpha", w, now);
  await importTrading(
    db,
    {
      version: 1,
      fid: 42,
      wallets: [wallet],
      verifiedAt: 0,
      throughAt: now,
      complete: true,
      gaps: [],
      sourceHash: "a".repeat(64),
      mode: "simulated",
      markets: [{ id: "fixture-alpha", attnMint: attn, ogMint: og }],
      events: [
        {
          id: "fixture:buy",
          at: now - 3600000,
          slot: 1,
          index: 0,
          wallet,
          marketId: "fixture-alpha",
          kind: "buy",
          quantity: "10",
          usd: "100",
          og: "100",
          feeUsd: "1",
          feeOg: "1",
          signature: encode58(new Uint8Array(64).fill(1)),
          evidenceHash: "b".repeat(64),
          finalized: true,
        },
        {
          id: "fixture:sell",
          at: now - 1800000,
          slot: 2,
          index: 0,
          wallet,
          marketId: "fixture-alpha",
          kind: "sell",
          quantity: "5",
          usd: "90",
          og: "75",
          feeUsd: "1",
          feeOg: "1",
          signature: encode58(new Uint8Array(64).fill(2)),
          evidenceHash: "c".repeat(64),
          finalized: true,
        },
      ],
    },
    null,
    "Simulated browser fixture",
    now,
  );
  await publishTrading(db, now, now);
}
