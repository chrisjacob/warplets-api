# Marketaux news discovery

Marketaux is an additional discovery source for the existing narrative-news pipeline. It does not select winners from sentiment scores or relax publication checks. News still requires an allowlisted source, matching stock identity, and the existing editorial eligibility checks. Rejected earnings evidence remains in the review queue.

## Free-plan budget

The documented free allowance is 100 requests/day and 3 articles/request:
https://www.marketaux.com/pricing
https://www.marketaux.com/documentation

- 41 mapped US-listed symbols, twice per UTC day, distributed across hourly discovery jobs: 82 scheduled requests/day.
- Every network attempt reserves a D1 ledger entry atomically first. The hard cap is 90 attempts in any rolling 24 hours, including failed requests and retries. Reservations are never refunded.
- At most two retries through the existing queue. A successful response is reused if later storage fails.
- Authentication, subscription, or quota errors (401/402/403/429) pause the entire provider for 24 hours. No paid fallback.
- Each request asks for one fixed catalog symbol, matching entities, US listings, English, three grouped articles, approved source domains, and the last seven days. No pagination or automatic historical backfill spends extra credits.
- SpaceX, SK Hynix, and Tether Gold retain existing sources pending verified provider mappings. Their bStock symbols must not be treated as exchange ticker symbols.
- Seven-day request-log retention; admin spotlight diagnostics expose aggregate rolling usage and cooldown status, never credentials.

The budget covers requests through this integration. Any other use of the same account token consumes the provider's shared allowance; the ten-request margin is not a separate provider quota.

## Release and local development

Apply migration `0079_stonklet_marketaux.sql` before releasing the worker. The surrounding news pipeline also requires `0078_stonklet_news_review.sql` and its preceding news migrations. Do not bulk-apply unrelated migrations from a dirty workspace.

`MARKETAUX_API_TOKEN` is a server-only secret. Production `api` already has this secret provisioned. Enable ingestion by setting the production-only `MARKETAUX_NEWS_ENABLED` secret to `true` after release. The existing news shadow/live/off gate still applies. Setting the flag to `false` stops new Marketaux requests; RSS sources continue.

Do not put the enabled flag in shared Wrangler vars or local `.dev.vars`. Merely having the API token locally does not enable calls. The Vite local news preview continues using its saved snapshots/RSS data and never calls Marketaux. Do not run a second consumer with a separate D1 ledger against this token.

This change alone does not activate publication or bypass the seven observed days of shadow ingestion.
