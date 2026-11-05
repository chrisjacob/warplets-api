# Local operational controls

These controls govern new work in the Node validation application. They cannot change a deployed program. A public read-only status is available at `GET /api/v1/operations/status`. Founder changes use `node platform/operations/cli.mjs DB change|meter|reserve|settle|status INPUT.json` on the local machine.

- `change` records a scope, pause/resume, previous revision, millisecond timestamp, operator, reason, evidence reference and idempotency key. Stale revisions fail. Claims, withdrawals, harvest and already accepted reconciliation/recovery are outside the changeable scope list.
- `meter` records sourced provider evidence. The latest `new-monthly-usd` figure per provider is its incremental recurring commitment in micro-USD and carries over until changed. Use zero with evidence to record cancellation. `daily-provider-units` is a cumulative daily consumption count with a quoted quota and resets each UTC day. Exclude separately reserved optional charges to avoid double counting.
- At 80%, optional market refresh and optional image work throttle. At the combined US$5 monthly limit or a measured provider quota limit, all new controlled work holds. This applies independently of the advisory 50% runway guideline. Controllers preserve replay of existing Earn and collection operations, public/private reads, recoveries and financial entitlements.
- `reserve` atomically checks an optional operation against the remaining monthly ceiling. `settle` records the actual charge exactly once and releases unused headroom; zero records a cancelled unused reservation. An actual overrun is recorded even when it exceeds its reservation. This is a local cost ledger, not a payment system.

Settlement accepts the observed `now` timestamp. Pending commitments continue to reserve headroom across a UTC month boundary, and a completed charge counts in its actual settlement month. Historical rows created before the settlement-time migration retain their original timestamp as the only available evidence.

## Configuration evidence

New scope changes, staffing settings, onboarding action schedules, pinned pricing sources and issuer grants/revocations append a digest-linked configuration event within the same transaction as the change. Run the CLI with `audit` and a fixture containing optional `pinnedHead` to verify the sequence, or `checkpoint` with optional `pinnedDigest` to fingerprint current configuration. The checkpoint includes older pre-audit configuration rows without exporting operator names or evidence notes. Pin the returned digest independently.

Database triggers prevent accidental edits/deletions to the chain. A machine administrator can still replace an entire local database, so the independently stored checkpoint is necessary for later verification. Historical events, signed receipts and finalized rewards remain immutable when an action or issuer is disabled.
