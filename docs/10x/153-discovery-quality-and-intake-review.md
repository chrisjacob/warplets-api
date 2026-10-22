# 153 — Discovery quality, market uncertainty and intake repair

22 October 2026. Founder-requested review of the current product against the PRD, superseding the immediate next-build ordering in 148–152 where it puts interface acceptance ahead of discovery yield. All earlier serving, release, evidence and financial gates remain requirements.

## Finding

**The system has material coverage and product-design limitations. Our results do not establish that the market has no good memecoins.** Market conditions could also be weak, but we have neither an independent reference universe nor a prospectively evaluated attention ranking that could separate that explanation from our own missing data.

The product already has useful evidence custody, structural scoring, retained history, comparisons, saved tokens, activity diagnostics and closed-release controls. Its central outcome—finding unfamiliar graduated memecoins with genuine daily attention—remains incompletely delivered. More detailed evidence panels alone do not establish discovery recall or ranking quality. Measure progress through usable unfamiliar graduates per day, observation latency, fresh coverage and later independent outcomes.

## Current measurements

Two **read-only** local snapshots were frozen. Neither fetched a provider, modified the database nor reset any allowance. These are retained pipeline counts, not market-wide denominators or certified source truth.

| Measure | 10:05:33.915 UTC census | 10:18:13.573 UTC aggregate diagnostic |
|---|---:|---:|
| Retained candidates | 572 | 573 |
| Current candidates | 283 | 283 |
| Current candidates without recovered creation time | 182 (64.3%) | 182 (64.3%) |
| Saved creation / graduation within past day | 101 / 105 | 101 / 105 |
| Past-day migration leads | 376 | 377 |
| Past-day leads still unchecked | 271 (72.1%) | 272 (72.1%) |
| Observed signature inbox still pending | 2,397 / 4,934 | 2,391 / 4,934 |
| Recent market cache fields, 180-second cutoff | 19 / 572 retained | 20 / 283 current (also 20 / 573 retained) |

The census also recorded 21 GMGN core attempts across **three already-known mints** that UTC day, with a frozen rotation inventory of 257. Its retained verification reasons included 229 transaction-version failures, 111 missing-history reasons and 71 creation-scan-limit reasons. Reasons can overlap and include historical/expired candidates; these counts are not 411 distinct failing tokens or proof of the present cause of each failure.

The saved 10:04 status had RPC usage 1,626/5,000 and market usage 221/600. Quality used 569/1,800 of its subset; wallet work used 255/800. We were not simply at the top-level daily limits in that snapshot. Scheduling, source errors, repeated work, shared reservations and narrow selection still constrain useful coverage. Increasing limits alone would not repair these design issues.

Private census: `.tmp/acquisition-audit-20261022-153-001/census.json`, SHA-256 **`ce748e88adc7127775bb69568c28334e2cdb67bc10a2fd177e10c504f1f4661b`**. New aggregate audit: `.tmp/discovery-yield-20261022-153-001.json`, SHA-256 **`67ae5c1c2e89824a55d06601cfe7eb5a1a1b33772924285d6f2c4330d67e9d67`**. The background local collector continued independently between snapshots; changing counts are not evidence writes by this review.

## Why discovery underperforms

1. **An intake pagination defect discarded part of the automatic observation interval.** `ingest.ts` requested the newest 30 migration-authority signatures since its previous cursor, then advanced the cursor to the newest returned signature even when the page was full. Any signatures between that page and the previous boundary were skipped by subsequent automatic scans. Declaring coverage non-exhaustive did not repair this loss.
2. **A migration is only the first stage.** Only six inbox bodies and two due leads are considered in an ordinary cycle. The lead queue prefers reported-liquid candidates with missing creation evidence; repeating the same bounded creation scan can displace unfamiliar first inspections. The observed 72% unchecked daily lead share is a real conversion bottleneck, even before judging token quality.
3. **Popular tokens can be harder to verify.** Creation recovery examines a bounded 3,000-signature curve history. High activity, unsupported transaction formats and incomplete archival responses can leave creation unknown. That is a valid reason to withhold origin/action eligibility, but it is not evidence that the token lacks attention. Investigate source/version failures rather than invent a creation timestamp.
4. **The default time window is creation-based.** It hides all 182 current creation-unknown candidates in the measured snapshot. Newly graduated, newly minted, newly pooled and newly observed are different populations. A token taking more than a day to graduate can be relevant to discovery while remaining outside the original first-day action policy.
5. **Current v4 is structural support, not an organic-attention rank.** It scores origin, controls, market snapshots, holders, wallets and limited price performance. Qualified organic 24-hour volume and meaningful daily holder growth are absent from its rank. GMGN candles and activity comparisons remain descriptive with no v4 scoring effect. More GMGN data cannot improve default rank through an integration path that deliberately awards no points.
6. **Collection selection can reinforce missingness.** Market and holder refreshes favour ten already-promising candidates, while richer GMGN rotation studies up to three existing mints/day. This can leave unfamiliar candidates under-observed and low-ranked. It is a selection-bias risk to measure, not a reason to award missing evidence points.
7. **There is no independent market benchmark yet.** Automatic intake centres on a bounded Pump migration-authority WSOL stream. Current richer-source rotation enriches known inventory. A failure to return attractive candidates from that sample cannot support a market-wide conclusion.

Launch heuristics also require caution. Pump's current [synthetic-migration documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/SYNTHETIC_MIGRATION.md) describes a completing buy consuming prospective pool reserves before pool creation, with the resulting pool opening at the price reached by that buy. High opening prices can therefore have a protocol mechanism. This does not exonerate a token or establish organic trading. Preserve frozen v4 pending prospective review; treat early-cap/same-slot concerns as hypotheses with disclosed uncertainty. Retain successful-runner, concentrated-strategic-launch and adverse cases across separate cohorts rather than fitting another universal fraud rule to one example.

## Implemented in this change

**Durable bounded harvest continuation.** Migration **0047** adds a frozen head, continuation boundary/slot, revision, commit identity and authority binding. A full page retains the completed cursor and advances only the saved continuation. A short or empty response closes that interval; subsequent arrivals are requested above its frozen head in the next interval. Equal-slot transaction order is accepted without fabricated lexical ordering. One signature page of 30 remains permitted per ordinary harvest, with the same source calls, pacing, daily quotas and evidence checks.

The batch fences the lease owner, expiry, pause state, old checkpoint, revision and unique commit. All observed signatures, including failed transactions, are checked against retained signature-slot identities; only successful finalized rows enter the inbox. Conflicting identities roll back/hold. Authority changes hold rather than joining two different streams. Original inbox history and completed boundaries remain intact. This prevents future cursor gaps after activation; **it does not recover signatures skipped by the old reader**.

**Activation boundary:** 0047 is staged, **not applied to the live local database**. Existing code on an older schema reports `harvest.state="migration_required"` and holds new authority/global/signature harvesting while retained inbox/lead processing can continue. No restart, live migration or collection was triggered. Apply it only through the ordinary authorized migration/startup/release workflow; no production deployment is authorized here.

**Cache-only yield funnel.** `/api/10x/discovery/yield` returns one transactional aggregate snapshot of inbox, leads, candidates, cache-field freshness and checkpoint readiness. It returns no mint list, signature, cursor, wallet, provider credential or collection permit. Unknown/invalid rows stay in diagnostic denominators. Counts do not replay receipts or validate whole market schemas, do not relax the 500-input ranking limit and do not grant eligibility. The local audit CLI exports/verifies the small private report.

The on-demand Discovery disclosure explains these limitations, reports the separate denominators and links to the existing wider current-inventory view while preserving the user's other view parameters. It reads on explicit opening/refresh, with a timeout, no overlap, unmount cancellation and no polling. Fixtures never display live diagnostics. Default first-day filtering and independent action gates remain unchanged.

**Honest grade semantics.** Cards, score detail, table headings and sort labels now identify **v4 structural support**. Visible copy explains that qualified volume/holder growth are not ranked, missing evidence is not a pass and action gates remain separate. Numeric grades, ceilings, hashes, rank order, policy and source qualification are unchanged.

## Revised build order and success criteria

| Priority | Build next | Evidence of success |
|---|---|---|
| 1 — this delivery | Stop automatic cursor gaps; expose the intake/coverage funnel; correct grade semantics | Bounded continuation/race/authority tests, zero source expansion, explicit migration hold, dated pipeline denominators |
| 2 — next | Fair first-inspection versus repeat-origin work inside existing admission; classify source/version/archival failures; define creation-day and graduation-day investigation cohorts separately | Previously unseen leads reach a first useful inspection; source-limited retries stop monopolising slots; retained failures/unknowns and per-stage latency/call cost remain visible |
| 3 | Independently seeded reference intake through admitted free sources | Frozen source-union overlap and relative recall, missed-token reasons, verification yield, fresh top-20 coverage, and actual shared Free cost; no claim of universal recall |
| 4 | Qualified participation subset and a separate prospective attention view/model | Preregister economic acquisition/retention and organic-volume definitions; raw volume/dust do not become qualified growth; explicit unknowns; frozen v4/provider/hybrid evaluation on unfamiliar and later-day holdouts |
| 5 | Independent UX/accessibility/device/zoom and enabled-route performance/security acceptance | Existing open F2/F5 checks, closed public artifacts and named recovery requirements satisfied before exposure |

For source-union intake, [Jupiter Tokens V2](https://developers.jup.ag/docs/tokens/token-information) supplies category leads and batched known-mint lookup, while its recent endpoint measures **first-pool time**, not token creation. [GMGN's documented completed trenches](https://github.com/GMGNAI/gmgn-skills/blob/main/docs/cli-usage.md) can supply another lead sample; effective platform allow-lists and best-effort result bounds must be retained. These are leads for independent verification, not substitutes for chain evidence or organic-volume qualification. No endpoint was activated and no provider request was made by this review. Existing Free budgets, shared reservations and source admission remain binding.

Freeze a deduplicated daily reference cohort, including unfamiliar, successful, adverse and uncertain cases. Classify misses as unseen intake, outside time scope, awaiting verification, unsupported source, stale/missing enrichment, presentation filter or observed concern. Report provider-union-relative recall, latency, stage conversion, fresh fields and useful unfamiliar candidates per day. Thirty benchmark leads and thirty richly investigated GMGN mints are different budgets: the current three-mint/day rotation cannot investigate thirty new mints in three days. Keep any rich sample denominator explicit rather than promising infeasible coverage or raising limits.

The Free-serving decision in 149 remains **held**. The new diagnostic scans retained candidate fields; its native audit took **813.6 ms wall time** on this local snapshot, including query/parse/locking overhead. Small response size does not imply bounded CPU or acceptable shared production cost. It is on demand with no automatic poll; this is not the production-serving fix, and local wall time is not remote CPU/billing certification. Source-bound v4 input-preparation reuse still requires exact parity, freshness and race proof before adoption. No recovery diversion supersedes the discovery-yield outcomes without a named blocker.

## Validation and reproduction

- **27 harvest tests plus 77 existing intake/service/inbox/mint-review tests pass.** They cover full/empty/short pages, restart, new arrivals, same-slot ordering, authority changes, ownership/lease/pause races, malformed/replayed pages, omitted RPC error fields and conflicts across successful/failed signatures.
- **Four yield tests pass:** date/window and retained/current denominators, corrupt/future inputs, over-500 diagnostic counts without rank admission, local route isolation and no source calls/database changes.
- **161 UI tests across 33 files pass**, including structural-grade semantics, unchanged numeric/hash output and explicit unknown/denominator presentation.
- **Five complete synthetic browser journeys and two recovery checks pass.** Private report `.tmp/discovery-journeys-20261022-153-001/report.json`, SHA-256 `5b237f366fdd758a6b7a87eb647f248639be7e7b12768a8480d4595c990b4ae0`. This is scripted evidence, not independent usability or live ranking validation.
- Discovery/app/audit types, local build, performance budget, thesis-only artifact, security and original research row/foreign-key preservation checks pass. The closed home-shell startup remains 227.8 KiB gzip across eleven chunks, with no enabled-route performance claim. Historical proof/target/journal bytes and actual credential exclusion are checked separately.

```powershell
pnpm --dir discovery test -- src/migration-harvest.test.ts src/service.test.ts src/inbox-recovery.test.ts src/mint-review.test.ts src/discovery-yield.test.ts
pnpm --dir app test -- src/discovery
pnpm study:discovery-yield export --database EXISTING_LOCAL_SQLITE --output .tmp/NEW-YIELD.json
pnpm study:discovery-yield verify --file .tmp/EXISTING-YIELD.json --sha256 PINNED_SHA256
```

Use only an explicitly named existing database, read-only/query-only access and an exclusive ignored output. Preserve the original census, earlier artwork/serving/proof studies and all historical evidence. No paid services, quota changes/resets, score/model adoption, evidence deletion, new token collection, runtime adoption, live migration, restart or deploy. Thesis-only production exposure and all evidence/action/election/financial gates remain.
