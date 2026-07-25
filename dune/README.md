# 10X Warplets Dune setup

This package contains the versioned DuneSQL feeds used to enrich Stats after
the analytics reset at **2026-07-02 00:00:00 UTC**.

Dune is supplementary. OpenSea ingestion and D1 remain the live sources, and
Stats must keep serving last-known D1 data when Dune is unconfigured, delayed,
over budget, or unavailable.

## Source boundaries

| Responsibility | Authoritative source |
| --- | --- |
| Current listings, offers, floor, and OpenSea aggregates | OpenSea plus D1 snapshots |
| Current token owner and holder leaderboard | D1 `warplet_market_state` and `holder_leaderboard` |
| July 2 owner cohort | D1 `analytics_owner_baseline` |
| Cross-market post-reset sales | Dune [`nft.trades`](https://docs.dune.com/data-catalog/curated/nft-trades/evm/nft-trades), normalized into D1 |
| Post-reset transfers | Dune [`base.logs`](https://docs.dune.com/data-catalog/evm/base/raw/logs) ERC-721 events, normalized into D1 |
| Farcaster profiles and Top 100 Friends | Existing Neynar/D1 identity cache |
| OpenSea lifetime reset baseline | Verified OpenSea evidence, never Dune |

OpenSea lifetime totals and Dune onchain totals measure different things. A
Dune result must never populate or overwrite the OpenSea baseline fields.

## Query inventory

There are three deliberately separate query classes (five saved queries in
total).

| Query | Purpose | Schedule |
| --- | --- | --- |
| `warplets_sales_backfill_v1.sql` | Full history from the July 2 epoch | One-time/manual only |
| `warplets_transfers_backfill_v1.sql` | Full history from the July 2 epoch | One-time/manual only |
| `warplets_sales_incremental_v1.sql` | Bounded 48-hour sales window | Daily automation |
| `warplets_transfers_incremental_v1.sql` | Bounded 48-hour transfer window | Daily automation |
| `validate_known_bulk_trade_v1.sql` | Verify Dune bundle semantics | One-time/manual only |

The incremental window ends two hours before execution and begins 48 hours
before that coverage end. The overlap makes a daily schedule tolerant of
curated-table indexing delays. D1 canonical-key upserts remove repeats between
runs.

`DUNE_TRADES_QUERY_ID` and `DUNE_TRANSFERS_QUERY_ID` must always reference the
two **incremental** saved queries. The optional
`DUNE_TRADES_BACKFILL_QUERY_ID` and `DUNE_TRANSFERS_BACKFILL_QUERY_ID` variables
reference the manual bootstrap queries; backfills are never scheduled.

## Stable result contracts

Backfill and incremental variants of a feed have exactly the same column
contract and schema version:

- sales: `warplets_dune_sales_v1`;
- transfers: `warplets_dune_transfers_v1`.

Every result contains:

- one `row_type = 'coverage'` row, even when the window has zero events;
- zero or more `row_type = 'data'` rows;
- a non-null matching `schema_version` on every row;
- UTC ISO-8601 `coverage_start` and `coverage_end` on every row.
- chain `8453`, slug `10xwarplets`, and the exact lowercase contract address
  on both coverage and data rows.

Ingestion must first require the expected `schema_version`, then branch on
`row_type`. Only `data` rows are event records. The coverage row advances
ingestion coverage without inventing an event for an empty window. Reject the
whole page/result if:

- the coverage row is absent or duplicated;
- a row has an unknown or missing schema version;
- a data row's timestamp falls outside the declared half-open interval
  `[coverage_start, coverage_end)`;
- the Dune result is marked partial.

### Sales data fields

The sales contract additionally includes:

| Field | Contract |
| --- | --- |
| `canonical_key` | `8453:<lowercase 0x tx hash>:<token id>` |
| `token_id` | Integer from 1 through 10,000 |
| `transaction_hash` | Lowercase, 0x-prefixed |
| `event_id` | Dune `unique_trade_id` |
| `buyer_wallet` / `seller_wallet` | Lowercase, 0x-prefixed or null |
| `marketplace` | Dune project name |
| `price_raw` | JSON-safe decimal string |
| `payment_decimals` | Token metadata value; only ETH/WETH may fall back to 18 |
| `payment_symbol` / `payment_address` | Payment asset |
| `currency_symbol` | Compatibility alias of `payment_symbol` |
| `price_eth` | Present only for ETH/WETH |
| `price_usd` | Dune value at execution time, when available |
| `sold_at` | UTC ISO-8601 event time |
| `source` | `dune:nft.trades:v1` |

Unknown non-ETH token decimals remain null. Treating every missing metadata row
as 18 decimals silently corrupts prices and is forbidden.

Dune exposes both `amount_original` and `number_of_items`. Do not divide a
price solely because `number_of_items > 1`; validate the marketplace semantics
with the known bulk query and its OpenSea receipt first.

### Transfer data fields

The transfer contract additionally includes:

| Field | Contract |
| --- | --- |
| `canonical_key` | `8453:<lowercase 0x tx hash>:<event index>:<token id>` |
| `token_id` | Integer from 1 through 10,000 |
| `transaction_hash` | Lowercase, 0x-prefixed |
| `event_index` | Log position in the transaction |
| `block_number` | JSON-safe decimal string |
| `from_wallet` / `to_wallet` / `executed_by` | Lowercase, 0x-prefixed or null |
| `amount` | JSON-safe decimal string; normally `1` |
| `event_id` | Dune `unique_transfer_id` |
| `transferred_at` | UTC ISO-8601 event time |
| `source` | `dune:nft.transfers:v1` compatibility label over filtered `base.logs` |

Apply transfers in `(block_number, event_index)` order. A timestamp alone is
not sufficient when a token moves more than once in one transaction.

## Create and validate the saved queries

Create the queries in Dune's web editor so ownership and cost controls are
explicit.

1. Create/select the Dune team that owns Warplets analytics.
2. Keep the plan on Free and set extra paid credits to **0**.
3. Set Dune's maximum cost per query execution to **20 credits**.
4. Create and manually run the known bulk validation query.
5. Confirm transaction
   `0xad4aaf07b5c2e3f57403d518a5b95fe0d0b5a248855518e7caed39b486add3c8`
   has correctly priced separate rows for Warplets `#4512` and `#9234`.
6. Create the two one-time backfill queries, run them on the Small engine, and
   import/validate their full results once.
7. Do not schedule the backfills.
8. Create the two incremental queries, run each manually, and verify the
   coverage row plus its observed credit and export cost.
9. Save the incremental query IDs as `DUNE_TRADES_QUERY_ID` and
   `DUNE_TRANSFERS_QUERY_ID`.
10. Keep all four feed queries parameter-free. The fixed epoch and window
    cannot then be widened by a runtime caller.

The queries include chain, time-partition, exact-contract, and token-range
filters. Incremental queries also derive the `block_month` lower bound from
their 48-hour window so daily executions do not rescan full history.

## Connect the app

Migration `0041_dune_analytics.sql` adds execution state, transfer storage,
cross-source sale provenance, daily summaries, marketplace summaries, and
optional holder activity fields. Migration `0042_dune_ingest_hardening.sql`
adds billing-period usage snapshots, per-source leases, and execution staging
so incomplete result pages never become public Stats data.

Configure the same non-secret query IDs and enablement values on both
`wrangler.toml` (scheduled API Worker) and `app/wrangler.toml` (Stats/UI
status):

```text
DUNE_ENABLED=1
DUNE_EXECUTE_ENABLED=0
DUNE_TRADES_QUERY_ID=<incremental sales query ID>
DUNE_TRANSFERS_QUERY_ID=<incremental transfers query ID>
DUNE_TRADES_BACKFILL_QUERY_ID=<one-time sales backfill query ID>
DUNE_TRANSFERS_BACKFILL_QUERY_ID=<one-time transfers backfill query ID>
DUNE_EXECUTION_INTERVAL_HOURS=24
DUNE_RESULTS_PAGE_SIZE=1000
DUNE_MAX_RESULT_PAGES=8
DUNE_INDEXING_LAG_HOURS=2
DUNE_MONTHLY_CREDIT_BUDGET=1500
DUNE_MAX_CREDITS_PER_EXECUTION=20
```

The root API Worker owns the production Cron Trigger. Store its API secret
interactively:

```powershell
pnpm exec wrangler secret put DUNE_API_KEY
```

If the Pages admin ingestion endpoint or optional webhook will also be used,
set the same Dune API key and a separate webhook secret on the Pages project:

```powershell
pnpm --dir app exec wrangler secret put DUNE_API_KEY
pnpm --dir app exec wrangler secret put DUNE_WEBHOOK_SECRET
```

For local work, put secrets in ignored `.dev.vars` / `app/.dev.vars`. Never
commit them. Pages Functions do not receive this project's Cron Trigger;
`src/index.ts` deliberately advances Dune from the already-scheduled root API
Worker.

Bootstrap the two full-history results through the authenticated admin route:

```text
POST /api/admin/dune-analytics?force=1&backfill=1
```

Use `execute=1` only if the manual saved query has not already run; it remains
subject to the same usage and per-execution guards. The local endpoint accepts
only a literal loopback/localhost host. A public `search-local.*` tunnel must
use the authenticated admin route.

Keep `DUNE_EXECUTE_ENABLED=0` until backfills, incrementals, schema validation,
known-bulk validation, and usage guarding all pass.

With execution disabled, scheduled ingestion may read an already-completed
saved-query result but cannot start a credit-consuming execution. Ordinary
`/api/stats/*` requests only read D1 and never call Dune.

## Free-plan credit guard

Dune's Free plan currently includes monthly credits, but execution and result
export both consume credits. The local execution ledger is useful for
diagnostics, but it is not an account-wide budget guard: manual Dune runs,
dashboard refreshes, or other API clients can spend the same account credits.

Immediately before **every** automated execute request, call Dune's no-charge
[Usage API](https://docs.dune.com/api-reference/usage/endpoint/get-usage):

```http
POST https://api.dune.com/api/v1/usage
X-DUNE-API-KEY: <server secret>
Content-Type: application/json

{}
```

Read `credits_used` from the current entry in `billing_periods` (accept
`billingPeriods` as a compatibility alias). The executor must fail closed and
start no query when:

- the Usage API cannot be authenticated, fetched, or parsed;
- there is no current billing-period record;
- `credits_used >= DUNE_MONTHLY_CREDIT_BUDGET`;
- the previous execution exceeded `DUNE_MAX_CREDITS_PER_EXECUTION`.

Recheck Usage after completed-result export because export itself costs
credits. `scripts/check-dune-usage.ps1` is a manual/CI preflight implementing
the same account-level check. It is not a substitute for the atomic
server-side pre-execution check.

Recommended Free-only operating limits:

- paid overage remains disabled in Dune account settings;
- maximum 20 credits for one execution;
- automated stop at 1,500 account credits per billing period;
- one sales and one transfers execution at most once daily;
- run sequentially rather than concurrently;
- Small engine only after measured manual validation;
- never execute because a user opens or refreshes Stats.

Two executions at the 20-credit ceiling are not a complete monthly estimate
because result exports also cost credits. Treat the Usage API as the budget
authority, not a theoretical calculation.

## Execution lifecycle

1. Call `POST /api/v1/usage` and pass the account-level guard.
2. Start at most one due saved query with
   `POST /api/v1/query/{query_id}/execute` using the Small engine.
3. Persist its execution ID; do not hold one Cloudflare request open.
4. On a later cron, call `GET /api/v1/execution/{id}/status`.
5. When complete, require the exact query ID, schema, envelope, coverage row,
   and declared total row count.
6. Fetch pages in bounded batches, rejecting any partial or invalid result.
7. Bulk-stage validated `row_type = 'data'` records by execution ID.
8. Promote the stage only after the final page and row count validate.
9. Persist the explicit coverage window, including for an empty result.
10. Recheck the Usage API after export and persist account usage.

Status and Usage API checks do not consume credits. Failed query executions can
still consume credits, so failure does not bypass the guard.

## Webhook limitation

Dune currently permits
[one webhook on the Free plan](https://docs.dune.com/api-reference/overview/billing).
If that single slot is already used, do not upgrade or replace another
integration just for Stats; use the existing Cloudflare cron polling path.
Webhooks are an optional latency optimization, never the ingestion guarantee.

Dune documents no signed webhook envelope. The endpoint prefers
`Authorization: Bearer ...` or `X-Dune-Webhook-Secret`; Dune's URL-only
scheduler can use `POST /api/webhooks/dune?token=...` as a compatibility
fallback. Treat that URL as a secret, rotate it if access logs expose it,
validate the nested `query_result.query_id`, and fetch the execution from Dune
with the server API key. Never trust event rows supplied in the notification.

## Validation before automation

For each feed verify:

- the result contains exactly one coverage row;
- every row uses the expected schema version and declared coverage;
- every data timestamp is inside its coverage interval and after the epoch;
- chain is `8453`, collection is `10xwarplets`, and token is 1-10,000;
- canonical keys are unique within the result;
- addresses are null or match `^0x[0-9a-f]{40}$`;
- sales have transaction hash, buyer, seller, marketplace, and positive price;
- non-ETH/WETH missing token metadata does not receive 18 decimals;
- transfers have a transaction hash, event index, amount `1`, and an endpoint;
- multi-Warplet transfers retain `(block_number, event_index)` ordering;
- the known bulk transaction matches its receipt;
- sampled latest owners agree with Base RPC and D1.

Also execute an incremental query over a quiet window if available and prove
its coverage row advances D1 freshness with no event rows. This is the
zero-activity path that prevents Stats from appearing permanently stale.

A mismatch marks only Dune stale. It must not erase OpenSea/D1 records or make
Stats unavailable.

## Farcaster enrichment

Do not join Dune's community Farcaster table into these critical feeds. Ingest
wallet activity first, then join in D1 to the existing Neynar-backed
`wallet_farcaster_links` table. This keeps identity enrichment optional and
supports buyer/seller avatars and Top 100 Friend highlighting when Dune's
community tables lag.

## Versioning

The filename and `schema_version` are the ingestion contract. For a breaking
change:

1. copy SQL to `_v2.sql`;
2. change `schema_version`;
3. create a new saved query and query ID;
4. accept both versions during transition;
5. run v2's full backfill once;
6. switch the incremental IDs only after validation;
7. disable v1 last.

This keeps a Dune rollback independent of live OpenSea/D1 Stats paths.
