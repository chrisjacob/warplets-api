# Isolate market-pool validation and retain bounded replay diagnostics

Implemented 21 October 2026 (Australia/Sydney), following PRD §§4.3–4.5 (canonical market identity, enrichment, source confidence and shared cached refresh), 12.1 (bounded D1 state) and 17.1 (discovery evidence). Local only; no deployment, spending or eligibility-policy activation.

## Problem and resulting behavior

The collector had intermittently reported `market_schema_invalid`. The earlier failed response was not retained, so its exact offending field cannot be established retrospectively. Inspection did establish that parsing every returned pair with one strict array schema, or finding one duplicate/identity mismatch, discarded all requested quotes. A malformed unrelated pool could therefore prevent valid canonical pools from refreshing.

The normal DEX Screener turn now validates each requested exact Solana pool independently. An identified unrelated pool or other chain is ignored without being substituted. A requested pool must still pass the original full pair schema, mint identity and **WSOL** quote identity. Multiple records for the same requested pool reject that target, even if one record looks valid. Missing pools remain `not_reported`; malformed or mismatched targets remain `rejected`. Neither refreshes an old quote or its timestamp. FDV is still separate from reported market cap, invalid numeric values stay unknown and provider publication time remains unknown.

Unassignable record identities could conceal a conflicting target, so they hold **the whole batch**. Invalid outer JSON/envelopes, oversized responses and HTTP/rate-limit failures also remain batch failures. The [provider reference](https://docs.dexscreener.com/api/reference) includes nullable quote-token addresses; a null address does not establish the required WSOL identity and remains rejected for a target. No permissive fallback, alternative pool, quote conversion or new eligibility evidence was introduced.

Accepted quotes from a partial batch can be published while rejected/missing targets keep their previous observations. A partial response remains a visible `market_batch_partial` issue. No usable quotes preserves the prior success time, reports `market_batch_no_usable_quotes` and waits five minutes. Ordinary successful/partial cadence remains three minutes; HTTP backoff and all existing daily allowances remain. Cycle `updated` counts validated quotes, not necessarily changed candidate rows: a newer concurrent snapshot can already supersede a valid response.

## Owned atomic publication

Local migration `0036_market_batch_diagnostics.sql` adds a unique market lease owner/commit identity. Ownership, pause and lease time are checked before source reservation and again inside publication. Live turns check the database clock; isolated tests can inject an observation clock. An expired or replaced owner cannot publish quotes, history, attempt markers or diagnostics, or clear another owner's state. Pausing does not magically cancel an already issued HTTP request; it blocks publication of that response.

The first statement in the [D1 transaction batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) conditionally claims publication. Candidate/lead snapshots, market history, attempt markers, control state and diagnostic slots depend on that claim and commit together. Diagnostic write failure rolls the whole publication back. New candidate quotes cannot overwrite a more recent market timestamp. Storage failures now report `market_persistence_unavailable` separately from provider schema failures. Immutable research captures and old election replay remain unchanged.

## Diagnostic bounds, replay and access

- Response stream: unchanged **1,000,000-byte** cap; at most **900** returned pairs and **30** distinct requested mints/pools. Invalid/duplicate request identities fail before source reservation.
- Versioned `dex-market-input-v1` freezes observation time, requested identities and the complete parsed response. Normalized inputs are capped at **1,020,000 UTF-8 bytes**; the complete record at **1,100,000 bytes**. These are normalized JSON hashes, not HTTP wire hashes or provider signatures.
- `dex-market-report-v1` records per-target decisions, bounded schema field paths, accepted/rejected/missing counts and ignored/unscoped counts. Replaying recomputes all decisions and checks input, report and record hashes, with zero provider requests.
- Exactly two mutable cache slots are possible: **latest response** and **latest incomplete response**. A subsequent success keeps the previous issue sample. These slots are explicitly replaceable diagnostics, not an append-only market archive; old market history, proofs, cohorts and frozen rehearsals are not deleted or rewritten.
- Public status returns hash-checked report summaries without raw response inputs. Data status distinguishes the latest response from a historical issue and explains all held/stale cases. Full inputs and complete replay require the existing operator token and browser-origin controls at `GET /api/10x/admin/market/batches/{latest|latest_issue}`.
- Reading status or replay makes zero provider requests. The existing automatic collector still reserves exactly one market request per batch, within its unchanged free allowance; no new schedule, environment variable, provider or paid service was added. This local exercise does not certify future remote CPU/storage/redistribution allowances.

## Local receipts

Migration 0036 was applied only to the preserved Discovery `.wrangler/local` store using pinned Wrangler 4.126.0. The first retained **normal scheduled** response at **2026-10-21T00:47:51.409Z** requested and validated **30/30** canonical pool quotes, with zero rejected/missing/unscoped records. Its normalized inputs were **32,060 bytes**:

- Input hash: `2e730e13bd17e111f57b4efa0b85f744c6f4144bc92202777006760d9702cca7`.
- Record hash: `9babc8d7ff3f083712ecf1c3cd6f9a80b510d5380d99b146d88d84c91f188cb6`.
- Authenticated server replay and independent local replay both verified; unauthenticated raw access returned 401. No extra provider request was made by verification. Malformed/ambiguous adversarial cases use isolated synthetic fixtures.

A later **normal scheduled partial response**, at **2026-10-21T00:51:51.396Z**, validated **29/30** quotes. The canonical pool for `944fTeZPkMwdUp6yWmuk9Q9uUt44MEuerY3Efjfhpump` was not reported, and one unrelated returned pair was ignored. The missing target received no replacement quote or timestamp; `market_batch_partial` stayed visible. Both cache slots replayed this exact decision with zero source calls. Inputs were **30,327 bytes**, input hash `f0c4e2db0564997d24ba4d26dec5d022875fb1ba437f36f8b18cf46c92308a3a`, record hash `321d4c4c2aaf47e15a163e7d96e0a7bef6ae82f3902f6c73adf6a1b9555475ee`.

The previous lifecycle milestone completed its initial drain through ordinary maintenance: **442 retained / 248 active / 194 expired**, without removing evidence or changing the 500-input guard. By **00:52:39Z**, one ordinary new candidate brought inventory to **443 retained / 249 active / 194 expired**; coverage had 73 verified recent creations, ten fresh market-floor passes and eight pre-wallet holder-gate passes, but **0/10 eligible**. The frozen daily rehearsal still replays all **442** original inputs (1,637,981 bytes), and two older manual rehearsals also replayed unchanged. The watchdog was fresh and recommended no restart; holder/wallet source failures remained visible. Kimchi remained scanning with seven intake reservations, one retained signature page and no certified migration/candidate at the checkpoint.

Read-only verification (reads the existing operator token privately; prints sanitized results):

```powershell
node node_modules/tsx/dist/cli.mjs scripts/check-discovery-market-batches.ts
```

## Validation and next work

The 18 new isolated tests cover target-only schema/identity failures, unrelated/foreign pools, ambiguous duplicates, globally unassignable identities, unknown numeric/FDV-only metrics, row/pair/byte limits, corrupted records, guarded partial publication, retained issue samples, private cached replay, all-held freshness, pause/replacement/database-clock lease expiry, concurrent newer quotes, diagnostic-write rollback and HTTP backoff. UI checks cover partial gaps, historical-versus-current status and the pre-first-response state. Browser QA confirmed the real 30/30 summary, validation rules, bounded retention and zero-provider-read notice on the existing preview.

The final fixed-code full run passed **768 Discovery tests / 49 files**; **63 UI tests / 11 files**, Discovery and app typechecks, app build and local security checks also passed. Home startup remains **234.1 KiB gzip / 11 chunks**, below the unchanged 250 KiB budget. An earlier run overlapped an error-classification assertion edit and was discarded; the complete rerun passed after code changes stopped. OpenAPI now documents 90 paths, including the protected replay route. Browser QA also expanded the real missing-pool row and verified its input checksum; the ignored local screenshot is `.tmp/market-batch-coverage.png`. `git diff --check` passed. No deployment occurred.

Next: use retained failures to certify additional supported source paths with real adversarial evidence; improve complete current holder/wallet/funding coverage and exact Kimchi intake within the existing quotas. Non-WSOL certification, original/copycat attribution, independent historical price/organic-volume verification, unknown-date inventory growth, long-term archival and the ten-token target remain open. Existing economics, identity, financial-execution and release gates remain intact.
