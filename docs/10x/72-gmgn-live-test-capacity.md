# Internal research capacity and first live GMGN checks

21 October 2026 (Australia/Sydney). Founder-authorized continuation of the [read-only GMGN integration](71-gmgn-read-only-integration.md).

## Decision and bounded change

The **100-record/day restriction was our internal aggregate research-admission policy**, not a GMGN Free-plan quota. The founder explicitly authorized increasing it to test GMGN immediately while preserving Free access and every evidence gate.

Raise the shared allowance to **120 records per UTC day**, across all score models and source reservations together. This adds twenty internal slots, matching the existing maximum of twenty prepared-source HTTP attempts; it does not guarantee twenty complete data bundles or exempt score captures from admission. The [atomic source guard](../../discovery/src/source-collection-store.ts) and [score guard](../../discovery/src/score-research.ts) read the same [central limit](../../discovery/src/score-research-model.ts).

Unchanged boundaries:

- **10 MB aggregate retained/reserved bytes per UTC day**, 1.9 MB worst-case reservation/record and 1 MB upstream body.
- **20 source HTTP attempts/day inside the existing market maximum of 600/day**; lower configured market limits still win. Standard GMGN reads only, no Pro resolution, paid fallback, top-up or account change.
- One source request in flight, starts at least ten seconds apart, bounded timeout and persistent provider backoff. Failed/abandoned attempts count; no refunds or forced refresh.
- Three total maintenance capture attempts, at most one allocated to the declared GMGN pilot, and five score finalizations. No additional timer or per-visitor provider work.
- Independent mint/origin/pool/holder/wallet checks, strict normalization, timestamps, unknown-versus-false semantics, all risk ceilings and action/election gates. Current score-v4 is unchanged.

No historical row was deleted, replaced or regraded; no usage counter, UTC day, pause, backoff or lease was reset. No schema migration or new remote resource is needed. The byte cap can still hold admission before the new record maximum is reached.

## Live results

The configured API key successfully returned **HTTP 200** for exact-mint PONYX token info at **17:33:56 Sydney time**, and security at **17:34:55**. Both responses passed the selected-field/mint checks and were retained through ordinary atomic admission. Cached replay verified both receipts without additional provider calls.

- Info receipt: `509651c6-1880-4620-a6d3-4c3c12fda38f`. Reported 24h USD volume **135,323.66539265** and **2,008 holders** at this observation; these remain raw provider reports, not organic volume or dust-resistant holder growth.
- Security receipt: `43b1d131-7831-4360-992c-00b0336597a1`. Returned authority flags, but the selected wash/rug/insider/bundler verdict fields were absent. They remain **unknown**, with no clean-evidence credit. Successful authentication does not establish coverage of every advertised field.
- Standard one-minute candle attempt: `a028ad47-d3d6-40aa-b641-5de33c85e1e6`. HTTP **200**, but the payload failed existing semantic/schema validation. Its body was withheld, the failed attempt counted and the normal sixty-second backoff was honored. No valid candle, volume, window-completeness or pattern finding was manufactured. Resolving this real-response contract mismatch remains a follow-up; it is not evidence that the Free plan denies candles.

The existing pilot can continue inside actual remaining capacity. These regression investigations do not form a calibrated validation set, restore creation-age eligibility, prove organic demand or change token scores. Provider licensing remains independently unconfirmed; the founder's previously recorded instruction authorizes the bounded storage/display used here. No credentials appear in these receipts or committed documentation; full source bodies remain private.

## API, display and historical compatibility

Research summary and source-pilot readiness now report **120**. Their readers accept the prior **100** value during local rolling reloads; they do not accept arbitrary higher caps. The 0–100 Discovery score, 100-card browsing maximum, holder targets, source row bounds and all unrelated numeric policies are unchanged. [OpenAPI](../../discovery/openapi.json) is regenerated from these schemas.

Previous milestone statements about an exhausted 100-record store remain dated historical results. This explicit founder instruction supersedes that internal limit; it does not silently revise source entitlements or evidence policy.

## Verification

- **131 Discovery tests across four affected modules passed**, including admission at record 101, unchanged original rows, rejection at the new aggregate boundary, concurrent final-slot contention, byte exhaustion and unchanged source HTTP limits.
- **85 Discovery UI tests across sixteen files passed**, including current 120-record display and compatibility with previous 100-record responses.
- Discovery typecheck passed. Frozen original 100 cohorts and zero outcomes remained byte-identical; foreign keys passed. New ordinary captures are additional rows, never replacements.
- App typecheck/build and performance budget passed: home startup **234.1 KiB gzip across eleven chunks**, inside its existing budget.
- Browser verification of the recovered local preview showed saved GMGN volume and holders, explicit unknown risk fields, stale-receipt labeling and unchanged score/action wording. Reading this panel makes no provider request.
- Secret checks covered eighteen changed source/document files and seventy-two built assets: the actual query key was absent, and both local secret files remained ignored and untracked. All **359 local Markdown targets across sixteen documents** resolved; whitespace checks passed.
- No deploy, signing, trade, launch, payment or funding.
