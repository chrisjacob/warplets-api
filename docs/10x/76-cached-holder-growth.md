# Cached owner changes and endpoint retention

21 October 2026 (Australia/Sydney). Continue the [authentic daily-attention plan](70-authentic-attention-momentum.md) after [GMGN candle coverage](75-gmgn-candle-coverage-and-units.md). This adds descriptive owner-history evidence using existing saved inventories. Current score-v4, all provider allowances and evidence/action/election gates remain unchanged. No deploy.

## Implemented

The existing `tenx_holder_evidence` archive already retains full owner-inventory inputs from normal collection. The [history reader](../../discovery/src/holder-history-store.ts) now selects the first and latest two saved snapshots within the preceding 24 hours. It adds no scan, collection timer, migration, database write, research record or provider call. This is an ex-post comparison of actual archived observations, with a frozen selection manifest; it does not fill or enrich an older score cohort.

Each selected snapshot verifies its original payload hash, mint/slot metadata, canonical pool/vault, supply reconciliation and account layouts through the existing holder analyzer. All token accounts are aggregated by owner from the full raw input. The public top-owner list is never used to reconstruct the population. Original JSON field order and retained RPC fields are preserved for old receipt hashes; the original analyzer and archived evidence remain unchanged.

Two comparisons are available: first retained snapshot → latest, and the latest two snapshots. Each reports actual dates/slots, positive-balance owner counts, entrants, exits, net change and owners present at both endpoints. Raw growth and endpoint-retention percentages require a positive starting denominator. An evidenced zero baseline permits an absolute delta with undefined percentages; a missing baseline stays unknown.

Partial/uncertified inventories, supply/program/pool changes, non-advancing slots and timestamp conflicts hold affected comparisons. No inconvenient selected snapshot is skipped. Future or out-of-window manifest entries, altered hashes, missing selected inputs and malformed accounts fail verification. Snapshots older than thirty minutes remain visible as dated history with a stale warning. Presence at both endpoints does not establish uninterrupted holding between them.

Read bounds are **96 metadata records**, at most **three full snapshots**, **3 MB per snapshot** and **9.1 MB per input manifest**. A 97th record holds the comparison rather than silently choosing a favorable subset. Oversized selected evidence fails visibly. Existing archived rows are retained; this milestone sets no deletion/compaction policy or new collection/storage allowance. That archive policy and future indexing remain release follow-ups. The reader uses bound statements through the existing [D1 binding](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).

## Qualification remains open

**Meaningful holder growth, exact trailing-24h growth and since-creation growth remain null.** Every selected inventory's voluntary-acquisition provenance is explicitly unknown. Tiny positive balances, unsolicited dust/airdrops and addresses sharing a controller can therefore increase the raw count without earning authentic-demand or score credit.

No balance threshold or market-price shortcut is approved here. Independent acquisition evidence, economic-balance rules, continuous retention, beneficial-owner relationships and prospective calibration remain required. Archived times are collector timestamps rather than exact block times. The collector requests finalized RPC data, but the historical payload alone does not independently attest its request commitment; this view grants no additional finality or action certification. A 24-hour search window does not turn a shorter observed interval into 24-hour growth or imply a zero creation baseline.

## API, UI and replay

- `GET /api/10x/holders/history/solana/:address` returns aggregate snapshot metadata, two raw comparisons, gaps and hashes. It exposes no new owner-level balance list.
- Authenticated `GET /api/10x/admin/holders/history/solana/:address` additionally returns the selected full inputs and bounded metadata manifest for private offline replay.
- Token pages have a collapsed **Holder growth & retention** disclosure. It fetches only saved evidence when opened, labels raw changes and unknown qualification, and retains the last response with an error if refresh fails. No source-refresh control or visitor-triggered provider IO.

Repository-root operator commands:

```powershell
pnpm exec tsx scripts/discovery-holder-history.ts read MINT
pnpm exec tsx scripts/discovery-holder-history.ts freeze MINT
pnpm exec tsx scripts/discovery-holder-history.ts replay FILE
```

Freeze verifies the report and writes a new, uniquely named ignored `.tmp` artifact. It never overwrites an older file. Replay bounds the supplied regular file, loads no credentials, makes no network request and checks the complete input/report hashes. Hash integrity is not independent provider authentication or proof of organic acquisition. The operator uses fixed loopback URLs, the existing ignored admin token only for private export, manual redirects and bounded responses; credentials are not printed or exported.

## Live PONYX verification

The frozen comparison at **08:39:28.533 UTC** has **eleven** archived records and three selected, supply-reconciled/layout-certified snapshots:

| Saved collector time UTC | Inventory slot | Raw owners | Original receipt hash |
|---|---|---|---|
| 02:58:51.912 | 459470870 | 2,005 | `721f02e1f224535d4166359fac0afcc8b61c83dbf1e394cd7f00d0ba28677f18` |
| 07:42:02.868 | 459549584 | 2,007 | `76bb3d891b1c84518e1c3fc84139898fea83be40a514edd200c2731328ae6dba` |
| 08:11:23.137 | 459557729 | 2,007 | `3b814000c625ec8ce47dd8f71bddc53754f9262b34d1cd4986a275085c29ab8d` |

Across **5.21 hours between snapshots**, three owners entered and one exited: **net +2**, raw growth **0.09975%**, with 2,004 starting owners present at the final endpoint. The recent **29.34-minute** interval has zero entrants/exits and no net change. These counts do not qualify the entrants as voluntary buyers or validate the original distribution.

Private artifact report hash **`d38146a0dd9a1ba296b059114ef623c15de3bb82e9adf5738e20ecfb9dd464b2`** replayed offline. Live reads/export and offline replay report **zero provider requests and zero database writes**. Later live reads can have a different cutoff/selection; the frozen artifact retains its original observations.

## Completed and remaining

- [x] Versioned bounded cached snapshot selection, full-owner replay, raw deltas and endpoint retention.
- [x] Aggregate UI/API, private freeze/replay, zero/missing/negative cases and adversarial dust/incomplete-evidence checks.
- [ ] Establish prospective acquisition provenance and validated meaningful-balance/retention rules; set an explicit archive storage/retention policy.
- [ ] Collect comparable genuine 24h/since-creation boundaries and qualified volume without inferring historical zeroes or scaling short intervals.
- [ ] Complete independent GMGN trade/canonical-scope corroboration and representative prospective attention-model comparisons before adopting a new score version.
- [ ] Restore bounded research admission and complete all existing release gates before production. No deploy or financial authority is granted.

## Validation

- **50 Discovery tests** passed across holder history, the original holder analyzer and GMGN integration/gate regressions. Coverage includes a recorded real inventory, preserved RPC JSON fields, full-owner aggregation, dust entrants, exits/negative growth, zero/missing baselines, partial/legacy layouts, changed supply, non-advancing slots, timestamp conflicts, future data, archive/byte bounds, tampered input/report hashes, authentication and zero IO/writes.
- **92 Discovery UI tests across seventeen files** passed. The four holder-history tests additionally passed after the final interval/plural wording correction. Browser QA showed the actual PONYX inventories, net +2 raw owners, endpoint retention, unknown meaningful growth and correct stale warning. Local proof: `.tmp/holder-history-ponyx.png`.
- Discovery/app typechecks, regenerated OpenAPI, app build and existing performance budget passed. Home startup remains **234.1 KiB gzip across eleven chunks**. Existing dependency annotation warnings remain non-fatal.
- The real private PONYX export replayed offline to the original report hash. Preservation checks used streaming per-row digests over the large existing archive: all **170 original score cohorts, zero outcomes, 34 completed source receipts and 766 holder receipts** remained unchanged. Foreign keys passed. No migration, quota reset or archival rewrite.
- Actual query-key scans passed across **twenty task files and 72 built assets**; secret files remain ignored/untracked. All **401 local Markdown targets across twenty documents** resolved; whitespace checks passed. Unrelated Network and legal work is excluded from this milestone.

Commands: `pnpm --dir discovery test src/holder-history.test.ts src/holders.test.ts src/gmgn.test.ts --testTimeout=30000 --maxWorkers=1`; `pnpm --dir discovery exec tsc --noEmit`; `pnpm --dir app test src/discovery`; `pnpm --dir app test src/discovery/HolderHistory.test.tsx`; `pnpm --dir app build`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; the read/freeze/replay commands above. Local ignored helpers checked immutable-row digests, credentials and documentation targets. No deploy.
