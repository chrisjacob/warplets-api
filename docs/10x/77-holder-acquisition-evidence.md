# Cached signed acquisition evidence

21 October 2026 (Australia/Sydney). Continue the [authentic attention plan](70-authentic-attention-momentum.md) and [cached holder history](76-cached-holder-growth.md) by checking whether new balance owners have matching signed buys in saved evidence. This is descriptive sample evidence. Meaningful growth and organic demand remain unqualified; current score-v4 and all provider/evidence/action/election gates remain unchanged. No deploy.

## Implemented

The [cache reader](../../discovery/src/holder-acquisition-store.ts) selects the latest saved wallet receipt within the holder-history cutoff's preceding 24 hours, plus two metadata headers to detect timestamp conflicts. It never substitutes an older favorable receipt. It reuses the bounded first/latest full owner inventories and their original hashes. No migration, collection schedule, RPC/provider query, research record or database write is added.

The [reviewer](../../discovery/src/holder-acquisition.ts) verifies both the original normalized wallet-evidence hash and a raw-input hash. This preserves legacy semantic receipt hashes while detecting changed exported bytes after JSON parsing. Original holder receipt field order and extension fields remain intact; archived v1 history replay is unchanged. Hashes establish integrity, not independent source authentication.

For each actual inventory interval, a supported entrant must:

1. Be absent from its starting positive-balance owner population and present at its end. Existing owners buying again are not new entrants.
2. Have a parsed buy signed by that owner, bound to the exact canonical mint/pool and matching token program. Slots must be strictly after the starting inventory slot and no later than its endpoint; block times must also lie within the saved collector interval.
3. Have matching available transaction evidence and finalized signature-history rows with matching slot/block time, no error and no future receipt times. Conflicting matching rows fail support. Saved RPC metadata is not independent finality attestation.
4. Have positive known quote flow and no sampled sell in that interval. A two-sided sample is excluded from this conservative support count without alleging wash trading.
5. Have transaction-wide net base acquisition equal to the summed parsed buys. Count the net once per wallet/signature, including multiple buy instructions; reject nonpositive or mixed transfer flows.
6. Retain an endpoint balance at least as large as that sampled acquisition. This does not establish uninterrupted holding or the origin of every token in that balance.

An unmatched entrant has **unknown acquisition**, not a proven dust transfer, airdrop or scam. A matching tiny buy still establishes no economic significance or independent beneficial owner. All meaningful-growth/organic qualification stays held. No completeness is inferred from a finite transaction sample, and no later source observation enriches an earlier score cohort.

Missing receipts, conflicting latest timestamps, held owner comparisons and truncated wallet trade output hold affected support counts. Missing support is null rather than zero buying; a valid sample with no matches reports zero matches and preserves unknown population coverage. Stale sources remain dated historical evidence with visible warnings. Future, wrong-scope, malformed, oversized and changed-hash inputs fail verification.

Work is bounded by the existing history manifest (96 metadata rows and three inventories, 3 MB each), two wallet headers, one **1.8 MB** wallet body, its existing **64 transactions / 100 output trades**, and **11 MB** total input. The reader uses bound [D1 statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/). It neither changes archive policy nor waives any existing Free quota, pacing, backoff, source admission or evidence gate.

## API, UI and replay

- Public `GET /api/10x/holders/acquisition/solana/:address` returns aggregate counts, dates, exclusions, gaps and hashes. No new owner-level list is exposed.
- Authenticated `GET /api/10x/admin/holders/acquisition/solana/:address` additionally returns bounded frozen inputs for private replay.
- Token pages have a collapsed **Holder acquisition checks** panel. Opening it reads the cache; failure leaves the separate raw-holder panel available. The last matching response remains visible with an error on a failed refresh. There is no provider-refresh or financial control.
- [Operator](../../scripts/discovery-holder-acquisition.ts): fixed loopback transport, ignored admin credentials only for export, bounded response/file reads, manual redirects, unique ignored artifacts and complete offline input/report verification. Replay loads no credentials or network.

```powershell
pnpm exec tsx scripts/discovery-holder-acquisition.ts read MINT
pnpm exec tsx scripts/discovery-holder-acquisition.ts freeze MINT
pnpm exec tsx scripts/discovery-holder-acquisition.ts replay FILE
```

## PONYX cache result

The initial read at **09:00:37.819 UTC** compares the same 02:58:51.912 → 08:11:23.137 inventories documented in milestone 76: three entrants, one exit, net +2 raw owners. The latest wallet sample is from **04:47:18.779 UTC**, with ten transaction records and original hash `ef036641dcba37bab09d00afdc6664bb25712b375458095493acdda55bb1d55f`.

Five parsed interval trades have five matching finalized signature-history transactions. None belongs to the three entrants: **zero sample-supported entrant buys, three acquisition-unknown entrants**. This does not mean that no entrant ever bought; population coverage is unknown. The latest inventory interval has no raw entrants or sampled trades. Both source types are stale at review time. Meaningful/daily growth stays null and no score or fraud conclusion follows.

The private frozen acquisition report replayed offline to hash **`949b1eba970d0f195aaa086b25003bb81793fe101b95a1690252c151b3513bac`**, with the same counts and zero provider requests/writes. The previous holder-history artifact still replays to **`d38146a0dd9a1ba296b059114ef623c15de3bb82e9adf5738e20ecfb9dd464b2`**. Later live cutoffs may produce different report hashes; each artifact retains its own selection and dates.

## Completed and remaining

- [x] Bound cached owner-to-signed-buy matching, explicit conservative exclusions, public aggregates and private freeze/replay.
- [x] Preserve unknown acquisitions, missing-versus-zero semantics, actual observation windows, archived hashes and zero IO/writes.
- [ ] Establish sufficient prospective acquisition coverage, economic-balance rules, beneficial-owner relationships and retention controls before qualifying meaningful growth.
- [ ] Obtain comparable real 24h/since-creation boundaries and qualified activity volume. Never extrapolate short intervals or assume a zero launch baseline.
- [ ] Complete independently corroborated GMGN trade/canonical-scope evidence and representative prospective attention-model comparisons before an explicit new score version.
- [ ] Resolve archive storage/retention policy and remaining source readiness. Restore bounded research admission and complete existing release gates before production.

## Validation

- **73 backend tests** passed across acquisition, original holder-history replay, wallet verification and GMGN gate regressions. Cases include multiple buy instructions, missing history, unknown quote flow, mixed transfers, two-sided activity, endpoint balance insufficiency, unsigned/out-of-window trades, future/conflicting history, wrong scope, timestamp/hash conflicts, bounds, truncated output, private authentication and unchanged database writes.
- **96 Discovery UI tests across eighteen files** passed, including four acquisition tests for supported/unknown/held states, stale evidence and collapsed controls.
- Discovery/app typechecks, regenerated OpenAPI, app build and performance budget passed. Home startup remains **234.1 KiB gzip across eleven chunks**. Existing dependency annotation warnings are non-fatal.
- Local browser QA verified the actual PONYX counts, stale-source warnings and unknown-growth qualification. Screenshot: `.tmp/holder-acquisition-ponyx.png`. New acquisition and original history artifacts replayed offline to their hashes above.
- Read-only streaming per-row digests confirmed all **172 original score cohorts, zero outcomes, 34 completed source receipts, 776 holder receipts and 71 wallet receipts** unchanged. Foreign keys passed. The existing collector continues independently; no counter reset, migration or archive rewrite.
- Actual query-key scans passed across **21 task files and 72 built assets**. Both secret files remain ignored/untracked. All **412 local Markdown targets across 21 documents** resolved; whitespace passed. Unrelated Network/legal work remains excluded.

Commands: `pnpm --dir discovery test src/holder-acquisition.test.ts src/holder-history.test.ts src/wallet.test.ts src/gmgn.test.ts --testTimeout=30000 --maxWorkers=1`; `pnpm --dir discovery exec tsc --noEmit`; `pnpm --dir app test src/discovery`; `pnpm --dir app build`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; read/freeze/replay above. Ignored local helpers checked immutable-row digests, credentials and Markdown targets. No deploy.
