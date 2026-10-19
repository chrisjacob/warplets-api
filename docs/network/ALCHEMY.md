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
- At most four RPC requests per second across Network's callers.
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

## Faster local backfill — 19 October

Shared request allowance is 100,000/day (hard maximum); monthly combined cap
remains 600,000 by default. Alchemy can reserve 1.5M CU/day, still capped at
10M CU/month and four RPC/s. Official Alchemy free allowance rechecked at 30M
CU/month, account-wide; Network cannot measure other applications' consumption.
Neynar remains at the existing 100,000-credit cap. No billing-plan changes.

`node scripts/network/location-worker.mjs` runs the targeted retained-location
backfill using the existing ingestion lease, four paced readers (at most four
public profile calls/s), retries, budgets and snapshot publication. Only signer
profiles missing their current raw location observation enter this queue; a
matching blank observation is complete. It stops when the queue empties, backs
off on failures and waits until the next UTC day if the shared cap is exhausted.
Logs: `.tmp/network-location-worker.out.log` / `.err.log`; PID file uses the
same `network-location-worker` prefix. The normal five-minute job also helps.
