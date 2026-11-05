# Protocol fixture status

Reviewed **5 November 2026**. This report records disposable local simulations and public, read-only observations. No production funds, signing service, deployment or production-state changes are part of the evidence.

## Current CI result

[10X captured program parity — run 42006472697](https://github.com/chrisjacob/warplets-api/actions/runs/42006472697) **passed** at commit `bee8e1de2f533befdbda313fd04aa5c516fd841f`, finishing at approximately **09:56:44 UTC**. The latest relevant run was inspected directly through GitHub's completed job log. This is an assertion result for the fixtures, not approval to launch the candidate protocols.

The job used Ubuntu 24.04, the pinned October dependency reference `6dc1b72b41fd1fb7f35f9db26ffef8285199c5ef`, a frozen dependency installation with lifecycle scripts disabled, and read-only repository permissions. Kamino, Rewards and Core binary retrieval used public account reads; every transaction executed in the disposable simulator with local test keys. Four stored-evidence tests passed, and each of the four executable replay steps completed successfully.

| Fixture | Observed result | Compatibility conclusion |
| --- | --- | --- |
| Meteora DAMM v2 | 800,000,000,000 ATT base units funded liquidity; the fixture used one raw OG base unit and permanently locked its prepared liquidity. A buy before activation was rejected; buy and sell paths executed afterward. | Opening fee and tested pool initialization are executable. The one-unit seed is a mechanics fixture, not a recommended market price or sufficient launch budget. |
| Kamino Farms | Of 864,000,000,000 gross funded units, 777,600,000,000 accrued to the user and 86,400,000,000 were idle and recovered. The normal path returned 100 principal, supported harvest while staked and immediate withdrawal/re-stake, and used zero harvest fee in its simulated global config. | Whole-unit continuous emissions are demonstrated. Unrestricted administrative custody fails the product requirement: the existing counterexample let the administrator remove 10 of 100 staked units, leaving 90 for the staker. |
| Foundation Rewards | Zero vested at the 24-hour cliff; 50 of 100 vested at hour 36; the remaining 50 remained claimable at day 800. Admin revoke and early close attempts were rejected. | Suitable to continue evaluating for wallet-bound Earn. A directly wallet-bound leaf does not transfer with an NFT: the buyer failed and the seller retained the claim. |
| Core asset signer + Rewards | A reserve of 100 was committed before mint; the original owner claimed 30, transferred the Core asset, and the buyer claimed 70. The former owner was rejected. The 14-sibling proof fit a 1,002-byte atomic v0 payout. Three Core Execute charges totaled 146,160 lamports. | Existing programs can compose NFT ownership with vesting in this fixture. Mint assignment, plugin configuration, external burn policy, metadata changes, proof availability, cost and physical-wallet compatibility remain release gates. |

For Meteora's sampled one-million-unit OG buys, protocol fee deltas were **180,000 / 178,000 / 120,000 / 60,000 / 4,000 / 2,000 / 2,000** at seconds **0 / 1 / 30 / 60 / 88 / 89 / 90**. These are the protocol's 20% share of the trading fee in the tested collection mode, not the full trading fee. The independently decoded SDK scheduler agrees with the domain's 90%-to-1% schedule through every tested second; second 89 is already at the 1% floor.

## Existing authority and asset-policy results

The earlier [run 42005579163](https://github.com/chrisjacob/warplets-api/actions/runs/42005579163) failed an experimental expectation that setting an Oracle adapter's own authority to None would prevent its removal. The completed run above correctly records the actual behavior: the asset's update authority can remove the adapter and then burn the asset. That compatibility problem remains; a green fixture does not resolve it.

The completed run also confirmed the following already-implemented cases:

- Burning an ordinary Core asset succeeded; its asset signer could no longer spend, stranding the fixture's remaining one unit.
- A previous owner with an existing SPL token-account delegate could spend from that persistent account independently of current Core ownership. The tested payout instead uses a fresh temporary token account and atomically claims, transfers the exact amount to the current owner, and closes the temporary account.
- An experimental shared frozen Oracle record and deliberately unreachable asset update authority rejected owner burns, missing-Oracle attempts, owner removal and former-issuer removal while permitting a normal transfer. The shared record's observed rent was 1,097,280 lamports. Relinquishing update authority also restricts metadata changes; this is not yet a compatible production policy for refreshes, Level changes or collection administration.
- A separately minted permanent burn delegate could force a burn despite the veto. Actual asset and collection plugin allowlists therefore matter. The fixture does not establish marketplace escrow or every collection combination.

No new authority or security probes were added during this status review.

## Dated binary observations

The November 5 Meteora observation in [`meteora-deployment-observation.json`](../lab/fixtures/meteora-deployment-observation.json), taken at **09:50:37 UTC**, finalized slot **465661024**, matches the preserved October replay binary digest `967ff9fb161eec2e62f66d2c899100739fb747c445f697b8625c86b31b9a2022`. Deployment slot remains `457080014`. The digest comparison was checked locally during this review. This metadata observation was separate from run 42006472697; that replay still labels its own live parity as unverified. It proves a dated observed digest match, not continuous monitoring or source-to-binary equivalence.

The completed run refreshed the other public program observations and verified the pinned digests before local execution:

| Program | Public observation UTC | Finalized context slot | Deployment slot | Allocated ELF SHA-256 |
| --- | --- | --- | --- | --- |
| Kamino | 09:56:37.384 | 465662709 | 444035168 | `67c4a989342024efedf6181c1d91cf6aac2bb2bcd17f43b8848c9f3d8ba21011` |
| Rewards | 09:56:39.597 | 465662723 | 422571636 | `cd1c6572a0eb8681460e0eb6748d5b82ec1173326f79d412bb608b808b44ef71` |
| Core | 09:56:41.223 | 465662730 | 455005931 | `51d41542456639a01820c747e72b9d3b4ca258930a5bbb7e78db0cda133dc209` |

These deployments are upgradeable. Reviewed source correspondence to the deployed binaries has not been established. A dated executable replay does not prove that an audit covers the exact deployed binary. Kamino's inspected BSL 1.1 source has no additional-use grant and a 17 November 2027 change date; any production use needs appropriate licensing review. The lab does not vendor that source. See the source and license links in [Kamino](../lab/KAMINO.md), [Rewards](../lab/REWARDS.md) and [Core](../lab/CORE-VAULT.md).

## Pending compatibility decisions

1. **Stake administration:** enforce principal protection and funded-emission policy while retaining required campaign upkeep. A UI restriction or currently empty withdraw-authority field is insufficient.
2. **Farm precision:** the successful curve used 1,000,000 whole reward base units per second. Arbitrary supply/decimal combinations, fractional-rate rounding and refresh frequency are unproven against the exact rational economics model. The selected global configuration's fee must be read again; observed zero-fee configurations do not guarantee future zero fees.
3. **Permanent claims:** the Rewards fixture uses the maximum signed 64-bit clawback timestamp. This is practically unreachable, but the format has a finite timestamp, not a native permanent flag. Independent proof availability and exact funded roots remain necessary.
4. **NFT policy:** resolve secure reserved slot-to-asset commitments, fair delayed reveal, externally initiated burns, required metadata changes, collection authority and marketplace custody before accepting the Core composition. The experimental immutable configuration is evidence, not a product decision.
5. **Quote parity:** the existing Meteora replay verifies executed swaps and sampled fee deltas. It does not retain each immediately preceding serialized pool state paired with a fresh quote-engine result. The new read-only quote engine therefore needs separate exact-state program/SDK parity evidence.
6. **End-to-end costs:** Core Execute fees exclude network/signature fees, priority fees, lookup-table preparation, claimant-state rent and recipient or temporary token accounts. Kamino rents are dated per-account observations, not a complete launch quote. Current SOL/USD and retry costs remain external inputs.
7. **Client operation:** physical desktop/mobile wallet signing, lookup-table freshness, marketplace ownership lookups, reconciliation after ambiguous receipts and current selected program/configuration evidence remain required. No live deployment or funded pilot is authorized by this report.

## Independent economics review

The current [`platform/domain/economics`](../domain/economics/) implementation and its eight existing tests were reviewed without edits. Running `node --test platform/domain/economics/*.test.mjs platform/lab/*.test.mjs` passed **12 tests, zero failures** locally on November 5.

The ordinary-range invariants are internally consistent:

- The positive-u64 supply constraint and multiple-of-200 requirement make the 80/10/5/2.5/2.5 budgets and ten equal Earn allocations exactly representable. When no Season weight is active, the combined 5% Vault budget goes to Genesis without altering total supply.
- Genesis cumulative-range rounding telescopes across all 10,000 reserved slots, assigning every base unit exactly once. Each slot differs from its proportional floor by at most one unit. Season snapshots apply the same conservation rule to a copied, deterministically ordered denominator and include all reserved positions.
- Vault cumulative vesting is zero through hour 24, linear over the following 24 hours and complete at hour 48. Partial claims subtract from a cumulative allocation, so ownership changes do not restart the arithmetic clock.
- The farm reference model clamps issuance at the ten-day end, keeps idle emission distinct from earned claims, and retains fractional residues. Harvest fees use the difference of cumulative floors, so more frequent harvests cannot reduce the total hypothetical fee.
- UTC Season expiry adds Level calendar months to the original start, clamps month-end dates and preserves time of day. Active windows exclude the exact expiry instant.

An additional temporary, independent arithmetic check compared **600 seeded farm traces** against direct per-wallet interval accounting with a common integer denominator rather than the implementation's accumulated reward index. It covered small and maximum-u64 budgets, zero through 100% hypothetical fees, partial harvests, deposits, withdrawals and idle periods. All matched. The same review checked **48,000 month-end cases** across the Gregorian 400-year cycle, fee seconds 0–100, and sampled maximum-u64 vesting monotonicity at 37-second intervals; all passed. These were review-time checks, not new committed regression tests or protocol probes.

**Minor boundary finding:** `seasonExpiresAt` rejects starts beyond `9999-12-31`, but adding months to an accepted late-year-9999 start can return year 10000. For example, start `253402300799` with Level 10 returns `253428652799` (`+010000-10-31T23:59:59Z`). This exceeds the function's stated supported calendar and the API's normal four-digit RFC3339 year convention. An output-range guard and boundary regression would make that contract consistent. No code was changed in this review. No conservation, ordinary-range rounding or normal launch schedule defect was found.

The reference model remains a specification tool. Passing its arithmetic tests does not establish chain ownership, provider-specific fixed-point rounding, distributed concurrency or claim durability.

The coordinating review subsequently added the output-range guard and regression for the year-9999 expiry boundary. The final supported-year result succeeds and an overflow into year 10000 is rejected.

The subsequent captured-program checkpoint at `4a424af` also [passed in run 42014527352](https://github.com/chrisjacob/warplets-api/actions/runs/42014527352). Its success preserves the compatibility limitations described above.
