# Incremental card details and dated score-summary pages

22 October 2026 (Australia/Sydney). Continues [103 — verified pages and Free write budget](103-verified-score-read-pages.md), implementing the incremental-write slice of PRD §17.7. F5 remains partial; these routes remain local admin research, with public Discover and automatic rebuilding held.

## Change and integrity contract

An unchanged token still gets a different v4 summary at each cutoff: `as_of`, input/result/record hashes are dated. Reusing that summary and changing its displayed timestamp would break original replay. The serving experiment now separates:

- **Card details:** identity, creation date, reported market/holder fields, verification, eligibility and reasons, excluding the discovery score. A SHA-256 hash pins these exact semantic details. Rows are upserted only when payload or hash changes. Original full-evidence assessment still produces every field; compact records are never reassessed to manufacture a pass.
- **Dated summaries:** the original complete v4 summary for every token, freshly evaluated at the new cutoff, stored in pages of at most **25** tokens. Each summary keeps its original cutoff and all four original score hashes. Pages follow default score rank so the first default browse page normally reads one summary page. Other sorts/filters can need several pages.
- **Inventory manifest:** pins each details hash, full reconstructed card hash, summary-page membership/hash, original browse fields, policy/contract, source revision, cutoff and unchanged sixty-second validity window. The contract is versioned `discovery-score-read-pages-v2`; old projection manifests hold until explicitly rebuilt.

Additive migration **0046** adds `body_hash` to the derived details table and a bounded summary-page table. It changes no old row bytes and does not copy, delete or rehash raw evidence, immutable cohorts or elections. The old per-card `manifest_hash` column remains a last-change diagnostic; generation authority comes from the manifest/revision barrier and its pinned content hashes. Existing source-revision triggers are reused, without adding more.

Publication is one six-statement D1 batch transaction: remove obsolete derived details; upsert changed details; remove obsolete summary pages; upsert changed summary pages; update the manifest only if changed; verify publication under the same source-revision/pause/newer-cutoff admission. The final check distinguishes a successful zero-write replay from a rejected builder. A source/pause race, older builder or late write failure preserves the previous generation atomically. Payload comparison also repairs corrupted details/pages even if their stored pins were left unchanged. Only disposable derived records outside the new current inventory are removed. [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Reads use **three SQL statements**: verify the manifest, then fetch selected details and their summary pages in one read-only D1 batch. Both fetches repeat the source/generation barrier, including empty results. Verify page hashes, exact membership/order and **every loaded summary's cutoff**, including unselected members. Parse details/summary with the original strict schemas, reconstruct each selected original card, verify both details and full-card hashes, then attach the selected view's rank. Unknown, missing, substituted, corrupt, mixed-cutoff or incompatible records hold with no evaluator/provider fallback. Checksums identify content relative to pins; they do not authenticate an independent source.

Current search/filter/sort/age/status/global-rank/cursor semantics, exact low-ranked mint lookup and `action_authority: false` remain. `available` still means an inspectable **frozen cutoff** within the read window, not fresh evidence or current action eligibility. Freshness/eligibility transitions run through the full original evaluator and can change details as well as summaries; no score hash, risk flag or evidence gate is omitted to reduce writes.

Existing source input bounds (500 candidates / 4 MB combined / 1.6 MB individual), full-card and manifest bounds remain. There are at most 500 details rows and twenty summary rows, each summary row at most 100 KB. Both encoded write inputs are bounded at 1.8 MB. A read loads at most 100 details and twenty bounded summary pages; actual selected-page costs depend on filter scatter. These are derived serving safeguards, not new research/provider quotas.

## Measured chronological cache experiment

The prior verified archive scratch copy and the running store were opened **read-only in SQLite transactions**. Their selected current candidates and relevant market history were copied into a new private in-memory fixture. Replacement of input rows occurred only in that scratch fixture; no source database, migration ledger, receipt, quota, lease or process was changed.

| Snapshot | Cutoff UTC | Current candidates | Market rows |
|---|---|---:|---:|
| Preserved archive | 21 October 14:24:50.571 | 244 | 6,321 |
| Later local cache | 21 October 18:12:56.327 | 251 | 7,150 |

The later selection has 17 additions and 10 removals. These are two chronological saved-cache snapshots, **not consecutive ticks or a representative daily churn study**. All **251 later cards** match the original full evaluator exactly at that cutoff, including original score hashes, concerns, coverage and ranks.

| Build case | Details changed / removed | Summary pages changed | Manifest changes | Total logical table changes |
|---|---:|---:|---:|---:|
| Initial 244-token build | 244 / 0 | 10 | 1 | 255 |
| Identical cutoff and source replay | 0 / 0 | 0 | 0 | **0** |
| Same evidence, cutoff +1 second | 0 / 0 | 10 | 1 | **11** |
| Later 251-token cache | 145 / 10 | 11 | 1 | **167** |

For the same 244-token time-only refresh, milestone 103's full replacement required 489 logical table changes; this implementation uses 11, about **97.8% fewer**. The later 244→251 replacement would require 496 changes with the previous delete-all/insert-all algorithm; measured incremental publication uses 167. Local SQLite changes exclude remote index/billing accounting. Reads made no writes or provider requests.

The later manifest is 97,349 bytes; reconstructed original card JSON totals 354,084 bytes. Allocations: details 270,336 bytes, details primary-key index 20,480, summary pages 188,416, manifest 98,304; shared revision/schema/other experiment storage is additional. Current builder wall/CPU measured 1,138.28 / 1,437 ms. An identical replay still performs the full evaluator (776.17 ms wall / 922 ms CPU) despite zero writes.

Forty local reads per shape included JSON response serialization:

| Requested cards | Response bytes | Wall p50 / p95 | Mean process CPU |
|---|---:|---:|---:|
| 1 | 1,923 | 10.08 / 12.93 ms | 10.13 ms |
| 25 | 38,534 | 13.11 / 17.04 ms | **15.25 ms** |
| 100 | 148,844 | 28.56 / 32.63 ms | 35.15 ms |

This slice reduces write amplification but adds index/details/summary verification. It does not establish faster reads than milestone 103 or a fit on Workers Free. Dataset, host scheduling, process-wide CPU, GC and timer quantization differ; local CPU is not Workers CPU or deployed D1 metering. A first private layout scattered default-ranked summaries across pages; rank grouping reduced that overhead, with both measurement artifacts retained. Smaller independently verified index/page proofs and full request profiling remain necessary before adoption.

Final private proof `.tmp/incremental-score-pages-benchmark-20261022-002.json`, SHA-256 `05c93fe3b67fc5bfb1da3502b6c44e03223395899d20df19a675337463e9599d`. Earlier `...-001.json`, the ignored helper `.tmp/measure-incremental-score-pages.ts`, all original archives/proofs and the live source remain preserved. Neither snapshot was activated as a collector.

## Free acceptance and next work

Under a hypothetical completely stable 244-token population, one time-only rebuild/minute now costs **15,840 logical table changes/day** (11×1,440), before source/index/other account usage. If all 251 details change every minute, the corresponding lower bound is **378,720/day** ((251+11+1)×1,440). D1 Free currently includes 100,000 writes/day, with indexes also contributing. Actual row/index reads/writes must be metered; the quiet-input example does not prove daily sustainability or justify automatic scheduling. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Next: reduce verified read/index CPU, measure real admitted refresh-to-refresh change rates over multiple days, bound aggregate reads/writes/polling and duplicate evaluator work, and design safe local rebuild admission with explicit temporal refresh. Do not extend freshness, retain old score hashes under a new cutoff, drop validation or reset spent allowances to meet a budget. Public adoption and maintenance scheduling stay held; raw-store Free capacity, private recovery/offload, parser security and qualified activity/prospective scoring remain separate open work.

The existing `build-score-read-pages` / `score-read-pages` commands and guarded local admin routes are unchanged. Migration 0046 is exercised only in isolated fixtures; ordinary migration-aware startup is the activation path. No live migration, restart, provider request, source counter/reset, paid service, public feature exposure or deployment occurred.

**194 distinct tests** cover unchanged browse/history/expiry, scoring v1–v4, concern/runner controls, election/replay and security, plus fifteen serving tests including six new incremental cases: zero/single-change writes, fresh cutoffs and temporal boundaries, corruption repair/mixed-cutoff rejection, rollback, expiry without source deletion, migration byte preservation/explicit rebuild. Worker typecheck and final preservation/secret/security/thesis-only checks are recorded before commit. Current v4, all original evidence/action/election/financial/provider gates and thesis-only production remain unchanged; outstanding dependency audit findings remain open.
