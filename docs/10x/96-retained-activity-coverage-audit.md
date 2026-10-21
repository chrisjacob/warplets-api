# Retained activity coverage audit

22 October 2026 (Australia/Sydney). Implements the measured F1 coverage review needed before proposing F3/F4 scoring changes in the [product plan](82-next-product-functionality-plan.md). This is a private, read-only audit/export tool, not a new token-specific evidence panel, source collector or scoring formula.

## Delivered behavior

`scripts/discovery-coverage-audit.ts` opens an explicitly named existing SQLite file read-only, enables query-only access, establishes one WAL read transaction and freezes one current cutoff for the entire retained live candidate inventory. It uses the existing local D1 emulator adapter and common activity projection; it does not use a remote database, credentials, browser requests or provider transport. No historical cutoff override is offered.

The existing 500-candidate, four-megabyte total candidate-payload and 1.6-megabyte single-payload guards remain. Exceeding a bound fails the whole export rather than silently auditing a subset. Each candidate has all thirteen declared activity slots, or an explicit candidate-level hold. Bad JSON, identity/mode mismatches, future candidate dates and unusable projections stay in the denominator. An invalid indexed mint or exceeded operational bound aborts instead of publishing a misleading partial report. A two-minute deadline checked between candidates bounds the read transaction; it is not a hard interruption of a synchronous SQLite operation. The final private artifact is limited to 32 MB, independently of all provider/research budgets.

The deterministic summary keeps six strata: all retained tokens; the coverage population excluding pinned regression references; those references separately; and first-day, older and unknown-creation-age tokens. The v1 reference set is pinned to the existing PONYX, USDF and Kimchi exact mints so future collection-policy edits cannot silently reclassify old audit denominators. First-day means a nonfuture saved creation time at most 86,400 seconds before the cutoff. Retained inventory is not the whole market; exclusion from the known reference set does not establish that a mint is unseen or independently labelled.

Source selection retains the common model's existing six-day GMGN lookup and trailing-24h holder-history bounds. It uses the latest admitted source attempt rather than falling back to an older clean result after a failure. Missing fields describe this bounded projection at the cutoff, not proof that the mint has never had data elsewhere or outside those lookup windows.

For every metric and stratum, both qualification and freshness partitions sum to the full candidate denominator. Candidate-level holds, reported-only values, supported samples, held/missing/rejected fields, stale values and unknown freshness remain distinct. Numeric coverage counts zero as a measured value. Separate counts expose fresh numeric values, explicit window endpoints and numeric observations carrying only archived-hash-verified references. The latter is an integrity-reference count, not independent authenticity, complete coverage or organic-volume certification. Reported rolling duration alone does not provide measured start/end timestamps.

Exports contain normalized observations, original candidate hashes where usable, source references and gaps, plus input/summary hashes. The verifier replays the deterministic summary and requires an independently retained checksum of the complete file. A checksum protects the retained export; it does not re-fetch or independently certify the underlying provider/chain payloads. Legacy source/cohort replay remains separate. No study is enrolled, old cohort enriched or model adopted.

Output must be a new file inside the real ignored repository `.tmp` directory; linked private roots, escapes/junction aliases to other directories, Wrangler paths and existing destinations are refused. Keep these artifacts private and retain their checksum independently. Interrupted output may leave a partial file; never overwrite/adopt it as verified. Verification rejects an incorrect checksum, malformed/recomputed summary or oversized artifact.

The shared `commonActivity` record-only path now skips the extra recent-activity and wallet acquisition/retention/trade projections that it does not return. All thirteen records and their source validation remain the same. `commonActivityBundle` still computes the complete existing comparison bundle. No read API contract, UI, timer, source admission, SQL schema or configuration changes.

## Measured snapshot

Private export: `.tmp/discovery-coverage-audit-20261022-001.json`, **5,368,773 bytes**, cutoff **2026-10-21T15:57:48.158Z**. Independently verified and summary replayed with file SHA-256:

`e7b13deecb5f1ace517358a0c0764b5801afd61303706f7a7485abcc26986079`

All **484 retained candidates** were projected; no candidate-level hold occurred. There were **482 coverage-population tokens** and **2 retained regression references**, with 71 first-day, 236 older and 177 unknown-age tokens. These are contemporaneous cache counts, not a prospective observation target or successful validation sample.

| Metric | Numeric / 484 retained | Fresh numeric / 484 | Interpretation |
|---|---:|---:|---|
| Pool-reported 24h volume | 483 | 20 | Reported pool totals; all actual rolling-window endpoints unknown |
| GMGN token-reported 24h / 1h volume and holders | 2 each | 0 each | Both tokens were regression references; all 482 other tokens lacked these saved fields |
| Requested candle-window volume | 1 | 0 | One other reference held volume; 482 missing. Pattern measurements existed for both references, also stale |
| Raw owner net change | 6 | 3 | Supported observed intervals only; 83 held and 395 missing, with no qualified daily-growth credit |
| Selected-wallet reported buys / sells in USD | 1 / 0 | 0 / 0 | One wallet sample is not token-wide economic volume |
| Qualified organic volume / meaningful 24h growth / attention index | 0 each | 0 each | All 484 held; no unsupported score credit |

The coverage-population stratum had **zero saved GMGN token-info or candle-window fields** at this cutoff. This materially limits a prospective provider/hybrid comparison. The next data priority is ordinary admitted broad-token collection and its source/window qualification, not selecting v5 weights from these regression examples. No allowance was reset and no collection was forced to improve this report. The thirty-new-mint/three-UTC-day F1 observation target remains open; this retrospective cache census does not satisfy it.

## Verification and operations

**77 backend tests pass:** nine new audit tests plus existing comparison, recent activity, holder participation, signed trade sample, v4 and scoring-counterexample suites. Adversarial checks cover zero versus missing, stale values, all qualification states, denominator partitions, reference separation, duplicate/missing metrics, mixed cutoffs/identity, invalid candidate payloads, future rows, inventory/byte/deadline bounds, private destinations, missing databases, overwrite refusal, wrong/missing checksum and edited-summary replay. Query-only fixtures and a fetch trap verify no writes or provider requests. Typecheck passes, including the CLI imported by the tests.

The real export and pinned verification passed. Original 1,732 historical row hashes and foreign keys remain unchanged. Cached operations after the audit were healthy, with heartbeat **2026-10-21T15:59:29.696Z**, recent independent watchdog **15:59:35.223Z**, no issues and no restart recommendation. Three retained election rehearsals replayed (442 / 364 / 363 candidates). The existing thesis-only built-artifact assertion, private-key exclusion checks, documentation links and whitespace pass. No UI build is repeated because no UI/assets/configuration changed.

Example commands from the repository root; substitute the existing local database file and a **new** private output filename:

```powershell
pnpm exec tsx scripts/discovery-coverage-audit.ts export --database PATH_TO_EXISTING_LOCAL_SQLITE --output .tmp/NEW-activity-coverage.json
pnpm exec tsx scripts/discovery-coverage-audit.ts verify --file .tmp/NEW-activity-coverage.json --sha256 INDEPENDENTLY_RETAINED_FILE_SHA256
```

Query handling was reviewed against current [Cloudflare prepared-statement documentation](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/); no new binding or runtime capability is introduced. This remains a local Node tool rather than a production D1 performance claim.

Frozen v4, old artifacts/cohorts/elections, all provider Free limits, source pacing/backoff/leases, the authorized local calibration policy and all evidence/action gates remain unchanged. Production remains thesis-only. No migration, restart, signing, paid resource, new provider request or deploy.
