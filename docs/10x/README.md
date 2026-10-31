# 10X.meme daily launchpad

**Current review:** [REVIEW-TONIGHT.md](REVIEW-TONIGHT.md) contains the latest app/admin links, short walkthrough and the owner decisions/device checks needed before production. [DELIVERY-STATUS.md](DELIVERY-STATUS.md) separates built local proofs from remaining engineering and activation gates. PR #126 is the latest review branch; no merge or deployment is included.

Local review now includes a [populated QA world and scoped admin workspace](ADMIN-AND-SEEDED-QA.md): thirty prior launches, synthetic people/trading/rewards, candidate selection, operational metrics, reviewed communications and safety controls. Use `http://127.0.0.1:5198/?qa=seeded` and `http://127.0.0.1:5198/__adminhidden/meme?qa=seeded`. Financial activation and real delivery remain disabled.

This is the authoritative entry point for the new product. Read [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DECISIONS.md](DECISIONS.md) before implementation. The specification distinguishes confirmed requirements from working assumptions and unresolved decisions.

Earlier overnight evidence: [overnight handoff — 31 October](OVERNIGHT-HANDOFF.md) and [focused review record](OVERNIGHT-DELIVERY.md). The new growth, mini-app, trading, social, notification and custody proofs are implemented locally; production/financial activation remains disabled. Earlier milestone descriptions below are historical context.

The previous discovery implementation is archived at [`archive/10x-discovery-2026-10-29`](https://github.com/chrisjacob/warplets-api/tree/archive/10x-discovery-2026-10-29). Its [historical PRD](https://github.com/chrisjacob/warplets-api/blob/archive/10x-discovery-2026-10-29/docs/10x/spec/10X_MEME_FULL_PRD_v1_2.md), simulations and research are reference material, not requirements for this rebuild. Network and shared security improvements were released independently before creating this branch.

The first three functional milestones are implemented locally in `meme/`: verified identity and persisted rounds, deterministic boosts and holding credit, and resumable settlement with immutable unfunded entitlements. Existing Connect UI is shared with the other products. [BUILD.md](BUILD.md) defines the versioned local rules, operator procedures and source limitations. The original read-only design fixtures remain available at `?fixture=1`. Launch execution, funding and claims are disabled. These branches do not deploy the new launchpad.

See [VALIDATION.md](VALIDATION.md) for the released branch base, completed checks and remaining hostname/observation follow-up.

The next integration adds [resumable evidence and daily operations](OPERATIONS.md), published score snapshots and an explicit correction workflow. Review the [participation packet and physical-wallet QA](RULES-REVIEW.md) before enabling a production rules version. Provider allowances for new sources remain zero until approved. The integration/review base is documented in [INTEGRATION.md](INTEGRATION.md).

The separate [protocol feasibility lab](PROTOCOL-FEASIBILITY.md) pins the published Meteora SDK, constructs unsigned instructions offline, and records distributor compatibility gaps. It is excluded from application runtime imports. Successful program execution and an approved authority/distribution policy remain prerequisites for a complete funded cycle.

See [DELIVERY-STATUS.md](DELIVERY-STATUS.md) for what is built versus the remaining gates, and the [production preparation/recovery draft](PRODUCTION-READINESS.md) for the later controlled activation sequence.

[MAINNET-QA.md](MAINNET-QA.md) defines the isolated browser/protocol test harness, protected QA wallet custody, captured mainnet binaries, transaction-review journal and human financial handoff. The new wallets are not yet approved for funding.

The owner approved the current participation design and selected fully locked Jito evaluation on 30 October. The [decision record](approvals/2026-10-30-design.json) preserves that approval; [JITO-LOCKED-PROPOSAL.md](JITO-LOCKED-PROPOSAL.md) records the subsequently approved timing/custody policy and its remaining execution gates.
