# Quote ingestion recovery — 2026-09-21

Production CMC quotes stopped on September 15 at 10:48 UTC. The local monthly
counter reached 14,000, but the provider reported only 10,938 credits consumed.
The connector reserved one credit per request and never refunded explicit
zero-credit responses, including rejected symbol mappings. Failed work was
also immediately eligible for the next cron run.

The connector now reconciles reservations against reported charges before
handling provider errors. Unknown charges remain reserved. Failed mapping,
quote, and holder jobs retain their leases for 15, 5, and 60 minutes respectively.

Production quotes now refresh every 10 minutes and holders every 24 hours.
The existing 14,000-credit cap remains. The September counter was reconciled to
10,938 from the provider's key-info endpoint using a conditional update that
required the previous value to be 14,000. Historical request counts were retained.

Worker version: `eb98a417-67f8-48f4-9ef6-044a454a87a7`.
Validation: 22 focused tests, 18 Worker tests, root and app TypeScript checks,
security preflight, and Worker deployment dry run passed.

The Pages configuration mirrors the new polling settings for its next release;
production ingestion runs in the Worker, so no frontend release is required.

Production verification: CMC ingestion advanced to 10:58:09 UTC. Four requests
consumed two credits, confirming zero-credit responses are reconciled. The public
market endpoint subsequently returned `stale: false`, no delayed symbols, all
43 catalog stocks live, and all 20 launched Stonklets live.

## Intermittent Stonklet expiry warning

The five-minute ingestion interval also matched the five-minute freshness limit.
Minute-based scheduling and upstream latency therefore left a gap where requests
could encounter expired snapshots while another refresh held the lease. KV could
also serve an expired generation even after the database had newer live quotes.

Scheduled refreshes now become due two minutes before the freshness deadline
(three minutes with the current configuration). Expired or incomplete KV snapshots
are reconciled with newer database rows before attempting a refresh. The five-minute
freshness deadline and genuine-failure stale behavior are retained.

Regression validation: 20 ingestion and market tests passed, including refresh
ahead of expiry and newer database snapshots behind an old KV cache. Root/app
TypeScript checks, production build, performance budget, and preflight passed.

Worker: `2e83bf2f-bfe2-47ee-8b61-af0afa77dffc`.
Pages: `4f5a4af8.10x-app.pages.dev`.
At 11:21:21 UTC, all 20 database snapshots were live with timestamp 11:20:54 UTC,
and the public board returned `stale: false` and no delayed symbols.
