# Bounded event transaction sample

23 October 2026, Australia/Sydney. Continues [168](168-personal-review-follow-up-progress.md). No deploy.

## Delivered offline

- [x] Add a separate, versioned plan/comparison/replay contract for complete50-event research pages. It first replays the entire original activity receipt and trader selection, retaining original mint, wallet, chronology, body/report hashes and all166 validation. Legacy20-event pages are not reinterpreted as the new contract.
- [x] Plan at most two trade-bearing transaction signatures before examining cached bodies or comparison results. Investigation order is two-sided signatures, then repeated positive same-side token sizes, then lexical signature order. Ties are deterministic. This is a targeted investigation heuristic, not calibrated scam detection or a representative/random sample.
- [x] Retain every event belonging to each selected signature, including transfers/liquidity events and rows beyond20. If those selected transactions together exceed20 events, hold the whole sample. Do not trim a transaction, choose a smaller fallback, replace a failed comparison or hide the rejected selection. A page without trade transactions is held explicitly.
- [x] Bind the plan to exact activity ID, cutoff, original receipt/report hashes, selected signatures, original event indices and method. Retain page, selected and unselected event/trade counts. Recompute the plan during comparison; changed indices, selection or metadata cannot be admitted merely by recomputing a caller-supplied hash.
- [x] Compare only the chosen signatures against at most two supplied cached RPC bodies. Preserve the existing1.8MB transaction-body,6MB input, complexity and20-event/instruction bounds. Reject extra/unselected signatures, duplicate entries, altered hashes, future fetched/block times and cache supplied to a held plan. Missing selected bodies remain explicit.
- [x] Reuse the original signer, canonical-pool, event-time and raw-instruction-quantity checks through an extracted pure comparison kernel. Keep exact instruction matches distinct from aggregate-only quantity agreement. Failed transactions, missing quantities, numeric fractional ambiguity and parser/signer conflicts confer no exact support.
- [x] Hash-bind and replay the separate sample report, including missing-cache/group results and coverage gaps. Matches describe only selected token quantities; unselected events, token-wide behavior, organic volume, historical USD, wallet independence and finality remain unverified. Every result keeps `live_collection_enabled=false`, provider requests/writes zero, no scoring effect and unchanged evidence gates.

## Deliberately disconnected

The new sample provides saved-data functions and synthetic tests/studies only. No new route, collector, CLI, timer, database table, public projection or user action invokes it. The original RPC collector, public comparison/quote contracts and50-event UI hold remain intact. No new RPC/provider allowance, quota/backoff reset, spent-hour reopening, migration, configuration/dependency change or runtime restart.

Live connection remains gated on an ordinary accepted166 page, reviewed selection/coverage and the existing operator-only wallet lease/quota/journal path. A future collector must reserve each existing RPC allowance, attempt at most two signatures plus the existing cluster check, retain failures as spent, and never imply full-page or token-wide coverage. This plan does not authorize an additional allowance or actual collection.

## Verification

An independent offline study bundled the original committed comparison and the extracted kernel against identical synthetic inputs. Exact, aggregate-only, missing-cache and signed-cost reports and hashes match exactly. The pinned original exact-report hash is `7c833b4721301111c2f9e9a6d02ba7a345866c3982d1b9006c6248d78072209f`. A synthetic50-event replay compares one selected transaction/event and explicitly leaves49 events unverified; this is not live acceptance or real token/holder evidence.

Tests cover whole-page/source replay, all events for selected transactions, deterministic priority/ties, oversized-selection hold, no-trade/missing-body states, exact/aggregate-only/two-body limits, quantity/time/signer/transaction failures, plan/report/source tampering, unselected/duplicate/oversized/future cache rejection and legacy separation. The clean full backend run passed1,534 tests/104 suites; final focused checks passed14, and Discovery UI compatibility passed199/40 suites. Both typechecks, thesis-only release guard and security preflight pass. The first full run had one unrelated address-generation timeout under concurrent jobs; the full rerun passed without changing any timeout or evidence threshold. Original evidence preservation is checked separately before commit.

Workers best-practices and current Workers types5.20261022.1 were checked. No new binding/API shape is introduced. Sample planning replays its source once per comparison, and its bounded helpers perform no IO. This is offline correctness evidence, not enabled-Worker CPU/billing, independent provider authenticity or production serving acceptance. Existing closed production exposure and serving149 remain held.

## Next work

At17:01UTC22 October, an existing operator-only hourly activity attempt was made through the unchanged metered collector after the new hour opened. The local operation returned no retained result; no retry followed. At17:03:47UTC the journal still had no new activity reservation, and the latest receipt remained the original165 failure (`e5342c39fa64f6b257fe8895ed444217b43d47146833702194f4a3c6beefc29e`). Cached attention GET remained healthy (HTTP200). No quota reset, duplicate launcher or restart was used. Live50-event acceptance remains unproved; the sample stays disconnected. Do not infer provider data or failure details from the local operation's generic error.

1. Inspect the next ordinary hourly activity result. Confirm a complete accepted50-event page and original selection replay; if a row fails, retain its bounded diagnostic and investigate its documented semantics without weakening identity/time/duplicate checks.
2. After that gate, evaluate this fixed plan against the saved page, then integrate explicit bounded cache/collection and honest sample coverage through the existing wallet controls. Keep legacy reports/quotes untouched and no score or organic-volume adoption.
3. Continue real prospective founder review/follow-ups, qualified holder observations, authoritative completed-ATTN-launch exclusions and production serving acceptance. Synthetic comparisons and personal labels do not close these evidence gaps.
