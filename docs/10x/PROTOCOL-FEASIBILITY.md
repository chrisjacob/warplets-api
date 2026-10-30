# Launch and distributor feasibility

Reviewed 30 October 2026. **The intended Jito policy is approved. No complete financial configuration has been activated, signed, funded, deployed or executed on a Solana cluster.** The offline lab is deliberately separate from the browser, Worker and production app build graphs.

## Pinned evidence

| Component                     | Reviewed version                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meteora DAMM v2 SDK           | `@meteora-ag/cp-amm-sdk@1.5.1`, registry integrity `sha512-f5jB4cMZ9iA8V+Dtah5I3LvRACyX0TlQkrvD/lxy2SyPf9M8rMK2ViodgCEwTVqyRvyv4JMeK2fGOpDaYwVAug==` |
| SDK source reference          | `MeteoraAg/damm-v2-sdk@b66412daefab1edfddbc98f9655ddd2733fe021d` (reference, not a claim that an unverified program binary matches it)               |
| DAMM program source reference | `MeteoraAg/damm-v2@5398b5c7c534de014091132da37c6478cce671a8`                                                                                         |
| SDK program ID / pool layout  | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` / version 1                                                                                            |
| Jito distributor candidate    | `jito-foundation/distributor@2cf79f63973a79e6354871dc9355a63aa1d15139`, GPL-3.0                                                                      |

Primary sources: [Meteora SDK](https://github.com/MeteoraAg/damm-v2-sdk), [program](https://github.com/MeteoraAg/damm-v2), [Jito initialization](https://github.com/jito-foundation/distributor/blob/2cf79f63973a79e6354871dc9355a63aa1d15139/programs/merkle-distributor/src/instructions/new_distributor.rs), [Jito new claim](https://github.com/jito-foundation/distributor/blob/2cf79f63973a79e6354871dc9355a63aa1d15139/programs/merkle-distributor/src/instructions/new_claim.rs), [locked claim](https://github.com/jito-foundation/distributor/blob/2cf79f63973a79e6354871dc9355a63aa1d15139/programs/merkle-distributor/src/instructions/claim_locked.rs).

## What the offline lab proves

Run `pnpm --dir packages/meme-protocol check`. Network access through the lab's Connection is prohibited; it has no signer or send path. The fixture is marked simulated and supplies unrelated public keys and illustrative OG-denominated bounds. It is **not** a production economic proposal.

The published SDK constructs single-sided edition-token liquidity at the lower range boundary, with OG explicitly token B, zero OG input, quote-only fee collection, timestamp activation and an atomic permanent-lock instruction. Tests decode actual SDK-generated instruction bytes, assert authorities and fee mode, verify the 90/10 supply split, and commit the raw bytes/account metas with a SHA-256 hash. Token-2022 and alternative lock policies are outside this proof and rejected.

The illustrative time scheduler starts at **10%**, decays linearly once per second for ten minutes, and ends at **1%**. The opening value is a fixture, not approved policy. SDK integer division can leave a residual above 1% for some settings; the lab rejects those settings rather than rounding them silently. A 100% opening fee is rejected. No archived $1bn boundary is used. Dynamic fees are disabled in this fixture; enabling them would change the total fee and needs a separate decision.

An SDK instruction is not evidence of successful execution. Before selecting this protocol/configuration, execute a pinned, hash-verified program binary in a validator/SVM, verify pool and mint state, supply, authority revocation, permanent-lock behavior, OG-only fee claims, swaps in both directions, delayed activation, price-bound exhaustion, fees and transaction size/compute costs. The current Windows host has no Solana CLI, Rust/Anchor or Docker; LiteSVM 1.6.1 publishes Linux/macOS binaries, not Windows. A Linux execution environment and a verified compatible program binary remain necessary. No remote environment was provisioned.

## Distributor findings and decision

The owner selected **Jito with fully locked rewards for further evaluation** on 30 October 2026. The owner approved the concrete one-second/365-day/2-of-3 policy on 30 October; custody accounts, executed proof and production activation remain gated. Its `new_claim` transfers the Merkle leaf's `amount_unlocked` without enforcing `start_ts`. Putting a future start time on such a distributor does not protect scheduled allocations. The lab rejects any scheduled configuration with a nonzero unlocked amount.

An alternative using only locked amounts could begin vesting at the release timestamp and finish later, but the program requires `start < end`; it is not an exact instantaneous release primitive. It also requires a clawback timestamp at least one day after vesting ends. Admin and clawback receiver are mutable. No-expiry accumulated claims, custody and recovery therefore require explicit review. The program's claim-status PDA prevents repeating `new_claim` for the same claimant/distributor; execution, locked-withdrawal retries, underfunding, cost and upgrade-authority checks still need real program tests. The license needs assessment before copying or modifying its code; none has been vendored here.

The owner chose option 1 for further evaluation:

1. Evaluate Jito with zero unlocked amounts, vesting beginning no earlier than release, an explicitly approved vesting interval, finite clawback policy, custody and GPL implications.
2. Require an audited distributor with exact release-time cliffs and no expiry, then evaluate another implementation or commission a small purpose-built program. Audit and custody work are prerequisites; this is not permission to deploy a new contract.

There is no silent substitute for exact release/no-expiry requirements. These gaps block the controlled launch-to-claim milestone.

The [fully locked proposal](JITO-LOCKED-PROPOSAL.md) and offline instruction planner now make option 1 reviewable. A one-second vesting interval, a common clawback timestamp 365 days after the last release ends, and 2-of-3 vault custody are now approved in [the policy decision](approvals/2026-10-30-jito-policy.json). The pinned clawback instruction is permissionless after its timestamp. Funded direct claims cannot be paused through an application flag. The owner accepted those policy details; executed program tests and actual custody validation remain required.

## Configuration packet required before execution

Still undecided: OG mints/token programs; exact initial price/FDV methodology and OG bounds; opening fee and decay; liquidity stress tests; LP/position ownership and fee-claim authority; mint/freeze authorities; treasury policy; actual distributor custody accounts, funding infrastructure and recovery. A packet must specify every authority and supported version, include its test results and cost estimates, and be approved before it can become a launch adapter configuration.

Source integration references: [Helius complete-history semantics and owner-metadata limits](https://www.helius.dev/docs/rpc/gettransactionsforaddress), [Pyth historical endpoint implementation](https://github.com/pyth-network/pyth-crosschain/blob/main/apps/hermes/server/src/api/rest/v2/timestamp_price_updates.rs). Neither establishes that every OG mint has a historical USD feed or authorizes a new provider budget.

## Dependency assessment

Direct `bn.js` is pinned to patched 5.2.5. The SDK's SPL Token dependency brings `bigint-buffer@1.1.5`, whose native conversion has [CVE-2025-3194](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) and no upstream patched release. The workspace patch removes its native loader and install hook, retains its JavaScript conversion path, and rejects negative, overflowing or invalid-width integer encodings. Tests resolve the actual transitive package, verify that the native loader is absent, and exercise conversion boundaries and large buffers. The existing workspace dependency-age and exotic-subdependency rules remain enabled.

An npm version-based audit still reports the patched package's advisory. No audit exception was added. All lab dependencies are development-only, and the lab stays out of browser/Worker/production graphs. The SDK's Anchor tooling also introduces an old TOML parser with high-severity findings; it must not parse untrusted input or enter a signing service. Review the patch and these transitive tools whenever updating SPL Token or the SDK; use maintained replacements before promoting this dependency graph. Existing application/tooling findings remain covered by their earlier assessments and still need production-readiness review.
