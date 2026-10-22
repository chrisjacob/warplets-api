# Focused wallet-event follow-up

23 October 2026, Australia/Sydney. Continues [163](163-shortlist-trader-participation.md) with the existing [79 event validator](79-gmgn-wallet-activity.md). The integration is implemented; accepted live event coverage remains outstanding. No deploy.

## Delivered

- [x] Select one fresh, non-adverse, DEX-checked Solana attention lead with a fresh saved trader sample. Use the existing deterministic largest-positive-complete-regular-wallet-flow rule, with address tie-breaking. Do not skip a newer empty trader sample to choose an older favorable one. Prefer unattempted leads, then the oldest attempt, preserving queue rank for ties.
- [x] Request one token-filtered GMGN wallet-activity page, at most20 events, per UTC hour total. Fixed chain, wallet, mint and page size; no cursor, extra type filter, pagination or arbitrary URL. The existing controller rechecks source hash, wallet, mint and source age before admission. No new selection bypass or financial endpoint.
- [x] Add authenticated `/api/10x/admin/discovery/attention/activity`, operator command `node scripts/discovery-attention.mjs activity`, and local timer admission after trader sampling. A deterministic hourly UUID prevents concurrent/failed/empty repeat attempts. Production cron remains unchanged.
- [x] Replay activity and its original selection-source receipt together. Verify request/body/receipt/report hashes, permission, chronology and deterministic wallet selection through the original replay verifier. The public queue exposes aggregates, never wallet addresses, signatures or raw events.
- [x] Cached UI shows dated trade/non-trade counts, pagination limits, reported trade times, missing/unusable/signed costs, repeated exact same-side sizes and reported both-side transactions. Unknowns remain unknown. Failed attempts show sanitized errors/field names beside any earlier accepted sample; no failed page becomes a passing review.
- [x] Personal notes retain optional event/issue context without adding defaults to old contexts. Existing hashes and export/restore round trips remain valid; later queue changes do not mutate a captured sample or failure.
- [x] Fix token-detail GMGN reads rejecting hourly candle/trader receipt IDs as non-UUIDs. Admit only legacy UUIDs and the exact `attention-candles-`/`attention-traders-` hourly namespaces where appropriate. Activity selection admits UUIDs or exact trader-hour IDs; its own request ID remains a UUID. Existing UUID normalization, archive hashes, source parsers and replay contracts remain unchanged.

## Live outcome: held, not accepted

The first metered attempt, `641ac61f-951e-43e8-88c0-780e461720b4`, reserved at2026-10-22T15:30:49.519Z, cost one HTTP request. GMGN returned HTTP200, but the original validator rejected it as `activity_schema_invalid`, with sanitized field `activities`. No rejected response body or values were retained. This diagnostic does not establish whether the field was missing, null, an unexpected shape or over its bound; do not infer the cause or treat it as zero activity.

The hour stays spent. No immediate retry, new ID, raw-body dump, broader parser, quota reset or backoff reset was used. The reloaded local timer subsequently held `activity_hour_already_reserved` with zero provider calls. The saved queue now shows the unusable attempt and no accepted event sample. The live token-detail reader returns HTTP200 with100 trader rows, its saved candle coverage and the held wallet-event issue; this verifies the receipt-ID repair, not event acceptance or organic participation.

Current official [portfolio command](https://github.com/GMGNAI/gmgn-skills/blob/main/src/commands/portfolio.ts) and [client](https://github.com/GMGNAI/gmgn-skills/blob/main/src/client/OpenApiClient.ts) still document the token-filtered wallet-activity request. They do not justify inventing a response mapping for this rejected page. Future ordinary admitted samples must establish compatible response evidence before live acceptance is marked complete.

## Bounds and interpretation

This adds at most24 hourly attempts/day to the prior120 nominal attention/market/candle/trader slots. Combined144 slots remain demand within the shared600 HTTP market ceiling, alongside ordinary work. They are not an additional allowance or guaranteed capacity. Existing Free/provider entitlements, source/research-mode admission, weighted pacing (activity weight3), pause, leases, persistent backoff, byte limits and request ownership remain unchanged. No paid service, key/private-key change, migration or dependency/config change.

Display reads allocate24 attention,8 DEX,6 candle,6 trader and2 activity pages. Each activity requires its original trader receipt, so the total remains48 receipt reads, not46; both receipt bytes count toward the same8MB envelope even if the trader bucket also reads that source. Collecting turns use8/4/3/3/1 plus that activity’s source: at most20 receipt replays and one selection query. Activity failures use fewer reads; their original-source byte allowance is still conservative. Truncated history remains explicit. Activity pages/issues add no discovery snapshots or provider-family votes.

This is a targeted, selected-wallet page, not a representative population or a continuous/day-long record. A provider page end is not complete-history proof. Reported token identity is echoed, wallet scope is request context, and signatures remain independently unverified. Transfers/liquidity events are excluded from trade totals; optional missing, malformed and negative-signed USD remain separate. Repeated amounts can be ordinary sizing, and both-side transactions can be routing or arbitrage. Neither cue nor its absence establishes fraud, organic volume, safety or meaningful holder growth. No score, ordering, candidate/proof, eligibility, election, action or financial-policy adoption.

## Validation and preservation

Backend:1,504 tests across102 suites pass. Tests cover deterministic IDs, source selection, token/wallet/source tampering, empty/invalid/failed-hour charging, fair next inspections, configuration/authentication/pause/budget/backoff holds, source replay tampering, public privacy, legacy receipt compatibility, no votes/proof writes and saturated five-bucket receipt/byte bounds. Discovery UI:184 tests across38 suites pass, covering missing/stale/unsupported states, descriptive cues, failed attempts beside accepted samples and personal-note hash/export/restore compatibility. Both typechecks and14 relay/operator checks pass. Final results are retained with private164 verification artifacts.

Closed production build, performance budget, thesis-only guard and security preflight pass. Home startup remains227.8KiB gzip/11 chunks; unfinished product assets remain excluded. This does not close the enabled-feature performance/serving hold.

Actual-component browser checks use the untouched saved live failure plus explicitly synthetic accepted/missing/stale/absent examples in an isolated profile. Desktop1280, mobile390 and reflow320 have no document overflow, unexpected source requests or browser exceptions; screenshots were visually inspected. Synthetic accepted examples are not live evidence or founder judgments. This is not independent full-app UX/accessibility or enabled-feature performance acceptance.

Only the verified idle local Discovery launcher was restarted to load the timer helper; the supervisor and original database/evidence/quotas/backoff were retained. Frozen163 and earlier private artifacts, archived proof rows, original event/candle field validators and v4/action/release controls remain preserved. Thesis-only exposure and source-bound serving149 remain held. No deploy.

## Next work

- [ ] Establish live accepted event coverage through ordinary metered admissions. If `activities` remains incompatible, obtain narrowly sanitized structural diagnostics and documented field semantics before proposing a versioned parser change; keep the original rejected receipt intact.
- [ ] Use dated provider events with the existing bounded independent transaction comparison where coverage permits. Do not widen transaction/RPC bounds or equate signatures alone with organic trading.
- [ ] Add separately sourced holder observations and qualified acquisition/retention evidence to the shortlist. Raw counts, dusting and wallet linkage still need explicit qualification before growth earns credit.
- [ ] Measure prospective founder review completion, unfamiliar-token usefulness and false reassurance; connect authoritative completed-ATTN-launch exclusions before launch selection. Broader-chain collection and extra providers must show marginal value within Free capacity.
