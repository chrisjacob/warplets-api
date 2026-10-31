# Tonight's review and the path to production

Prepared 31 October 2026 (Sydney). Start here for the latest build. The launchpad is local, with no merge, deployment, live notification/social send or financial activation. Existing products and provider caps are unchanged.

## Open the populated app

| Review  | Local link                                                                     | What to check                                                                                            |
| ------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Today   | [Today with QA data](http://127.0.0.1:5198/?qa=seeded)                         | Tour, next step, three OG candidates, vote/change vote, boost breakdown and matched ATTN/OG chart.       |
| Rewards | [Rewards](http://127.0.0.1:5198/?qa=seeded&view=Rewards)                       | Accumulated amounts, release states, details, simulated claim-one/all and notification topics.           |
| Leaders | [Leaderboards](http://127.0.0.1:5198/?qa=seeded&view=Leaders)                  | Reward vs trading ranks, 24h/30d/all-time periods, trader profiles and watermarked P&L cards.            |
| History | [Previous launches](http://127.0.0.1:5198/?qa=seeded&view=History)             | Thirty prior launches, selection/skip history and older pages.                                           |
| Admin   | [Launchpad administration](http://127.0.0.1:5198/__adminhidden/meme?qa=seeded) | Today, Performance, Comms and Health; shortlist, select/skip, review metrics and preview communications. |

All people, prices and transactions in QA mode are fictional. QA controls allow a participant/guest/persona change and active, release, recovery or empty scenarios. Simulated buy/sell/claim/launch actions affect only the separate QA database. Sharing previews a watermarked card; it sends no post. Use the normal [local app](http://127.0.0.1:5198/) for the actual Connect flow; QA mode deliberately does not initialize real wallets.

For a quick review: complete the tour, change a vote, compare both winning and losing ATTN/OG examples, open a trader and return to its leaderboard, then inspect rewards and admin. Reload after changing periods to check context persistence. Send the URL, screen and expected behavior for anything confusing. Screenshots help; no private keys or seed phrases.

The existing QA generation is preserved. Switching a scenario or resetting deliberately creates a different synthetic generation; neither changes the normal local database. There is no need to reset just to review.

## What the owner needs to do next

1. **Review the UI and admin workflow.** Identify any confusing labels, missing daily operator information or unwanted steps. PR [#126](https://github.com/chrisjacob/warplets-api/pull/126) contains the final resilience/handoff changes, on [#125](https://github.com/chrisjacob/warplets-api/pull/125), [#124](https://github.com/chrisjacob/warplets-api/pull/124), [#123](https://github.com/chrisjacob/warplets-api/pull/123) and [#122](https://github.com/chrisjacob/warplets-api/pull/122). The underlying main-targeting integration is draft [#121](https://github.com/chrisjacob/warplets-api/pull/121). The latest branch contains that integration and all these later changes; do not merge only #121 expecting the latest UI. Integrating the final stack is a later reviewed action, not part of this handoff.
2. **Complete supervised real-wallet/device QA.** Use owner-controlled warpmoji (FID 1431382). Farcaster sign-in, feedback and images on physical iOS Safari already passed by owner report. Pending: Trust/other injected Base wallets, Base smart accounts, Solana proof signing, reconnect/account changes, desktop extensions and physical Android/Farcaster/Base host handoffs. Unlock wallets and approve the required login/message proofs yourself. Balajis remains read-only; a new Farcaster account is not required. No gas deposit or token purchase is needed for login proofs. Phone access needs a fresh restricted HTTPS session; the previous invitation expired and has not been reopened.
3. **Choose the release identity and access.** Confirm the canonical launchpad hostname, the Farcaster/Base account controlling host registration, and the initial invited cohort/size. Provide owner-operated domain/manifest association and mini-app registration when prepared. Notification permission, secrets and actual delivery require their own configured registration; social posting stays an explicit action.
4. **Review the unresolved configuration packet.** [CONFIGURATION-PROPOSAL.md](CONFIGURATION-PROPOSAL.md) lists the draft supply, numeric price bounds and fee decay. Its $10,000–$1,000,000 FDV range and 3%→1% fee proposal are simulation candidates, not approved production settings. Choose the actual first OG mint, approve or change the numeric economics after per-mint tests, and identify launch, metadata, LP/lock and fee authorities. The approved one-raw-unit OG initialization minimum remains a separate budget line.
5. **Name custody and operating owners.** Supply public addresses for the actual three independent Solana signers and approved 2-of-3 vault/admin/clawback receiver; verify private backup/recovery outside chat. QA hot wallets are not custody. For EVM treasury, retain Splits and review the actual account hierarchy, addresses and recovery authority separately. Approve public abuse/dispute/contact and reserve handling using [PUBLIC-POLICY-DRAFT.md](PUBLIC-POLICY-DRAFT.md). Name the daily operator and incident responder.
6. **Authorize bounded evidence access.** Select providers, exact feeds/mints, pilot wallet scope and numeric credit/request ceilings. Server credentials belong in the agreed secret store, never chat or Git. New Helius/Pyth/GMGN and real Base-notification allowances remain zero. Existing ownership caches and historical samples do not pass a current complete-cohort freeze. Missing history, stale ownership and unknown prices block finalization.
7. **Review a concrete release and transaction packet when ready.** Deployment approval and financial approval are separate. Before funding, review the itemized ETH/SOL fees, rent, one raw OG unit, liquidity/lock amounts, maximum retry allowance, decoded transactions, simulation and recovery steps. Funds are not requested now. You perform final financial wallet confirmations; the app cannot authorize them through an admin login.

Participation design, the 90/10 split, ten releases at actual launch +24h through +240h, one raw OG initialization unit and the fully locked Jito policy are already approved. Retain the one-second vesting interval, policy-timed clawback and native Solana 2-of-3 custody. Changes require an explicit versioned decision; finalized history is never recalculated.

## Engineering work still required

- Reconcile fresh full-cohort Warplet ownership, complete finalized Solana history and independent acquisition prices under approved allowances; retain coverage, checkpoints and explicit corrections.
- Finish mainnet execution/read adapters, missing-signature discovery, actual custody configuration, source/deployed-binary correspondence and license/security review. Local captured-program proofs do not implement a production signing service. Durable nonces remain unsupported.
- Configure and verify real Farcaster/Base framing, manifests, registration, wallet buy handoffs and opt-in notification delivery on actual hosts. Local charts/share cards and fake delivery tests do not certify these integrations.
- Prepare isolated launchpad storage/configuration, the private admin service binding, approved routing, five independent serving/participation/launch/funding/claim controls, telemetry/alerts, operating budgets and rollback commands. The current local Worker cannot become a production financial service by toggling a flag.
- Consolidate/review the PR stack against current main and rerun release checks. Prepare → bootstrap → activate only under separate deployment authorization. A first serving deployment can keep participation and all financial operations disabled.
- Execute a narrowly scoped, approved controlled launch-to-claim cycle, reconcile actual accounts and authorities, then observe the real +24h…+240h releases and overlapping-campaign recovery. The simulator's accelerated clock does not replace that observation.

The immediate owner-dependent steps are UI review, real-wallet/device availability and the unresolved configuration/source/custody packet. They do not imply that first-token launch is ready tonight.

## Review state and restart

The review worktree is `C:\Users\cjacob\Documents\GitHub\WarpletsAPI\.worktrees\10x-operations`, branch `codex/10x-resilience-review`. PR #126 is the current review entry. Earlier focused PRs remain available; no archive or valuable local evidence is removed to tidy the worktree.

The loopback frontend is 5198, normal Worker 8800 and separate QA service 8801. Normal storage is `meme/.wrangler/review-state`; synthetic storage is `.tmp/meme-qa/seeded-preview`. Ignored secrets, databases and evidence stay outside Git. The other previews/worktrees remain intact. No phone-access tunnel is running.

If a service has stopped, run these from this worktree in separate terminals; do not start duplicates while the existing listeners are healthy:

```powershell
pnpm --dir meme review:worker
pnpm --dir meme review:dev
pnpm --dir packages/meme-qa seed:serve
```

Use `pnpm --dir meme review:migrate` only when additive local migrations are pending; never reset the database as a startup step. See [ADMIN-AND-SEEDED-QA.md](ADMIN-AND-SEEDED-QA.md) for scenarios and [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) for later activation/recovery gates.

The validation record is [RESILIENCE-SECURITY-REVIEW.md](RESILIENCE-SECURITY-REVIEW.md). The final tidy-up adds contained optional-module failures with reload recovery; navigation and the voting round survive an unavailable chart, guide or other lazy panel. No raw exceptions, credentials or automatic action retries are displayed. Build size remains subject to the existing 80 KiB startup gate. Core Web Vitals tracing and physical wallet handoffs remain unmeasured here.
