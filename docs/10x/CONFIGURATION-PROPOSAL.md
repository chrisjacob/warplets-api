# Controlled pilot configuration — draft for review

Prepared 30 October 2026 from the approved product/rules/Jito records and current protocol evidence. **None of the new recommendations below is approved, executable or deployed.** The initial cohort is at most 100 explicitly invited accounts. Read-only references and simulated keys are not custody accounts.

## Preserve the approved rules

Solana launches remain one selected OG-paired edition/day or skip; the operator selects the actual candidate and OG mint for each launch. Retain 90% liquidity, 10% rewards, ten daily allocations starting at actual launch +24 hours, capped additive boosts, top-100 settlement and frozen destinations. Exactly **one raw OG unit** is approved for initialization and appears as a separate asset line in the launch budget. Fully locked Jito rewards vest for one second from each release; permissionless clawback starts 365 days after the final vesting end. The approved admin/receiver authority remains one native Solana 2-of-3 vault. Funded direct claims cannot be paused by the app.

## Recommended values to simulate, then approve

| Item | Draft recommendation | Approval/evidence required |
| --- | --- | --- |
| Edition token | Classic SPL Token, 9 decimals, 1 billion whole tokens (`1000000000000000000` raw) | Mint/program compatibility, integer split and authority read-back |
| Initial liquidity | 900 million edition tokens, at the lower bound; separately exactly one raw selected OG unit | Actual OG mint/decimals/extensions, source wallet and permanent-lock budget |
| Reward reserve | 100 million edition tokens; 10 million per daily allocation | Immutable allocations, actual distributor costs and funding conservation |
| Liquidity bounds | **Candidate simulation:** opening FDV $10,000; upper FDV $1,000,000 (100× price ratio) | Convert to OG/edition using the selected OG's independently verified USD observation and exact decimals. Reject stale/unknown valuation. Stress both directions, gaps and all daily reward releases. These are proposal inputs, not a dollar guarantee or inherited $1bn boundary |
| Base fee | **Candidate simulation:** 3% opening → 1% ongoing, linear, 100 six-second periods (10 minutes) | Pinned SDK wire decoding, exact ending numerator, live-program swaps at start/each boundary/end |
| Dynamic fee | Disabled for initial pilot | Any later enabling needs a new total-fee/authority review |
| LP control | Atomically lock the full initial position permanently; no withdrawable residual position | Actual position owner, liquidity/lock counters and fee-claim permissions |
| Mint/freeze control | Revoke edition mint and freeze authorities after verified exact issuance, before activation | Finalized mint account reads; metadata/update authority separately disclosed |
| Fee ownership | Collect OG fees under the native Solana vault; retain 100% there during the pilot | Fee-claim authority/program compatibility and published treasury addresses |
| Treasury conversions | No automatic OG sales, bridge, revenue split, yield deposit or operator payout | Each later conversion/transfer needs a disclosed destination, amount, slippage, cap and multisig proposal |
| Empty-round reserve | Retain existing approved reserve accounting; segregate amounts by edition and reason | Publish operational reserve/dispute handling; never silently redistribute or recalculate finalized entitlements |

The two numeric price bounds are intentionally a concrete research candidate. They must be evaluated per OG; the operator may reject a candidate or skip. A narrow/illiquid/manipulable OG market cannot be fixed by selecting a convenient USD price. Launch plus permanent lock is irreversible, so these recommendations do not supply launch permission. The current lab validates fee arithmetic/instructions and tested captured-program behavior; it does not certify these proposed economics on a selected live mint.

Meteora's current [pool-creation guide](https://github.com/MeteoraAg/docs/blob/main/user-guides/creating-a-liquidity-pool.mdx) describes explicit price bounds, fee scheduling, activation and permanent locks. Reconcile the pinned SDK/program versions against those requirements rather than assuming the current web UI and pinned binary have identical capabilities. New pool rate limiting is not part of this proposal. [Pinned protocol evidence](PROTOCOL-FEASIBILITY.md) remains authoritative for what has actually executed locally.

## EVM treasury — Splits preference

Use the existing **Splits app smart-account** model for EVM treasury, starting with Base; splitter contracts alone do not implement this custody arrangement. Propose a segregated 10X operating account for small approved operational balances, under the workspace Treasury. Keep larger EVM reserves in Treasury. Initially grant the agent no signer key and no new API credential; a later read/proposal-only integration requires explicit scoped access review.

Read back and record actual account addresses, chain IDs, implementations, modules, signers, thresholds and Root recovery authority before funding. Splits accounts have an owner hierarchy: Root → Treasury → operating account; owner powers include upgrade/recovery. Reviewing an operating account's threshold alone is insufficient. Propose 2-of-3 independent human/hardware recovery control and 2-of-3 treasury spending; these EVM thresholds are **new recommendations**, not changes to the approved Solana policy. Verify the existing workspace first. [Splits account documentation](https://splits.org/docs/accounts) and [networks](https://splits.org/docs/introduction/networks-and-assets) support this assessment.

The supplied network-settings screenshot records preference, not permission to change settings or create accounts. Base is documented as fully supported; actual enabled networks and accounting availability must be verified in the workspace. Splits can send/bridge externally to Solana, but that does not provide native Solana custody. Do not bridge OG fees automatically. [Agent/API scopes](https://splits.org/docs/introduction/agents) need a separate review; never register an agent signer, create an owner key or change thresholds as part of read-only QA.

## Solana custody recommendation

Evaluate a **Squads v4 vault** for the approved native 2-of-3 authority. Proposed members are three independent owner-selected human/hardware public keys; none is the generated hot QA wallet. Proposed multisig configuration authority is self-managed, without an external single-key override. Keep native operating SOL separate and bounded. Record both multisig and vault PDA, index, member permissions, threshold, time locks, config authority, upgrade authority and recovery procedure. Actual addresses and program approval are pending.

Squads distinguishes its config account from the derived vault that holds assets. [The source-built local proof](CUSTODY-SOURCE-PROOF.md) now executes actual 2-of-3 vault CPI into Jito: vault admin/receiver ownership, receiver drift detection, approved funding, direct released claims and permissionless policy-timed clawback all pass. The compiled ELF differs from the captured deployed ELF, so source-to-mainnet correspondence and production provider approval remain unresolved. See [Squads account model](https://docs.squads.so/main/development/reference/accounts), [vault derivation](https://docs.squads.so/main/development/typescript/accounts/vault) and [program/SDK reference](https://docs.squads.so/main/development/typescript/overview). This recommendation does not authorize creating or funding a mainnet multisig.

## Itemized transaction packet before requesting funds

| Budget line | Current status |
| --- | --- |
| Off-chain Farcaster/Base/Solana login proofs | 0 ETH / 0 SOL network gas |
| Base transactions / smart-account bundler costs | No write proposed; quote L1/data, execution and sponsorship conditions if one is needed |
| Solana signatures + priority/compute budget | Quote the exact decoded transaction set immediately before review |
| Edition mint, source/reward/OG/vault token accounts | Measure actual account count/size and rent; existing sample is not a full launch budget |
| Meteora pool/config/position/NFT/lock accounts | Simulate the selected configuration and itemize rent plus fees |
| Ten Jito distributors and claim-status accounts | Measure actual one-cycle create/fund/claim account sizes and per-claimant cost |
| Multisig proposal/approval/execution accounts | Quote actual chosen custody path; independent signer fees are separate |
| Retry contingency | Propose 25% of measured native fees/rent, rounded up, with one aggregate hard ceiling; no automatic repeated budget |
| OG initialization asset | **Exactly one raw selected OG unit**, explicitly separate from SOL gas and edition 90/10 split |
| Token purchases, additional liquidity, locks | Separate quantities, valuations and irreversible-action approval; zero permission inferred from gas funding |

Provide wallet addresses, network, business/attempt IDs, decoded instructions, account privileges, simulation result, fresh state read-back, maximum cost, asset quantities and recovery conditions in the same packet. Pin deployed binaries/program authorities and resolve source/binary correspondence and license/dependency assessment. No funds are requested now. Exact packets and finalized-blockhash lifetime checks are implemented and exercised locally. Durable nonces remain unsupported; missing-signature discovery and mainnet RPC/execution adapters remain development gates, even after these policy recommendations are reviewed.

## Abuse, disputes and readiness

Propose one Farcaster identity/round, existing duplicate-wallet conflicts and frozen reward destinations; no new reward for sharing. For a disputed identity/source decision, preserve the original evidence, suspend affected **future** eligibility, record a reason and allow an owner-reviewed appeal. Propose a seven-day response target, with any compensation handled as a separate disclosed reserve decision. Do not rewrite historical allocations or promise an app pause can stop funded direct claims. Public notice/contact channel, responder identities, retention and appeal windows still require owner review.

Before a controlled financial cycle: owner portable recovery/import, desktop and physical iOS signing, current finalized ownership, complete history/prices, actual custody, this economic packet and exact budget must all pass. Android remains a general public release gate. No serving, participation, launching, funding or claims control is activated automatically.
