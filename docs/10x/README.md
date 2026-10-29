# 10X.meme daily launchpad

This is the authoritative entry point for the new product. Read [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DECISIONS.md](DECISIONS.md) before implementation. The specification distinguishes confirmed requirements from working assumptions and unresolved decisions.

The previous discovery implementation is archived at [`archive/10x-discovery-2026-10-29`](https://github.com/chrisjacob/warplets-api/tree/archive/10x-discovery-2026-10-29). Its [historical PRD](https://github.com/chrisjacob/warplets-api/blob/archive/10x-discovery-2026-10-29/docs/10x/spec/10X_MEME_FULL_PRD_v1_2.md), simulations and research are reference material, not requirements for this rebuild. Network and shared security improvements were released independently before creating this branch.

The first deliverable is a fixture-backed local skeleton in `meme/`. It cannot authenticate participants, accept votes, launch tokens, allocate funds or submit claims. Functional implementation follows the milestones and decision gates below. This branch does not deploy the new launchpad.

See [VALIDATION.md](VALIDATION.md) for the released branch base, completed checks and remaining hostname/observation follow-up.
