# 10X.meme daily launchpad

This is the authoritative entry point for the new product. Read [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DECISIONS.md](DECISIONS.md) before implementation. The specification distinguishes confirmed requirements from working assumptions and unresolved decisions.

The previous discovery implementation is archived at [`archive/10x-discovery-2026-10-29`](https://github.com/chrisjacob/warplets-api/tree/archive/10x-discovery-2026-10-29). Its [historical PRD](https://github.com/chrisjacob/warplets-api/blob/archive/10x-discovery-2026-10-29/docs/10x/spec/10X_MEME_FULL_PRD_v1_2.md), simulations and research are reference material, not requirements for this rebuild. Network and shared security improvements were released independently before creating this branch.

The first three functional milestones are implemented locally in `meme/`: verified identity and persisted rounds, deterministic boosts and holding credit, and resumable settlement with immutable unfunded entitlements. Existing Connect UI is shared with the other products. [BUILD.md](BUILD.md) defines the versioned local rules, operator procedures and source limitations. The original read-only design fixtures remain available at `?fixture=1`. Launch execution, funding and claims are disabled. These branches do not deploy the new launchpad.

See [VALIDATION.md](VALIDATION.md) for the released branch base, completed checks and remaining hostname/observation follow-up.

The next integration adds [resumable evidence and daily operations](OPERATIONS.md), published score snapshots and an explicit correction workflow. Review the [participation packet and physical-wallet QA](RULES-REVIEW.md) before enabling a production rules version. Provider allowances for new sources remain zero until approved. The integration/review base is documented in [INTEGRATION.md](INTEGRATION.md).
