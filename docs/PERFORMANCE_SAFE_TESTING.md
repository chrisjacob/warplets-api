# Performance Safe Testing Checklist

Use this checklist to validate performance/cost hardening **without** triggering real-world social spam or production junk data.

## Rules

- Never run high-volume tests against production endpoints that trigger:
  - cast posting
  - tweet intents
  - notification fan-out
  - resend email sends
- Prefer local/dev hosts and test FIDs only.
- Keep test writes bounded and reversible.

## Recommended test targets

- Read-only:
  - `GET /api/warplet-status?fid=<test-fid>`
  - `GET /api/actions?appSlug=drop`
  - `GET /api/recent-buys`
- Bounded write checks:
  - `POST /api/actions-verify` (small fixed request set)
  - `POST /api/actions-complete` with test action/session only
  - `POST /api/email/subscribe` with controlled test emails

## Validation flow (safe)

1. **Latency baseline (dev/local)**
   - Capture 10-20 sequential calls per read endpoint.
   - Record min/p50/p95 response times.

2. **Cache behavior checks**
   - First request should be slower (cache fill), subsequent faster (cache hit).
   - Confirm no user-visible payload shape changes.

3. **Rate-limit and idempotency checks**
   - Repeat same payload quickly and confirm dedup/rate-limit responses.
   - Confirm no duplicate rows inserted.

4. **SQL query plan sanity**
   - Run `EXPLAIN QUERY PLAN` for hot-path queries.
   - Ensure new indexes are selected for relevant filters/order clauses.

5. **Data cleanup**
   - Remove test-only rows/emails/FIDs created during validation.
   - Re-check app screens for expected non-test behavior.

## Queue policy (budget guard)

Only adopt Cloudflare Queues when all conditions are true:

1. Expected monthly cost fits budget target.
2. The queued workload is non-user-blocking.
3. Measured D1/KV-only optimization is insufficient.
4. Queue introduction does not change user-visible behavior.
