# Bounded current discovery and indexed retained history

22 October 2026 (Australia/Sydney). Implements the first inventory-capacity correction from [97 — product/design/performance/security review](97-prd-design-performance-security-review.md). Retained history no longer has to fit into a single scoring evaluation to remain browsable. This does not solve the separate 1.07 GB raw-store/Free-hosting problem or introduce precomputed score models.

## Current versus retained browsing

Discover now explicitly requests `inventory=current` on the existing cached candidate GET. It uses the existing `tenx_active_candidates` view, which excludes only identities already carrying immutable verified-creation expiry receipts. Unknown creation times and rejected/provisional observations are not silently removed. The default first-day selector still additionally requires verified creation within 24 hours. The alternative is labelled **Current evaluation inventory**, rather than claiming to show all retained history.

All existing evaluator bounds remain: at most 500 inputs, 4 MB total candidate payloads and 1.6 MB per candidate, plus existing price-history limits. The original v4 formula, ordering, action gates and old frozen records are unchanged. A genuinely oversized active inventory still fails closed; the correction does not pick an arbitrary top 500 or manufacture eligibility. Fixture mode remains isolated and bounded.

Response scope distinguishes current inputs from `retained_total`; `current_evaluation` identifies the all-age current view, while `active_verified_first_day` remains the first-day scope. Current snapshot cursors bind this inventory choice and retained count as well as the existing mode/query/view/cutoff/snapshot. Changing scope or inventory invalidates the cursor with 409; it cannot merge different populations. Old ephemeral cursors from before this query-contract addition may require refresh.

Legacy clients that omit `inventory` retain their original `retained` behavior, including the unchanged 500-input hold. `age=24h` continues using the active view. The new directory is the route for browsing history beyond that evaluation guard. We have not silently changed the meaning or input set of historical election/policy/research replay.

## Retained identity directory

`/history` and cache-only `GET /api/10x/history` expose all retained identities in a selected live/fixture mode, with an optional exact canonical mint lookup. The directory is **unranked**: it returns mint, bounded name/symbol hints, candidate checked date and metadata availability. Dates are not represented as evidence freshness; an available metadata hint is not a valid Candidate assessment, verified origin, trust grade or action pass. Raw proofs, wallet/holder bodies, sessions, private fields and source responses are not returned.

The read uses two SELECTs in one local D1 batch: a mode-scoped identity count and a page selected through the existing `(mode,address)` primary-key index. It returns at most 100 entries, with one extra row to detect continuation. There is no SQL OFFSET, whole-history score pass, new index migration or collection timer. JSON metadata parsing is limited to candidate bodies at most **16 KB** each, at most 101 selected rows. Larger or malformed bodies, invalid header fields and identity/mode/date mismatches retain an addressable entry with held metadata. Original candidate bodies are neither truncated nor rewritten. This bounds JSON parsing/output; it does not certify remote row-read costs or eliminate SQLite disk access to large records.

Cursors carry a version, mode, exact-mint scope and last address; malformed/cross-scope cursors are rejected. Address order is monotonic and entries are not duplicated as new pages are read. The directory explicitly uses **live keyset pagination, not frozen scoring snapshots**: metadata/counts can change, and identities inserted before the current cursor appear on a fresh walk from the start. A directory traversal does not certify a simultaneous full-market or immutable-population snapshot. Page size may change without conferring any scoring/evidence capability.

The browser provides next/previous/start controls, bounded response reads (256 KB) and a thirty-second request/body deadline, ignores aborted/stale results, and retains the last successful same-scope page on request failure. Changing mode/mint cannot display another scope's page. Previous navigation rereads metadata rather than claiming a frozen cached page. The cursor trail is transient browser memory; no credentials, evidence or history cursor is persisted to local storage. Exact-mint input is validated before a request. React escapes identity hints and only canonical mint addresses construct evidence links. The list uses ordinary page scrolling rather than another capped nested list.

Discover, Data status and More navigation link to the directory, making the reduced evaluation scope explicit. The new page and its whole namespace are included in the existing strict client/server thesis-only exposure flag. Production page GET/HEAD redirects home and page mutations/API requests remain closed under the existing middleware; enabling local development has not opened a production route or asset.

## Validation

**210 distinct tests pass:** 50 backend tests across directory/current scope, existing browsing, expiry, frozen v4 and positive/adverse counterexamples; 160 UI/client/release-isolation tests. Eight backend directory tests cover:

- 501, 1,000 and 5,000 retained identities with valid immutable expiry receipts, complete ordered directory walks, exact historical lookup and a bounded one-token current evaluation;
- unchanged historical payloads, expiry hashes and frozen score replay, with zero writes/provider requests;
- malformed/large metadata and identity mismatch retained as held hints, without leaking arbitrary private payload fields;
- mode/mint cursor binding, invalid query bounds, missing exact mints, and honest live insert/refresh semantics;
- a still-held 501-candidate **active** inventory, independently usable history, and current/retained score-cursor separation;
- `EXPLAIN QUERY PLAN` confirming the existing mode/address range index without a temporary sort, and exactly two directory SELECTs.

Four new browser-client/render tests cover scope/response/cursor bounds and escaped names/held metadata. Existing UI paging fixtures now declare their explicit current scope. Server/shared-release tests include `/history`, deeper namespace paths and query attempts while closed. The existing browse suite's first run exceeded its five-second timeout during concurrent build/typecheck/large-fixture work; it passed sequentially without increasing its timeout. Synthetic fixture signature/import mistakes were corrected; no production constraint was relaxed.

Backend and app typechecks pass. The app build/performance gate passes at **232.5 KiB gzip / eleven static startup chunks**; the built thesis-only release assertion passes. No claim is made about enabled Discovery's Core Web Vitals or remote Free CPU/query feasibility. OpenAPI changes are limited to the candidate scope/query, the new history endpoint and its schema; all other contracts compare unchanged.

## Local cached proof

At **2026-10-21T16:41:04.910Z**, the local proof walked **488 distinct retained identities** in pages **100 / 100 / 100 / 100 / 88**, with the retained count 488 on all five reads. The directory remains live rather than snapshot-certified even when those counts agree. Page bodies were **15,038–17,130 decoded bytes**. A current all-age read evaluated **251 inputs**, reported 488 retained identities and preserved the 500-input evaluation ceiling.

Exact lookup for already-expired mint `266xwt1he2DtB39LFahETEokivhN6VaBgUage7xBpump` returned its identity/evidence link; the expiry checksum remained `9d93c878dac9792c95a9293d6fb939ec2d001f74149dc432f5e815604668c333`, and its existing v4 score replay verified. This is a general historical-navigation check, not a new token review or fraud label. Browser Next/Previous and exact lookup also passed in an agent-owned background tab; the user's tab was preserved.

Private proof: `.tmp/history-directory-live-20261022-001.json`, SHA-256 `e8ce3201940bdb234eebe758e8063156914565cd7edae9250fa3c13d6c8b7e46`. Directory wall times were 253–1,722 ms and the current scoring read took 5,329 ms during development verification; these few uncontrolled samples do not establish a latency improvement or p95. Precomputed reads remain open work. The check made zero provider requests and database writes.

The original 1,732 source/cohort/outcome/holder/wallet/cache hashes remain identical; foreign keys pass. Cached operations at **16:43:29.978Z** had a recent timer and fresh independent check at **16:43:46.136Z**. Market/wallet source issues remained visible, with no restart recommendation. Three original election rehearsals replayed (442 / 364 / 363 inputs); no retained election error, signing or launches were present.

## Boundaries and remaining work

This correction separates **bounded current evaluation** from **retained identity browsing**. It does not shrink/move/delete evidence, change expiry policy, solve unknown-date accumulation beyond 500 active candidates, remove the legacy retained-scoring/full-audit guards, create a durable compact metadata/score projection, certify off-device recovery or make the large local store fit D1 Free. Those capacity steps and dependency remediation remain priorities in milestone 97. Broad admitted observation and F3/F4 qualification are still required before changing v4.

No live migration, store switch, forced collection, allowance reset, new provider entitlement, paid service, signing credential, financial action, runtime restart or deploy. Local calibration authority, provider pacing/leases/backoff/Free quotas, old artifacts/cohorts/elections, every evidence/action gate and thesis-only production remain unchanged. Query handling follows the reviewed [D1 prepared-statement contract](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
