# Second-hop funding evidence

20 October 2026, Australia/Sydney. Local Worker and local D1 only; existing free public RPC. No deployment, remote migration, paid service, signer or transaction broadcast. [Review second-hop analysis locally](https://app-local.10x.meme/token/solana/3mmewUcttCpSJwVx9BcquZNmwEfJs4nZpKfTDXdipump#second-hop).

## Behavior

The new analysis follows **source → direct funder → signed creation wallet or verified early buyer**. Both legs must be positive, top-level, directly signed System SOL transfers from successful finalized transactions. Each leg retains its signature, slot, instruction index, time, raw lamports and normalized transaction hash. CPI/rent/non-transfer instructions, unsigned sources, failed transactions and cycles cannot establish a path.

The downstream leg must already qualify as funding before a signed creation or a canonical sampled buy. Buyer targets must have a verified buy in the creation slot through creation +20 slots. An unsigned declared creator is not a developer identity. Outflows are selected only from first-hop retained records; second-hop discovery cannot recursively create new scan targets or expand the graph past depth two.

The upstream leg must precede the downstream leg by at most one hour. Separate transactions require strictly earlier slots; transactions in the same slot have no assumed order. Two transfers in the same transaction require the upstream top-level instruction to come first. Each transfer is checked separately, preventing an earlier identical transfer's eligibility from being borrowed by a later instruction after the buy.

These are **ordered transfer sequences**, not proof that the same coins passed through. The intermediate wallet can have other balances and sources. Amounts are not allocated, summed into a taint score, or labeled as developer-controlled funds. Common sources may be exchanges or sponsors. Common control, bundle membership, intent and fraud remain unknown. No wallet ban or new adverse eligibility rule is based on these paths.

Two transparent signals are supported: a signed creation wallet transferring through a funder to an early buyer (observed sequence), and a shared upstream source reaching separate creation and buyer funders (coordination heuristic). Synthetic regressions cover both; no unsupported real developer connection is claimed.

## Bounds, progress and gaps

- Existing **18 RPC requests/tick**, **800 wallet requests/day within the 5,000 global cap**, pause, lease and provider backoff remain unchanged.
- First-hop progress uses a 14-call ceiling to leave room for second-hop work. Cached replay reads do not make provider calls. Second hop can use only the remaining total allowance.
- At most four eligible direct funders are selected, with creation-wallet funders prioritized, then deterministic address order. Each uses one outflow anchor chosen by earliest sampled slot, signature and instruction index. Other outflow windows can be missed.
- At most one pending second-hop funder advances per tick: one 50-reference page and up to three transaction reads, subject to the total RPC cap. Per-funder limits remain three pages and 12 examined transactions. Work resumes and rotates across pending funders.
- Migration `0008_second_hop.sql` keeps second-hop progress separate from first-hop progress. Its key includes the precise outflow signature and instruction index, so discovering another outflow in the same transaction cannot mix cursors. Hash-checked progress is saved after each successful page/read.
- Graph decoding stops at 512 eligible transfer edges per extraction; larger inputs fail closed with a visible source error and retained last-good analysis. Output is capped at 50 distinct paths with an explicit truncation gap. Existing 64-record / 900 KB transaction snapshot and 1.8 MB total evidence bounds remain.

Coverage is reported separately for each funder, anchored before its observed outflow. A dated older boundary plus every returned successful finalized in-window body is required for “returned window examined.” Missing/unsupported bodies, null dates, provider-ended history, pending work, capped expansion, ambiguous same-slot order and excluded cycles remain explicit. No third hop is scanned. First-hop creation/holder gaps are preserved. Second-hop partial history does not silently become complete because an observed path exists.

`wallet-input-v3` and `wallet-signals-v3` retain raw second-hop scans, coverage and paths. V1/V2 fixtures still replay exactly. Public reads use cached local D1 and cannot request arbitrary wallet scans. No relay read-method expansion or new credential was needed. Existing `TENX_WALLET_ANALYSIS_ENABLED` and `TENX_WALLET_RPC_DAILY_LIMIT` remain the toggles. The existing local supervisor/timer automatically loads the Worker change; source refresh was resumed after migration.

## Observed evidence

The committed real `second-hop-evidence.json` fixture was captured at **2026-10-20T02:39:14.738Z**. It contains 18 sequences: three upstream sources into one direct funder, followed by that funder's transfers to six verified early buyers. All 18 sequences are the three-by-six combinations of retained observed edges, not 18 independent source payments. Amounts on the two legs differ and are shown separately.

Two direct funder histories are retained. Each has 50 returned references and three examined in-window bodies; both remain **partial**. The sample does not establish an upstream path to the creation wallet or a shared upstream developer/buyer source. Original direct-funding and creation-history gaps remain.

Two local collection ticks succeeded with eight RPC requests each. A subsequent tick received HTTP 429 after four requests. It retained the last-good snapshot and persisted the existing five-minute backoff; manual refresh cannot bypass it. Free-provider throttling is a real coverage constraint, not a reason to buy a service or conceal stale data.

After backoff, two bounded ticks succeeded with five and seven requests. At 02:45:56 UTC the local service was unpaused, had no wallet source error, and had used 73 of its 800 daily wallet requests. Automatic paced refresh remains active. The latest cached analysis had expanded to 36 sequences; the historical fixture above remains unchanged.

## Files and checks

Changed: `second-hop.ts` and tests; funding-history collector/options/progress tests; migration 0008; versioned wallet models/replay/cycle; the retained local eligibility coverage check; research fields for path counts and examined second-hop windows; token wallet UI/reason labels; generated OpenAPI; recorded real fixture; operating/review notes. Research features freeze only evidence known at their baseline. Rules remain review-only; old snapshots are not backfilled with later connections.

```powershell
pnpm --dir discovery exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-local.ts
git diff --check
```

Offline regressions cover ordered same-transaction transfers, same-slot ambiguity, cycles, stale/late inflows, signer/CPI/failed-transfer rejection, forged anchors, history-slot mismatches, missing bodies, exact-outflow progress isolation, reserved request capacity, edge/funder bounds, shared dev/buyer upstream heuristics and exact real replay. All 108 discovery tests and 773 app tests passed, as did typechecking. The local smoke check replayed three holder and three wallet snapshots with zero provider requests. App build includes typechecking and the performance budget. The second-hop token view was also checked in the local browser.

Next: evaluate whether these sequences add predictive value after controlling for coverage and known exchange/sponsor activity. Improving the usefulness of existing paths is preferable to unbounded traversal. Deeper ancestry, coin provenance, complete wallet histories and automatic fraud labels are not implemented.

Primary API references checked: [Solana signature paging](https://solana.com/docs/rpc/http/getsignaturesforaddress), [transaction JSON and instruction/account structures](https://solana.com/docs/rpc/json-structures), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). Chain observations come from the committed RPC-attested fixture, not third-party wallet labels.
