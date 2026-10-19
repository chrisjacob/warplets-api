# 10X.MEME engineering kickoff

Planning checkpoint: 20 October 2026 (Australia/Sydney). Product specification: v1.1, 17 October 2026.

Subsequent implementation: [morning review checkpoint](06-discovery-review.md) and [local Solana discovery guide](../../discovery/README.md). The local service, evidence verification, APIs, screens and tests are now implemented; the planning checkpoint below remains the original kickoff record.

The homepage is intentionally empty within the existing app shell. The previous landing experience lives at `/thesis`, linked as **The 10X Thesis** in both connected and disconnected title/account dropdowns. This checkpoint prepares the app and implementation plan; it does not implement or claim a live discovery service, economic validation, or devnet launch proof.

## Source documents and authority

- [Full original PRD](spec/10X_MEME_FULL_PRD_v1_1.md), copied without edits.
- [Original AI agent brief](spec/AI_AGENT_BRIEF.md), copied without edits.

The user explicitly asked us to follow these documents for the app build. They supply product and engineering requirements, not independent permission to deploy, spend money, send social messages, or choose unresolved economics. The user's **local-only, no-deploy** instruction takes precedence over the brief's staging/deployment wording. Preserve `[DECIDED]` requirements; keep `[PROPOSED]` values configurable; require evidence for `[VERIFY]` assumptions.

Read deliverables in order:

1. [PRD comprehension and scope](01-requirements.md).
2. [Provider fact check and budget](02-provider-feasibility.md).
3. [Architecture, system design, threat model and milestones](03-architecture-and-plan.md).
4. [Founder decision register](04-decisions.md).
5. [Local preview and validation record](05-local-preview.md).

The exact AMM simulator, devnet proof, executable discovery schema/OpenAPI, and discovery vertical slice remain scheduled work, not completed deliverables. No mainnet financial authority is enabled by this plan.

Confirmed user preference: **free market data and RPC services first; expose coverage and freshness gaps clearly**. Do not automatically purchase plans or enable billable overages. No recurring automation or outbound messages have been created.
