# Personal review backup and restore

23 October2026, Australia/Sydney. Continues [161](161-personal-attention-review-worksheet.md). No deploy.

## Delivered

- [x] My attention reviews → Restore an exported review history accepts a local JSON export. Inspect the captured file bytes locally and show filename, original export/review dates, existing/file/new revision counts and exact token chain/contract identities before offering restore. Selection/preview makes no storage write; cancellation discards only the in-memory preview.
- [x] Explicit confirmation is required before restore; the disabled state is visible and keyboard controls are labelled. Native exclusive locking uses the same key as ordinary review appends. Confirmation revalidates the captured export and current local head; storage events, ordinary saves and explicit history reload invalidate previews as appropriate. New file selection always discards old confirmation.
- [x] Validate supported export version, closed adoption fields, labels, identity/context hashes, unique IDs, full hash chain, per-token revision links, chronology and Sydney dates through the existing verifier. Export times must not be ahead of the device clock or precede any contained record. Source observations and reviewer identity remain unverified personal claims.
- [x] Restore into empty local history, or append an export whose initial records exactly match all existing local records. Original records/IDs/hashes/timestamps/context are preserved rather than regenerated. Duplicate and ancestor exports are no-ops: local history is never shortened. Valid divergent branches are held; there is no automatic merge, rebase or replacement of corrupt history.
- [x] Reject failed/mutated files, stale preview heads, concurrent storage changes and storage-write failures without reporting success or replacing local notes. Existing open drafts remain separate from restore and are retained. No automatic repair, deletion, provider call, server persistence or eligibility/score adoption.
- [x] Check File.size before reading, then actual UTF-8 text bytes before JSON parsing. The import-file cap is6MB for pretty-printed exports; the original200-revision/2MB compact-ledger cap still applies after parsing. Unknown export fields or open launch/scoring/evidence fields are rejected. Local JSON is parsed as data, never executed and never used as a URL to fetch.

## Scope and remaining custody limits

This is manual portability and backup recovery between browsers/devices that the user controls. Exported notes remain plaintext and contain personal labels and captured observations. Local storage remains origin-specific, unsynced and clearable. The application does not create an automatic/off-device backup, prove who wrote a review, attest source authenticity/completeness, or merge different reviewers’ histories. Shared/private server custody and explicit admitted archival remain open. Retain separate divergent exports rather than rewriting their originals.

A restore does not refresh timestamps, source evidence, observation freshness, scores, ranking or launch policy. Hash consistency is not identity/source proof. The fixed provider/source limits, quotas, pacing and backoff are untouched. No database/table/migration, Worker/relay/timer, feature flag, dependency or config changed. No live source collection or runtime restart occurred in this slice; ordinary supervised background work continues under its existing controls.

File and lock API contracts checked in [Blob.text documentation](https://developer.mozilla.org/en-US/docs/Web/API/Blob/text) and [exclusive lock requests](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request). Unsupported locking holds confirmation rather than introduce a fallback write path.

## Validation

179 UI/store cases across37 suites and frontend typecheck pass. Added cases cover preview without writes, export/restore/re-export preserving original records, exact continuation, duplicate/older no-op behavior, valid divergent branches, corrupt local storage, altered contexts/labels, unsupported/open-gate exports, clock rejection, storage races/failures and byte/read bounds. Existing worksheet tests remain.

The actual-component browser exercise uses the frozen161 cache and explicitly synthetic notes in a separate temporary profile. Save/reload/follow-up/export still work. The restore journey simulates an empty destination, checks confirmation before writes, restores original records, reloads, rejects a duplicate, appends a matching continuation, holds tampered/divergent/oversized files and invalidates a preview on a storage event. Corrupt local history remains unchanged and unavailable for overwrite. Desktop1280, mobile390 and reflow320 have no document overflow or browser exceptions; screenshots were visually inspected. Final artifacts: `.tmp/attention-browser-20261023-162-002/`; initial001 remains separate. Zero provider calls. This is component workflow evidence, not independent full-app accessibility, enabled-feature performance or release acceptance. No actual founder judgments were added.

Closed production build/performance budget, thesis-only release guard and security preflight pass; home startup remains227.8KiB gzip/11chunks. All earlier private artifacts/proof rows are checked by new162 integrity metadata. No deployment.

## Strategic next work

- [ ] Prioritise focused participation/holder evidence and review completion/latency on the attention shortlist, using current Free sources and unknowns. Reported volume/growth are still unverified for wash trading/dusting.
- [ ] Use real prospective founder sessions/follow-ups to assess shortlist usefulness, unfamiliar-token misses and false reassurance. Imported subjective labels are not independently checked outcomes or automatic calibration input.
- [ ] Broader chain/full-day candle coverage and authoritative completed-launch exclusions remain gated. Optional Free-key FOMO/Birdeye must demonstrate marginal value within their separate Free entitlements.
- [ ] Shared/private review custody and admitted archival remain later work; this restore feature does not justify another scoring model or complex automatic label-merging process.
- [ ] Preserve v4/action/election/financial policy, source-bound serving149 hold, thesis-only exposure and independent UX/performance/security release requirements.
