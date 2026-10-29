# Alchemy wallet backfill

Updated 19 October 2026. Local preview only; production ingestion remains off.

When `ALCHEMY_API_KEY` is configured, Network retrieves Base ERC-20 balances
and native ETH from Alchemy. It uses the existing verified-wallet associations,
CAIP-19 identifiers, independent DefiLlama prices, wallet deduplication and
aggregate publication. An Alchemy failure does not trigger a Neynar fallback.
The key is read server-side from the existing local secret files and never
written to the public bundle, snapshot or logs. No account/billing settings
were changed.

## Limits

- 10,000,000 CU per UTC calendar month, hard maximum. `NETWORK_ALCHEMY_CU`
  can lower this cap, but cannot raise it above 10 million.
- 1,500,000 CU per UTC day.
- Every request reserves its full published method cost before being attempted:
  ETH balance 20 CU, token balance page 20 CU, token metadata 10 CU. Failures
  and interrupted attempts remain reserved, conservatively.
- Atomic D1 reservations prevent concurrent readers overshooting either cap.
- At most ten RPC requests per second across Network's callers.
- Existing combined source-request limits still apply (100,000/day and
  600,000/month by default), so the importer can pause before its CU cap.
- These counters cover Network. They cannot measure unrelated apps sharing
  the same Alchemy account or confirm the account's billing plan. The account
  should remain on Free; the 10M cap leaves headroom within its published 30M
  free allowance, subject to other account usage.

Alchemy's published references checked during implementation:
https://www.alchemy.com/docs/reference/compute-unit-costs
https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances

## Collection and valuation

`0099_network_alchemy.sql` adds only namespaced budget, pacing and metadata
storage, plus a partial index for priced assets. This keeps hourly quote refresh
from scanning every unpriced spam-token cache entry.

Existing non-Alchemy valuations are refreshed first, even if still recent.
Their source is changed only after a successful Alchemy read and independent
valuation; failures retain the previous value and remain queued for retry.
The queue then prioritizes unmeasured wallets, followed by earlier FIDs. Refreshes
rotate weekly. Each wallet must finish all token pages and native retrieval
before replacing a valid estimate. Repeated cursors, malformed records and the
100-page safety bound never produce a measured zero. Individual token errors
can be excluded only when the token has no accepted independent price. An
unavailable balance for a reliably priced token defers the wallet instead.

Metadata is fetched only for priced assets and cached for 30 days. Unpriced
assets need no paid metadata calls; negative price lookups cache for a day.
Token decimals from Alchemy must match the independent quote. Raw integer
balances and USD calculations retain the existing fixed-point accounting.

Shared wallets still count once globally and remain unallocated. Fully measured
per-account portfolios are needed for averages, median and top-held assignment.
Unpriced/unsupported assets are counted separately; no wealth is extrapolated.

## Local background process

Start: `node scripts/network/wallet-worker.mjs`

The helper calls the existing local importer in batches of up to 1,000 wallets,
with `--alchemy` to prevent accidental provider fallback when the key is absent.
Snapshots publish roughly every ten minutes and at batch exit. A budget stop
waits for the next UTC day; the monthly reservation still prevents any calls
until the monthly cap resets. Source throttling pauses for an hour. Caught-up
jobs check again daily, with balance retrieval still on a weekly rotation.

Ignored logs: `.tmp/network-wallet-worker.out.log` and
`.tmp/network-wallet-worker.err.log`; PID: `.tmp/network-wallet-worker.pid`.
An interrupted wallet retains its last valid value. Restarting resumes from
unmeasured or expired wallets, while CU reservations remain counted.

The first live pilot added three wallets using Alchemy. One contained thousands
of airdropped tokens, demonstrating why the 1.62M-CU full-sweep estimate was a
one-page-per-wallet baseline rather than a guarantee. Real pagination and
metadata usage are metered and capped.

## Faster local backfill â€” 19 October

Shared request allowance is 100,000/day (hard maximum); monthly combined cap
remains 600,000 by default. Alchemy can reserve 1.5M CU/day, still capped at
10M CU/month and ten RPC/s. Official Alchemy free allowance rechecked at 30M
CU/month, account-wide; Network cannot measure other applications' consumption.
Neynar was initially capped at 100,000 credits; the 22 October update below
raises that app-side limit after confirmation of the account's free allowance.

`node scripts/network/location-worker.mjs` runs the targeted retained-location
backfill using the existing ingestion lease, four paced readers (at most four
public profile calls/s), retries, budgets and snapshot publication. Only signer
profiles missing their current raw location observation enter this queue; a
matching blank observation is complete. It stops when the queue empties, backs
off on failures and waits until the next UTC day if the shared cap is exhausted.
Logs: `.tmp/network-location-worker.out.log` / `.err.log`; PID file uses the
same `network-location-worker` prefix. The normal five-minute job also helps.


## Faster local backfill (21 October 2026)

The CLI processes deduplicated batches of up to 25 wallets with four readers.
Batch and single-wallet jobs share one lease. Every read still reserves CU and
source-request allowance atomically; the shared RPC gate spaces calls by at
least 100 ms (10 requests/s), below the [Free plan's 25 requests/s](https://www.alchemy.com/pricing).
Supported methods cost at most 20 CU each. The 1.5M daily / 10M monthly CU hard
caps remain unchanged. A budget/provider failure stops new wallet starts and
waits for in-flight readers before releasing the lease. Local writes are
serialized and still yield to public reads. The extra 300 ms per-wallet sleep
is removed. Cached prices/metadata and valuation methodology are unchanged.


## Neynar address coverage (22 October 2026 Sydney)

The user confirmed the account dashboard's Free Beginner plan includes 10M
credits/month. Network's app-side Neynar cap is now 250,000 credits/month,
including existing reservations; configuration cannot exceed this Network cap.
Both ignored local settings files use 250000. The usage ledger is preserved.
The [current price list](https://docs.neynar.com/reference/compute-units) lists
one credit/FID for bulk-user lookup; Network still reserves two conservatively.

`scripts/network/association-worker.mjs` runs the existing bounded bulk-user
import locally, prioritizing missing FIDs before stale observations. It pauses
on credit, request-budget or source failures and checks again after its daily
refresh interval once caught up. Alchemy's valuation worker consumes new links;
its CU caps are unchanged. Production flags remain disabled.

## Overnight catch-up (22 October 2026 Sydney)

Local settings now allow 250,000 combined requests/day and 4M Alchemy CU/day.
Defaults stay 100,000 requests and 1.5M CU; configured daily limits cannot exceed
250,000 and 4M respectively. The existing 10M monthly CU cap, 600,000 default
monthly combined request cap, usage ledgers and 10 RPC/s gate remain unchanged.
No deployment or billing-plan changes. At the observed cost the remaining
17,561 wallets need approximately 1.35M CU, bringing monthly Network usage to
about 5.1M of the account-wide 30M free allowance. Other apps share that allowance.

## Large-wallet completion (23 October 2026)

The token scan now allows 1,000 pages of 100 records instead of 100 pages.
Every page still reserves source requests and Alchemy CU and uses the global
10 RPC/s gate. The upper bound is 100,000 records / 20,000 CU in token balance
pages per wallet, plus native balance and priced-token metadata. Duplicate tokens,
repeated cursors and malformed pages still fail closed. Truncated scans are
never saved as complete or zero-valued portfolios. Existing monthly caps and
pricing methodology are unchanged.
