# Review integration

## Current complete review — 31 October 2026

`codex/10x-reviewed-overnight` contains the preserved #93 base and subsequent #94–120 stack without merging or closing any PR. A fresh fetch and remote ref check still identify released `main` as `86b50a2553e9927ad9b47145aa14f58a1a09118a`. The new branch is a main-targeting review, not a release. [OVERNIGHT-HANDOFF.md](OVERNIGHT-HANDOFF.md) describes validation, local preview and remaining gates.

The archive branch and annotated tag still resolve to `5d5987125cafa288877bbc853dc7e844b3bf831f`; the tag object remains `9286d6f19b23d94d6336b5bbfe1693f1b2e6cf3c`. No archive ref was moved. There are no differences to released `app/functions`, `app/public`, root `public`, or production migrations. Existing app changes are reviewed shared Connect extraction/compatibility; security overrides, lockfiles and release checks are explicit. Launchpad app/Worker, protocol and QA packages remain outside existing product routing and production build imports. Root production install includes QA development dependencies only in development/CI, not runtime imports.

On 31 October 03:47 AEDT, read-only public smoke checks returned 200 for both Network hosts, its dashboard, legal pages/August archives, thesis and existing product URLs. This is HTTP/API smoke evidence, not another physical-device or complete rendered-product certification. The Network snapshot remains stale and the November rollover is not yet due. Neither shared deployment nor provider budgets changed.

The latest review preview is loopback-only on 5198/8800 with separate `.wrangler/review-state` and operator storage. Existing 5194/8797 processes and their worktree/database remain untouched.

## Original foundation integration

`codex/10x-operations-integration` starts at released `main` (`86b50a2553e9927ad9b47145aa14f58a1a09118a`). Its application tree matches the reviewed `codex/10x-review-improvements` head `2be14840634261afe743461cf8c43339ca5ded4d` before this document was added.

The following commits were replayed in order, without merging or closing PRs #86–92:

| Source | Content |
|---|---|
| 36ef5ba | Isolated launchpad foundation |
| 0ad93ce | Shared existing Connect UI |
| 5862d59 | Verified identity |
| 4173a89 | Persisted rounds and frozen ownership |
| e5a2312 | Committed attribute cycles and boosts |
| 41e2775 | Acquisition-value holding ledger |
| cf0ecf4 | Immutable unfunded settlement |
| b222dcb | Disabled fixture participation |
| 5a73013 | Preserve reward wallet roles |
| 3445bf2 | Startup, local security and simple daily UI |
| 2be1484 | Connect cancellation and failure recovery |

This is the main-targeting review base for the remaining work. Existing Network, legal, thesis and product routes remain in the released tree. The current preview and its local database are left in their existing worktree. This worktree has separate local state. There are no deployment steps or remote launchpad resources.

Subsequent operations and protocol feasibility changes are reviewed separately. Production rule approval, physical-device signing QA and an executed protocol/distributor proof remain gates. No historical `local-v1` rules or finalized entitlements may be rewritten.
