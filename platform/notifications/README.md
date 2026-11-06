# Local notification consent and delivery

The wallet must opt into the local inbox and select one or more available topics. The service never accepts an email address, callback URL, push token or externally supplied notification text. A notice template is derived from an existing live fixture market, an open Genesis ballot for which the wallet is eligible, or the wallet's recorded and vesting fixture Earn award. No HTTP write route can enqueue or dispatch notices.

The Node and local Worker APIs expose `GET /api/v1/notifications/capabilities`, authenticated `GET/POST /api/v1/notifications/subscriptions`, and authenticated `GET /api/v1/notifications/inbox`. Consent writes require a matching Origin, Idempotency-Key, current preference revision, explicit topics and the current terms value. A revision change fences pending deliveries. Revoking clears local delivered messages and cancels unfinished work, including leases. No provider call, wallet signature request or paid transaction occurs.

The offline CLI accepts `node platform/notifications/cli.mjs LOCAL_DB enqueue|lease|finish|drain|reconcile|purge FIXTURE.json`. Maximums are three unique events per wallet/UTC day, twenty leased jobs per call, five attempts, one-hour retry backoff, and a 30-second worker lease. Reconcile an ambiguous result against the local receipt before attempting delivery again. A periodic bounded purge removes expired content after seven days. Accepted consent request keys are retained without a time-based purge so exact replay and conflicting-key detection survive revocation and content expiry. Replaying an old enable returns the current preference; it does not re-enable a revoked wallet. Private recovery preserves notice ready times, converts leased notices to unknown, and clears old lease tokens before any explicit reconciliation. Operator pause and budget limits suppress optional notice work while opt-out remains available.

The October notification implementation supplied the per-scope opt-out, event uniqueness, daily cap, cancellable outbox, lease fencing, unknown-outcome and bounded retry patterns. This adaptation uses wallet sessions and a local receipt transaction. The old FID-bound webhook/token transport stays outside this pilot; a verified provider adapter and explicit consent would be required for real delivery. [October reference implementation](https://github.com/chrisjacob/warplets-api/blob/6dc1b72b41fd1fb7f35f9db26ffef8285199c5ef/meme/src/worker/notifications.ts)


## Guarded local worker CLI

`node platform/notifications/cli.mjs LOCAL_DB VERB FIXTURE.json` reads at most16KiB of local JSON and uses the actual execution clock. The fixture cannot supply a clock, message body, callback, email address or push token. Results identify local-inbox mode and keep external transport and financial execution false.

Every fixture names `operatorId`. New enqueue, lease and delivery work requires that existing identity's enabled `notification-work` database scope; the CLI never creates grants. Accepted delivery replay and mandatory reconciliation/retention remain available without optional-work authorization. A restored or expired lease never becomes permission to send again.

| Verb | Additional JSON fields |
| --- | --- |
| `enqueue` | `requestKey`, `input:{wallet,topic,subject}`; launch/voting subject is an existing market/ballot ID; rewards subject is `{tokenId,day}` |
| `lease` | Optional `limit` from1 to20 |
| `finish` | `id`, `lease`, optional `outcome` (`delivered`, `retryable`, `unknown`) |
| `drain` | Optional `limit` from1 to20; explicitly leases and finishes local inbox work |
| `reconcile` | `id`; resolves existing local receipt before any retry |
| `purge` | Optional `limit` from1 to100 |

The new worker preserves historical event IDs and the three-per-wallet UTC daily cap. Exact source facts, consent revision, SQL execution time and operating controls fence enqueue. Guarded delivery commits the inbox effect and durable receipt together. A delivered receipt survives revocation and content retention; replay never recreates the removed inbox. Missing retained event history returns a hold rather than a new enqueue.

## Bounded maintenance and restore

`createNotificationRetentionHandler` in `jobs/notification-retention-handler.mjs` plugs into `createHandlerRegistry` under the existing `retention-maintenance` type. It schedules no work itself and owns no notice delivery lease. Its exact payload is `{kind:'notification-retention-v1',runKey,limit}`; use `retentionBusinessKey` and `retentionSourceKey` from `notifications/retention-plan.mjs` when enqueueing a private B03 job. The actual execution clock selects content expired at least seven days ago. Each invocation removes at most100 outbox rows with cascading inbox cleanup, verifies the job/execution fence, checkpoints confirmed page counts and retries a full page. An unknown acknowledgement remains unresolved; no cumulative deletion total is invented.

Consent identities, guarded command receipts and financial/claim artifacts are not retention targets. Private restore retains ready times, changes leased notices to unknown, clears old tokens and revokes authentication. Tests restore genuine guarded consent, enqueue and delivery histories into a fresh target and prove old opt-in/delivery replays cannot recreate a revoked inbox.

## Reporting and acceptance

The private operator console's read-only readiness panel reports timestamped local observations, charged provider admissions separately from committed effects, and held/unknown work. Unverified provider-call totals and external costs remain unknown. Per-check evidence references identify local observations, not production custody, physical-wallet or launch approvals.

Focused acceptance includes `notifications/consent*.test.mjs`, `storage/notification-*.test.mjs`, `jobs/notification-retention-handler.test.mjs` and corresponding local D1 tests. `site/tests/notifications-runtime-qa.mjs` exercises real compiled React, generated local message authentication and the guarded worker at360/390/768/1440px. Detailed observations and limits are retained under `platform/validation/runs/2026-11-06-overnight/B13-*.json`.
