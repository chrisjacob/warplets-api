# PRD comprehension report

## Requirements map

| Requirement | PRD | Implementation boundary and evidence |
|---|---|---|
| Discovery across Solana, Base, BNB, Robinhood | 0, 4 | Chain adapters; discovery and launch support independent; Solana/Pump first |
| Actual token creation age within 24h, real graduation | 4, 17.1 | Separate finalized creation and migration proofs; a new pool proves neither |
| Maximum 100 active candidates, approximately 60s prices | 4 | Global cap across chains; shared refresh, source timestamps, visible stale/partial states |
| Initial approximately $100K market cap and risk filters | 4 | Configurable policy; missing market cap is unknown, not FDV; no safety guarantee |
| OG buys become backing only after verification | 5 | Signed identity, finalized net trade evidence, deduplication and bounded scoring; links earn no votes |
| At most one active spotlight; skip/extend allowed | 3, 6, 7 | Database uniqueness plus immutable election snapshot; no compulsory daily launch |
| ATTN allocation 50/20/20/10 | 6 | Integer supply accounting; native/OG/local-$10X pools plus campaign reserve; OG and $10X initially ATTN-only |
| Ten-day attention budget and overlapping campaigns | 7 | Separate asset/budget/period ledgers for up to ten simultaneous campaigns; total reserve is 10%, not 10% daily |
| External content, optional Farcaster publishing | 7 | Canonical URLs, authorship/moderation, explicit signer consent; unavailable engagement stays unknown |
| Raw ranks before boosts | 7–9 | Freeze raw ranking, snapshot Base Warplet ownership/action proofs, allocate within fixed budgets |
| Independent unbridged $10X on each chain | 8 | Chain+address identity; 50% public, 50% ten-year community reserve, zero founder/team mint |
| Founder/business fee income | 10 | Only entitled protocol/LP fees; immutable asset ledger separates locked principal, fees, gas and compensation |
| Secondary LP from earned inventory | 10 | Separately approved strategy and caps; distinguish withdrawable secondary positions from permanently locked primary LP |
| Autonomous deterministic operation | 11, 15 | Replayable jobs/outbox, budgets, watchdog, pauses, audit; AI advisory only |
| Supervised launches and secure signing | 11, 14 | A2 initially; A3 requires explicit promotion, evidence and caps; no unrestricted signing key in app/AI |
| Mobile, accessible, inspectable evidence | 2, 13 | Distinguish OG/ATTN/chain-$10X, copyable full addresses, explorer links, provenance and freshness |

## Existing repository dependencies

`app/` contains the React/Vite frontend and Pages Functions, plus shared wallet/Farcaster/session/Warplet UX. The root Worker already supports other products and scheduled workloads. `web/` is a separate Pages website: do not confuse it with the requested React homepage. Existing Stonklets spotlight machinery describes a different product and cannot be reused as evidence of OG-token launch or graduation.

Keep the existing shell and identity integrations, but inspect authorization and principal semantics before sharing them with discovery/admin. New 10X tables, policies, queues and financial records should have an explicit namespace and preferably a separate D1 binding. Do not apply discovery changes to unrelated Warplets/Network/Stonklets schemas without a documented reason.

## Gaps and dependencies

1. Free pool APIs can find leads; they do not provide exhaustive finalized creation/graduation proof. Solana archival coverage, event cursors and provider constraints need recorded fixtures and replay tests.
2. Market-data licensing/redistribution needs a product-specific determination. A nominal public API rate does not establish permitted commercial use.
3. Holder concentration requires classification of LP/custody/program accounts; missing evidence must remain provisional.
4. Full ATTN production launches require a viable **same-chain $10X first**, including its independent supply, public distribution, reserve custody and observable price. Reorder PRD phase 5's issuance dependency ahead of phase 3; keep trader rewards later.
5. DAMM v2 documents relevant primitives, but exact three-pool operation, lock/fee authority and protocol rounding need an executable pinned-version simulator and devnet receipts.
6. Policy values for voting, boosts, rewards, fees and treasury remain proposals. No invented contract addresses, supplies, fee beneficiaries or price settings.
7. Financial release requires the PRD's security and legal review gates. This report is an engineering requirements interpretation, not a legal opinion.

## Scope and release sequence

| Phase | Result | Gate |
|---|---|---|
| 0a — current | Empty `/`, preserved `/thesis`, local preview; comprehension/fact-check/design/decision records | No deployed resources or money flows |
| 0b | Provider/license validation, recorded proof corpus, exact three-pool simulator, devnet experiment plan/proof | Exact SDK/config evidence; unresolved choices remain disabled |
| 1 | Solana discovery → finalized Pump origin/migration → risk filter → ≤100 shortlist → candidate/admin/status pages; election dry run | Offline tests, source completeness, no live voting/launches |
| 2 | Signed wallets, eligible buys, deterministic backing snapshots | Anti-replay, anti-wash/sybil and finality tests |
| 3 prerequisite | Solana $10X issuance/public launch/reserve design and certification | Founder choices, secure execution, review, explicit approval |
| 3 | Supervised ATTN three-pool deployment and lock/fee verification | Exact simulator/devnet proof and per-launch approval |
| 4 | External content and ten-day rewards; Warplet boosts | Distinct budgets, fraud review, immutable entitlements |
| 5 | Chain-specific trader seasons and reserve releases | Raw rank, release ceiling, audited claims |
| 6 | Bounded A3 and additional chains; secondary LP | Fourteen-day fault/replay exercise, chain certification and explicit promotion |

## Risks and success criteria

Largest early risks are incomplete data coverage, false graduation attribution, unknown supply/market cap, provider licensing and unexpected free-tier exhaustion. The MVP succeeds by showing a small defensible shortlist with inspectable proof, including honest zero/partial results when evidence is missing. It must not fill 100 slots to satisfy a visual target.

Measure verified versus provisional leads, proof lag, coverage watermark, expired-candidate count, provider 429s, p50/p95 source age, daily quota use and recovery success. Later measure retained verified traders, qualified attention and realized net fee revenue separately from nominal volume/unrealized token gains. Use UTC for policy windows and local display time for operators.
