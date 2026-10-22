# Reject impossible wallet envelopes before RPC

23 October 2026, Australia/Sydney. Continues [172](172-operator-gmgn-event-collection.md). No deploy.

## Delivered

- [x] Load and pin the saved holder input at the start of a full wallet snapshot, before the cluster check or any other RPC call. Check its complete `{holders}` envelope against the existing 1,800,000-byte UTF-8 ceiling. A holder receipt can fit its own storage allowance yet exceed the wallet envelope before any trading evidence is added.
- [x] Reject an already oversized envelope with the existing `wallet_evidence_size_limit` code. Keep the original failure journal, one-hour candidate retry delay, five-minute shared wallet backoff and lease release. No source trimming, holder omission, evidence publication, snapshot promotion or quota reset. Existing planning/catch-up reservations retain their original behavior; an actual RPC reservation is never made for this preflight failure.
- [x] Keep the full parsed evidence size check before analysis/publication. A passing lower-bound check cannot certify holders, establish capacity for the remaining sources or bypass any existing hash, layout, identity, freshness, funding, scoring or action check. Serialize the final payload once and use that same checked string for publication.
- [x] Leave direct/cached funding and recovery branches, GMGN samples, provider pacing/backoff, quotas, source limits, archived receipts and report versions unchanged. No schema or migration is needed.

## Read-only local assessment

At 18:26 UTC on 22 October, the exact preceding 24-hour window contained 17 wallet size-limit failures with 249 recorded RPC calls. Of 316 current saved holder envelopes, six exceeded the wallet ceiling on their own; the largest was 1,998,074 bytes. This inspection read the existing local database and ran only the lower-bound serializer: zero provider requests and zero database writes. Raw saved envelopes were measured without issuing a new holder certification. Current snapshots do not prove which historic failures could have been prevented or that all 249 calls would have been saved. No live collector dispatch, manual retry, backoff reset, manual runtime restart or deployment was performed for this slice.

This removes unnecessary calls on an input that cannot fit; it does not resolve the evidence-format mismatch for larger holder inventories. Those tokens remain held. Do not increase the 1.8 MB bound or silently remove holders to admit them. Evaluate a versioned, hash-bound holder reference with complete standalone replay and explicit retained-source failure semantics as a separate design change before implementing it. Existing self-contained evidence and archived hashes must remain replayable.

## Verification

The full backend suite passed 1,585 tests / 107 suites, and Discovery UI passed 216 / 42 suites. Both typechecks, the local closed build, performance budget (227.8 KiB gzip / 11 startup chunks), thesis-only release guard and security preflight passed. Protected historical row hashes and foreign keys remain intact. All 115 recorded automatic, collection and snapshot wallet workflow tests passed, including paused/backoff/exhausted-quota admission, exact retained metadata, source bounds, lost acknowledgements, owner replacement, transaction rollback, read-only recovery and same-identity retry without repeated writes. Current [Workers guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and published type version5.20261022.1 were checked; no dependency/configuration upgrade was made.

The new regression uses a structurally valid, explicitly uncertified size-stress fixture, with no live trading requests. It checks zero RPC calls/reservations, unchanged source/candidate/evidence/control rows, the failed journal, preserved backoff and candidate delay. Boundary tests cover exactly 1.8 MB, one excess byte, multibyte UTF-8 and a complete envelope that exceeds the ceiling after its holder-only preflight passes. These checks do not establish production capacity, successful token selection or organic trading activity.

## Next build priorities

Prioritize real prospective shortlist decisions and mature follow-ups across daily attention cohorts, qualified holder observations and authoritative completed-ATTN-launch exclusions. Keep [149's serving assessment](149-native-builder-and-combined-free-budget.md) and remaining performance/security acceptance open. The proposed holder-reference design is an evidence-capacity task, not evidence that a token is safe or that its volume is organic. This slice does not change discovery rankings, source selection, score thresholds or safety labels. Production stays thesis-only; every Free-tier, evidence and action gate remains in place.
