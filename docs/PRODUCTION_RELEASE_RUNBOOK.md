# Production release runbook

## Scheduler ownership

The root `api` Worker owns every production Cron Trigger. Pages Functions do not
receive scheduled events. Its one-minute trigger runs independent, failure-isolated
jobs for legacy OpenSea sync, normalized OpenSea ingestion, Dune analytics,
Warpmoji, Warplets notifications, email identity sync, and email onboarding.

Normalized OpenSea ingestion is additionally freshness-gated by
`OPENSEA_MARKET_INGEST_INTERVAL_MINUTES` and protected by the persistent D1
`market_ingest:lease`.

## Pages deployment ownership

The `deploy-app` job in `.github/workflows/deploy.yml` is the sole owner of
normal production deployments for the `10x-app` Pages project. A push to
`main` runs the production checks and deploys that exact commit.

Do not follow a successful `git push` with `pnpm --dir app deploy:prod`; that
creates a second Pages deployment for the same commit. The manual command is
reserved for break-glass recovery when the GitHub Actions deployment is
unavailable or has failed, and its deployment URL and source commit must be
recorded in the release notes.

## Safe bootstrap release

The initial production release must keep these root Worker variables:

```text
OPENSEA_MARKET_INGEST_ENABLED=false
OPENSEA_MARKET_INGEST_INTERVAL_MINUTES=10
DUNE_ENABLED=1
DUNE_EXECUTE_ENABLED=0
```

Pages may use `DUNE_EXECUTE_ENABLED=1` because its Dune endpoint requires an
authenticated admin scope and is used for the supervised bootstrap only.

Run normalized OpenSea bootstrap through the authenticated endpoint:

```text
POST /api/admin/opensea-market-refresh?bootstrap=1
```

Until all sale, transfer, listing, and offer cursors have completed, activity is
stored with notifications suppressed and marked handled. Once all four streams
have an `events_after:*` value and no `events_cursor:*`, the persistent
`market_ingest:bootstrap_complete` marker is written. Repeat the request until the
response reports `bootstrap.complete=true`.

## Activation release

After supervised OpenSea and Dune bootstrap validation, a separate reviewed
release may change only the root Worker variables:

```text
OPENSEA_MARKET_INGEST_ENABLED=true
DUNE_EXECUTE_ENABLED=1
```

Keep the 1,500 monthly-credit and 20 per-execution Dune limits. Monitor at least
two OpenSea intervals and one notification-processing cycle before enabling the
Resend webhook.

Farcaster association, Base notifications, Resend onboarding, Warpmoji pilot, and
TrustConnect are independent launch gates and remain disabled until their manual
production checks pass.
