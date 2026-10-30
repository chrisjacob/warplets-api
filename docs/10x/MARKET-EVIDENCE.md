# Market evidence and public-read budget

Migration 0016 adds immutable market definitions, observation imports, correction provenance and published views. These are isolated launchpad tables. They do not certify ownership freezes, financial settlement prices, market liquidity or a production launch.

Operator commands (loopback, authenticated; all use the existing local transport):

```text
pnpm --dir meme operator market-register <definition.json>
pnpm --dir meme operator market-import <market-id> <observations.json> <stable-import-key>
pnpm --dir meme operator market-publish <market-id> <24h|30d|all>
pnpm --dir meme operator market-correct <review.json>
```

Imports contain at most 20 observations with positive exact decimal OG/USD prices, optional ATTN/OG ratios, source/evidence hashes and observation/block times. ATTN observations cannot precede actual launch. Collection pauses stop imports; operations pauses stop publication/correction. Lost responses use the original import/review key. Definitions and past views cannot be overwritten.

Contradictory prices at one timestamp block publication until an explicit correction identifies the old/new content-addressed observations and a reason. The immutable correction graph rejects cycles and preserves previous snapshots. A correction never rewrites finalized reward allocations. Publication commits the active facts and correction lineage.

GET `/api/meme/markets` returns at most 20 definitions with an `after` key cursor. GET `/api/meme/markets/:id?window=24h|30d|all` reads only a materialized view. The publisher reads at most 2,001 active observations; exceeding 2,000 marks coverage limited. Views retain at most 500 line points and propagate source gaps through downsampling. Return comparisons use the first actual common observation, actual launch, matching periods and exact arithmetic. Source times and runtime staleness remain visible; `financialEvidence` is always false. No public read initiates collection or publication.

## One overnight live-read allowance

Set `MEME_PUBLIC_READ_APPROVAL=2026-10-31` only for an intentional approved live check. The shared RPC helper reserves each attempted public call in `<repository-root>/.tmp/launchpad-public-reads-2026-10-31.json` before network I/O. It shares 50 calls across worktrees/restarts, allows only the existing public Base/Solana endpoints and explicit read/simulation methods, and never resets on failure or clock rollover. Ordinary CLI/CI without that approval context cannot make remote RPC calls. Existing Helius/Pyth and production provider caps remain unchanged. No paid/provider fallback is used.

## Finalized ownership checkpoint

`node packages/meme-qa/src/ownership-checkpoint.mjs start|step|status <ignored-checkpoint.json>` pins Base 8453 and the Warplet collection at one finalized block. Each step reconciles at most 20 `ownerOf` calls with EIP-1898 `blockHash`/`requireCanonical`; it saves every accepted token before proceeding. Errors, unsupported block-hash calls, quota exhaustion or canonicality changes preserve the checkpoint and block completion. A file lock prevents parallel writers. A complete source covers IDs 1–10,000 exactly; metadata binding and financial-freeze eligibility remain false until independently integrated and validated. It never updates production or the original ownership cache.

Fixtures prove restart recovery, a synthetic full 10K roster, mismatch reporting, source gaps, exact compounded returns and immutable/corrected publication. They do not certify full live coverage or host/wallet compatibility.
