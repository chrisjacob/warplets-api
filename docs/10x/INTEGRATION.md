# Review integration

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
