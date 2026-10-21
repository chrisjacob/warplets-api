# Source-bound GMGN event / RPC comparison

21 October 2026. Continuation of [selected wallet activity](79-gmgn-wallet-activity.md) and PRD §4.7. Current score-v4 and all evidence, eligibility, action and election gates remain unchanged. No deploy.

The retained GMGN sample reported two PONYX buys at its creation second, but neither signature was in the saved wallet sample or broader transaction cache. Provider signature syntax and reported USD were insufficient to verify trading. This milestone adds an explicit bounded RPC investigation followed by cache-only comparison and replay. It does not certify wash trading, independent finality, historical USD or organic demand.

## Collection and resource boundaries

The [operator collector](../../discovery/src/gmgn-corroboration-store.ts) accepts only an existing accepted activity UUID. It replays the entire activity receipt and its frozen trader-selection receipt before any reservation. The source must be no older than 24 hours and contain one or two unique signatures across **all** returned events, including non-trades. Sources above two signatures hold in full; no convenient subset or arbitrary signature/wallet/mint/URL can be submitted.

Collection uses the existing wallet lease, next-refresh pacing, global pause/backoff, wallet RPC subset and global daily RPC allowance. Ownership, day, pause and backoff are checked before every reservation and publication. Each HTTP call reserves both existing quotas. A mainnet genesis check plus at most two missing `getTransaction` bodies means **three RPC calls maximum**, with finalized commitment, existing supported transaction formats, per-call timeout and bounded response parsing. Zero configured budgets hold before IO. Existing stronger 429 backoff remains. There is no GMGN HTTP request, extra allowance, timer, pilot expansion or scheduler connection.

An immutable source hash and activity UUID define one `tenx_jobs` attempt. Failed, missing-body and lost-response attempts cannot be blindly retried. Later invocations with all bodies cached return zero IO; otherwise a recorded attempt returns its existing journal state. A legitimate held lease/pacing admission creates no job and may be reconsidered when existing controls permit. Successful bodies enter the existing `tenx_wallet_transactions` cache with `INSERT OR IGNORE`; no original body is overwritten. Combined cached bodies are bounded to **1.8 MB**. This is the existing wallet RPC/cache lane, not a new GMGN research allowance; current research calibration and production restoration requirements remain separate and unchanged.

The journal records actual HTTP calls, new cache bodies and sanitized failure codes. The collector neither builds/adopts a wallet analysis nor changes a candidate, score cohort, outcome, eligibility, vote or action record. No migration or archive rewrite is required.

## Comparison semantics

The [pure reviewer](../../discovery/src/gmgn-corroboration.ts) revalidates source hashes/selection, cache hashes, signature identity and source/fetch/cutoff chronology. It uses the existing canonical Pump/PumpSwap instruction parser and requires the selected wallet as signer, matching side and exact block second. Failed transactions and parser gaps remain held. Non-trades remain counted but are excluded from trade matching.

Provider token quantities are compared to instruction raw integers using the exact retained decimal string and one consistent mint-decimal value from RPC balances. No binary-float rounding is used. Numeric fractional quantities, absent amounts/decimals and inconsistent decimals remain unknown. Integer quantities and exactly representable decimal strings can be compared; excess nonzero fractional precision is unusable.

| Result | Meaning |
|---|---|
| Exact instruction quantities | One-to-one multiset equality for all events/instructions in the same signature and side, plus signer/time/canonical parser checks |
| Aggregate quantity only | Total raw amount matches, but events do not map one-to-one to instruction quantities. One instruction never becomes two exact event matches |
| Quantity/time conflict | A measured disagreement, with no fraud conclusion; aggregation or parser scope may explain it |
| Cache missing / quantity unknown / parser held / wallet or side unsupported / transaction failed | Explicit missingness or failed evidence; no passing credit |

An RPC body is not an independently attested finality observation. Existing cache entries do not retain request commitment or independent provider identity. The new collector requests finalized bodies, but the report still makes no independent finality claim. Nor does a token amount establish economic counterparties, historical USD, beneficial independence, retention or a full trading window. The frozen GMGN activity normalizer and old report hashes are unchanged; the new comparison is a separately versioned report. Later evidence never enriches archived scores.

## UI, API and replay

The existing collapsed GMGN panel links the latest accepted activity UUID to **Compare with saved RPC transactions**. It reads a report only when expanded and shows dated cache coverage, exact versus aggregate counts, non-trade exclusion and all holds. Public output contains aggregate groups and hashes, without an added wallet/signature list. No collection or action button is exposed. Legacy public summaries default the activity UUID to null.

| Route | Scope |
|---|---|
| `GET /api/10x/gmgn/corroboration/:activity_uuid` | Public cache-only report, zero provider IO/database writes |
| `GET /api/10x/admin/gmgn/corroboration/:activity_uuid` | Authenticated private original inputs plus report |
| `POST /api/10x/admin/gmgn/corroboration/collect` | Authenticated strict `{activity_id, reason}`; existing browser/origin guards and collection controls |

```powershell
pnpm exec tsx scripts/discovery-gmgn-corroboration.ts read ACTIVITY_UUID
pnpm exec tsx scripts/discovery-gmgn-corroboration.ts collect ACTIVITY_UUID
pnpm exec tsx scripts/discovery-gmgn-corroboration.ts freeze ACTIVITY_UUID
pnpm exec tsx scripts/discovery-gmgn-corroboration.ts replay FILE
```

The [CLI](../../scripts/discovery-gmgn-corroboration.ts) uses fixed loopback transport, ignored operator credentials, no redirects and bounded streams/timeouts. Freeze verifies before writing a unique ignored private artifact without overwrite. Offline replay loads neither credentials nor network and recomputes all source/cache/report hashes. Full inputs are bounded to **6 MB** plus 100 KB report envelope. Hash integrity does not independently authenticate the original provider or RPC service.

## Completed and remaining

- [x] Exact saved-source signature scope, explicit bounded wallet-lane collector and one-attempt journal.
- [x] Cache-only raw-integer comparison, exact/aggregate distinction, missingness and no scoring adoption.
- [x] Public aggregate display, authenticated complete export and deterministic offline replay.
- [ ] Independently attest finality and certify additional supported transaction layouts and provider event aggregation where held.
- [ ] Verify historical USD and economic counterparties; establish representative controls, complete daily windows and meaningful retained acquisitions before organic volume/growth credit.
- [ ] Preregister and prospectively validate the next attention model. Preserve current v4 and restore bounded research mode before production, with approved archive/retention operations.

## Live evidence and validation

PONYX activity UUID **`64963533-bcc0-412c-9605-e82dbeb13d37`** retains its original activity report hash **`5321169426ee586148569a965a57d1a9ef0c83545daa2c3114a5471134bf5a9d`**. Before collection, both required signatures were absent from the broad RPC cache and saved wallet evidence. The frozen missing-cache report replays to **`9311c22ff149db8e2f1ccfa2d24845cbceed54964bda6e135ca7856b6346b4bd`**; it remains a separate unchanged artifact.

The first collection command coincided with the existing watchdog restarting its owned launcher after slow preview health checks during the app build. Read-only inspection confirmed no comparison attempt journal or new cache bodies. A subsequent invocation correctly held with zero calls because ordinary wallet work had advanced its pacing deadline. No pacing, quota, lease or supervisor control was reset. The later single admitted attempt started **10:12:58.992 UTC**, finished **10:13:06.859 UTC**, and recorded job **`gmgn-rpc-53792e89f28b4bc260192607fdf9505396d5d97612efb3f52127d0cf0dd9fead`** with **three actual RPC HTTP calls, two newly saved bodies and no error**. It released its wallet lease and retained the normal five-minute pacing delay. No GMGN request was made by this milestone.

The saved comparison finds **two of two reported buy events** match **two canonical instructions** for the selected signing wallet, same block second and exact raw token quantities. Both buys share one signature; the second saved signature belongs to the excluded non-trade event. No aggregate-only equality was needed. This supports the reported launch-time token movements; it does not verify the reported $105,119.62946162048 USD value, independent finality, beneficial independence, subsequent retention, daily coverage or genuine demand. Organic volume remains null, scoring effect remains none, and no wash verdict or action credit is awarded.

The private source-plus-body freeze and complete replay verify comparison report hash **`7e28b5f73386d826aeecb1861ce0f3f23414d47483811023d51bf49efd5d3e31`**. Both earlier missing-cache and new comparison artifacts replay without network, credentials or database writes; the original activity receipt/report hashes also replay unchanged. Fresh cache-only reads have their own dated cutoff/hash, separate from these frozen records.

Validation: **31 comparison/collector tests**, **55 existing GMGN integration/activity/trader tests**, **60 wallet/cache/holder/candle tests**, **101 Discovery UI tests across nineteen files**, and **eight relay/operator tests** pass. Coverage includes exact versus aggregate matching, unknown/fractional precision, wrong signer/time/quantities/decimals, failed bodies, changed hashes/scope, source age/signature bounds, pause/backoff/lease/day rollover, existing-cache immutability, per-call quotas, three-call ceiling, zero budgets, future bodies, invalid-config lease cleanup, concurrent operators, no blind retries, authenticated exports and public zero-write/zero-provider reads. Discovery typecheck, generated OpenAPI and app typecheck/build pass. Startup remains **234.1 KiB gzip across eleven chunks**; existing dependency annotation warnings remain non-fatal.

Read-only per-row digests preserve **173 original score cohorts, zero outcomes, 39 completed source receipts, 795 holder receipts, 72 wallet receipts and all 593 original RPC cache bodies**. Normal collection continues independently. Foreign keys pass; no migration, evidence rewrite, counter reset or unrelated Network/legal change is included. Local browser QA verifies the real cache counts, exact matching, non-trade exclusion and held USD/organic/scoring language; screenshot `.tmp/gmgn-rpc-corroboration-ponyx.png`. All **450 local Markdown targets across 24 documents** resolve; whitespace passes. The actual-key scan passes across **21 task files and 72 built assets**, with both secret files ignored and untracked. No deploy.

Commands: targeted `pnpm --dir discovery exec vitest run --config vitest.config.ts` for the files above; `pnpm --dir discovery exec tsc --noEmit`; `pnpm --dir app test src/discovery`; `node --test scripts/discovery-gmgn-relay.test.mjs scripts/discovery-gmgn.test.mjs`; `pnpm --dir app build`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; bounded operator read/collect/freeze/replay above; ignored read-only digest/link/secret helpers.
