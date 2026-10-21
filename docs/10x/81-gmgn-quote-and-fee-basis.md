# Saved GMGN quote transfers and fee basis

21 October 2026. Continuation of [source-bound RPC comparison](80-gmgn-rpc-corroboration.md), [authentic daily attention](70-authentic-attention-momentum.md) and PRD §4.7. Free services, existing quotas, score-v4 and all evidence/action/election gates remain unchanged. No deploy.

Matching token quantities does not verify a provider's USD volume. Pool transfers, emitted gross quote, LP retention and wallet swap cash flow can use different fee bases. This milestone measures those distinctions from already saved canonical transactions and makes missing fee semantics explicit. No new collection path, provider request, migration or database write is added.

## Supported evidence and exact arithmetic

The [quote reviewer](../../discovery/src/gmgn-quote.ts) starts from a complete frozen RPC comparison. It replays its original trader-selection receipt, GMGN activity receipt, cached transaction bodies and v1 comparison report before computing a separate `gmgn-quote-review-v1` report. Original schemas, normalization outputs and report hashes remain unchanged. The archived optional-USD parser is reused through a pure exported helper; missing, unusable and negative signed reports remain unknown, never absolute volume.

Group events by exact signature and side. Require the prior exact-instruction or aggregate-quantity comparison to pass before measuring quote transfers. Unsupported token/time/signer/parser evidence cannot earn a measured quote. Sum each canonical instruction once, including when GMGN splits one instruction into several reported events. Non-trade events remain excluded. A source above the original two-signature bound stays held in full.

Only supported native SOL and WSOL quote transfers are included, both with nine decimals. Keep all raw quantities as integer strings and calculate with `BigInt`; the UI formats SOL without converting large integers through floating point. Buy and sell totals stay separate. Any unmeasured group holds its entire side total; an absent side stays null, not measured zero. Supported subgroup rows remain visible without implying full coverage.

The existing [fee-event/execution reconciler](../../discovery/src/trading-fees.ts) binds canonical instruction, wallet, token, side, timestamp, emitted fee arithmetic, exact direct transfers and recipients. This work changes none of its supported layouts or uncertainty rules.

| Measurement | Meaning and holds |
|---|---|
| Pool quote transfer | Actual parsed user-to-pool buy or pool-to-user sell transfer. A PumpSwap buy includes LP retention; a sell transfer is after applicable fees |
| Event quote | Emitted pre-fee quote, retained only when every selected instruction has a reconciled known fee row |
| Known fee components | Protocol gross + creator + LP. Buyback is a split of protocol gross and is counted once. A missing row holds the group sum; unknown extensions still label the reconciled known components as partial |
| Wallet swap cash flow | Buy event quote + known fees, or sell event quote − known fees, only when every selected fee row has **no gaps**. Unknown extensions, extra transfers or missing fee evidence withhold it |
| Provider-reported USD | Sum usable nonnegative `cost_usd` for the entire event group. Missing/unusable/signed reports hold the group total; explicit measured zero stays zero |
| Provider-implied USD/SOL | Reported group USD divided by measured pool-transfer SOL. A descriptive floating-point ratio with an explicit fee basis; **not an independent historical SOL price or USD verification** |

Even a complete known-layout swap calculation excludes network fees, account rent, tips and unrelated instructions. It is not total wallet spend or profit. No pool/event/wallet amount is substituted for another, and fees are not added twice. Aggregated token matching does not claim one-to-one provider event fee attribution.

## Cache-only UI, API and replay

The existing RPC comparison contains a collapsed **Review SOL transfers & fee basis** section. Expanding it fetches saved evidence only. It shows the actual cutoff, supported event denominator, separate side totals, token comparison status, fee completeness, exact SOL amounts, reported USD and the qualified implied conversion. Unknown quantities are labelled Unknown. No collection/action control is present; binding checks and abort handling prevent a different mint/activity response from replacing a matching review.

| Route | Scope |
|---|---|
| `GET /api/10x/gmgn/quote/:activity_uuid` | Public aggregate report; no added wallet/signature list, provider IO or database writes |
| `GET /api/10x/admin/gmgn/quote/:activity_uuid` | Authenticated complete comparison inputs and quote report for private replay |

```powershell
pnpm exec tsx scripts/discovery-gmgn-quote.ts read ACTIVITY_UUID
pnpm exec tsx scripts/discovery-gmgn-quote.ts freeze ACTIVITY_UUID
pnpm exec tsx scripts/discovery-gmgn-quote.ts review COMPARISON_FILE
pnpm exec tsx scripts/discovery-gmgn-quote.ts replay FILE
```

The [CLI](../../scripts/discovery-gmgn-quote.ts) offers no collection command. Reads use fixed loopback URLs, manual redirects, timeouts and bounded streams. Private freeze loads only the existing ignored operator token, verifies first and creates a unique ignored artifact without overwrite. Offline `review` builds a new quote artifact from a bounded frozen RPC comparison, preserving its original cutoff; offline replay recomputes the complete source/cache/comparison/quote chain. Both file operations require regular non-symlink files and load no credentials/network. Failures show only a fixed phase and HTTP status, never raw messages or secrets. The existing 6 MB comparison-input and 1.8 MB cached-body bounds remain; the outer quote replay is bounded to 6.2 MB. No new archive storage or retention policy is activated.

## Completed and remaining

- [x] Source-bound quote-transfer measurements with exact raw integers and all-or-unknown side totals.
- [x] Separate event/known-fee/wallet bases, buyback deduplication and strict partial-layout holds.
- [x] Explicit provider-implied conversion; cache-only public UI/API, authenticated freeze and deterministic offline replay.
- [ ] Independently verify historical SOL/USD, finality and remaining fee extensions/transaction layouts before certifying USD or complete wallet cash flow.
- [ ] Establish economic counterparty independence, complete representative daily trading windows and meaningful acquired/retained holders before authentic volume/growth credit.
- [ ] Preregister and prospectively validate the next attention model; preserve current v4, earlier artifacts and bounded-mode production restoration/retention prerequisites.

## Saved PONYX evidence and validation

The source remains activity UUID `64963533-bcc0-412c-9605-e82dbeb13d37` and its two saved RPC bodies. The two buy events match two canonical instructions in one signature, with the other signature belonging to a non-trade event. Cache-only quote review measures:

- **989.454343577 SOL** of buy-side pool quote transfers; no sell-side observation, so the sell total is unknown.
- **987.481158721 SOL** of event quote and **11.850267646 SOL** of known fee components. These amounts have distinct bases and must not be substituted or summed into a claimed wallet total.
- GMGN reports **$105,119.62946162048** for the group. Dividing by pool-transfer SOL implies exactly **106.24 USD/SOL** at displayed precision. No independent historical reference is supplied, so USD volume remains unverified.
- Both fee rows retain `fee_event_extension_uninterpreted`; fee status is **partial** and wallet swap cash flow stays **unknown**. No special routing or additional fees are invented from trailing bytes.

This is one selected-wallet launch sample, not a daily or organic-volume estimate, a fraud verdict or score adoption.

Offline `review` of the unchanged frozen RPC comparison (hash `7e28b5f73386d826aeecb1861ce0f3f23414d47483811023d51bf49efd5d3e31`) produces quote report hash **`a98a4665381c58888f79377dddc2178aa1256f7f4fea0da8dc01cc7e501ecf29`** at the original cutoff. The authenticated service freeze has its own later cutoff and report hash **`d3aee7b467f0b23670b1b16542577529af020433bf91de2fe2b93e257416247b`**. Both complete artifacts replay offline with zero provider calls/database writes; original source/cache/comparison hashes are checked, not rewritten.

**73 backend tests** pass across the new quote review (17), original RPC comparison (31), fee reconciliation (10) and wallet activity (15). Cases cover recorded native-buy/AMM-sell partial evidence, explicitly synthetic complete known layouts, LP/protocol/buyback arithmetic, unknown extensions, corrupted fee events, fractional/raw token matching, aggregate-only event splits, signed/missing/unusable/zero USD, incomplete-side totals, parser/time/source/cached-body conflicts, original replay, authenticated exports and public reads with zero writes/IO. Workstation load caused default five-second timeouts; a serial run with `--testTimeout=30000 --maxWorkers=1` passed without relaxing any runtime or evidence rule. Recorded incomplete fixtures stay incomplete; synthetic complete-layout bodies are never retained as live evidence.

All **105 Discovery UI tests across twenty files** pass, including exact large-integer formatting, Unknown versus measured zero, separate quote/fee bases and no collection controls. Discovery typecheck, generated OpenAPI and app typecheck/build pass. Startup remains **234.1 KiB gzip across eleven chunks**; existing dependency annotation warnings remain non-fatal.

Read-only per-row digests verify **173 original cohorts, zero outcomes, 39 completed source receipts, 804 holder receipts, 72 wallet receipts and all 595 cached RPC bodies** unchanged; foreign keys pass. Normal collection may append independently. No migration, archive rewrite, counter reset or unrelated Network/legal work is included. The actual-key scan passes across **19 task files and 72 built assets**, with both secret files ignored/untracked. All **461 local Markdown targets across 25 documents** resolve; whitespace passes.

The first private freeze was interrupted by the local Worker's existing runtime exit. Inspection found the recorded supervisor and API listener stopped, while the existing scheduled task was Ready. Starting that same `10X-Discovery-Local` task restored the hidden supervisor/launcher and preserved its stores, quota/pause state and original restart rules; one recent launcher start was recorded. No replacement task, duplicate collector, Wrangler upgrade or control reset. The restored public/private routes and token preview serve the cached results. No deploy.

Browser QA through the existing HTTPS preview confirms exact SOL formatting, two supported events, separate bases, partial fee rows, Unknown wallet cash flow and the independent-price caveat. Proof: `.tmp/gmgn-quote-basis-ponyx.png`. The temporary verification tab was closed; the user's Discover tab is preserved.

Commands: `pnpm --dir discovery exec vitest run --config vitest.config.ts src/gmgn-quote.test.ts src/gmgn-corroboration.test.ts src/trading-fees.test.ts src/gmgn-wallet-activity.test.ts --testTimeout=30000 --maxWorkers=1`; `pnpm --dir discovery exec tsc --noEmit`; `pnpm --dir app test src/discovery --maxWorkers=1 --testTimeout=30000`; `pnpm --dir app build`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; cache-only and offline CLI operations above; ignored preservation/link/key helpers.
