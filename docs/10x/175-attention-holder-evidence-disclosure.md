# Holder participation evidence in the attention shortlist

23 October 2026, Australia/Sydney. Continues [174](174-explicit-follow-up-observation-comparison.md) and the existing qualified-holder sample policy. No deploy.

## Delivered

- [x] Add an on-demand acquired-and-retained holder disclosure to the fixed attention token detail. Solana only; unsupported chains remain explicit. Collapsed rows and unsupported chains make no report requests. No shortlist-wide fan-out, timer, wallet scan, provider request or collector invocation.
- [x] Add read-only local GET `/api/10x/discovery/attention/holders/solana/:mint?cutoff=:canonicalISO`. Require one exact cutoff parameter and a valid Solana address; reject missing, duplicate, extra, invalid, noncanonical or future inputs before database access. Existing local-runtime and foreign-browser protections apply. Saved source failures return a fixed 503 response without exposing private inputs or repairing evidence.
- [x] Replay the existing holder participation policy through the existing acquisition/history readers, with their original selection, row, byte, time, hash, source and qualification bounds. Do not compute unrelated trade-sample projections. The exact shortlist cutoff controls source selection; later inventories and wallet receipts cannot enrich that snapshot.
- [x] Verify the report and policy checksums in the browser and bind it to the exact mint/cutoff. Reject simulations and foreign results. Abort on collapse, identity/cutoff changes and unmount; cancellation is silent. Ignore nested disclosure toggles. A failed read preserves only a previously verified matching report; a different cutoff cannot show that prior report.
- [x] Show first/latest and recent inventory intervals, raw entrants, supported signed net-buy entrants, screened retained entrants, partition/gap explanations, source dates and report checksum. Retain the experimental 0.01 SOL / 30-minute endpoint-retention checks and all uncertainty boundaries. Unknown is distinct from zero; meaningful 24h growth, independence, continuous retention, organic demand and safety remain unverified. No score credit.
- [x] Keep the report separate from the archived personal review context/ledger. The disclosure says it is not included in the saved review snapshot. Opening it does not change a draft, review, rank, cohort or launch state.

## Ordinary local read

At 19:03 UTC on 22 October, the first Solana token in the ordinary loaded attention shortlist returned HTTP 200 at that list's exact cutoff (`2026-10-22T19:03:14.873Z`). The report hash was `d903848651e5052a1274251abbbd8a1298e16853813a6688cd3b8ac87d61a3d4`. It matched a separate replay using a read-only local SQLite connection and two archive-index reads. There were no retained inventory receipts or wallet receipt for that subject, no comparable intervals and unknown freshness. Meaningful 24h growth stayed null and organic demand false. No provider request, source collection, database write, retry or quota/backoff reset was performed.

This is one coverage observation, not a market-wide missingness estimate or token verdict. It shows that an attention lead can lack the archives required for qualification. Do not label that token clean, organic or adverse on this basis. The browser's supported/zero/missing examples are separately synthetic policy controls.

## Verification and release boundary

Full backend passed 1,596 tests / 108 suites; Discovery UI passed 233 / 44 suites. Added endpoint tests cover exact legacy-policy replay, no writes/IO, no private inputs, future-source exclusion, missing archives, strict admission, invalid identity/clock, foreign-browser denial and corrupt-source hold. Browser checks passed keyboard opening, zero collapsed requests, one request per opening, nested-toggle isolation, retained matching results after errors, valid foreign-identity rejection, silent cancellation, unknown-versus-zero, cutoff mismatch and unsupported-chain isolation. Desktop/mobile/320px screenshots were inspected without document/detail overflow. These are targeted workflow checks, not production CPU or usefulness acceptance.

Both typechecks, final build/performance budget, thesis-only release guard, security preflight and historical evidence/private-artifact preservation are checked before commit. Current Workers guidance and published types 5.20261022.1 were checked. No dependencies, configuration, migration, provider allowance, source limit, collection policy, evidence/review format, scoring threshold or action/launch gate changes. No manual runtime restart or deploy. Production remains thesis-only. On-demand replay still consumes bounded database/CPU work; this does not close [149's Free serving acceptance](149-native-builder-and-combined-free-budget.md).

## Next priorities

Design a small preregistered holder-observation subset from the attention source union, including unfamiliar and negative controls, with explicit RPC/storage costs inside the existing Free allowances and source admission. Determine how those leads enter the verified candidate/holder pipeline; do not infer coverage from this one read or collect every visible token automatically. Preserve original unknowns and timestamps. Continue real prospective founder decisions and mature follow-ups, authoritative completed-ATTN exclusions, the larger-holder versioned-reference assessment from 173 and serving 149 acceptance. No score adoption follows from exposing these saved samples.
