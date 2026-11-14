# Local demo to release: founder review checklist

Prepared 12 November 2026. **Decision requested: review the next bounded scope, not approval to launch.** No box is an authorization. This packet supplements, and does not replace, [the mandatory R01–R06 gates](../blueprint/RELEASE_GATES.md).

## Recommendation

Keep the current app a synthetic local demo. Complete physical wallet/device/accessibility checks and review a concrete non-financial hosted rehearsal plan before authorizing remote changes. A hosted rehearsal must not be presented as a funded pilot. The custody and protocol failures below block financial release regardless of UI test results.

## 1. Evidence available for review

- [x] User manually reviewed Vault, Stake, Earn and Collect mint/upgrade/reroll. Genesis voting was also reviewed historically and retired from the product on 2026-11-14.
- [x] Synthetic Earn admission, moderation, cutoff settlement, replay and 402,600-base-unit award verified.
- [x] Historical separate-copy ballot closure/founder decision rehearsal passed. In-app ballots are now retired; founder approval and stage-opening safeguards remain required. See [retirement scope](../governance/README.md).
- [x] Fresh-database public Earn recovery matched archive, proof and vesting; duplicate import and tampering checks passed. This is public award recovery, not a full hosted private-state disaster recovery pass.
- [x] Explicit account selection/switching and synthetic message-authentication isolation verified. No transaction signing or broadcasting.
- [x] Mobile viewport, keyboard focus, Escape, focus return, reduced-motion and larger touch-target checks passed. Emulation is not a physical-device or screen-reader result.
- [x] Inbox conflict fix has deterministic coverage: delayed reads, rapid changes, cross-tab conflict, explicit refresh, no automatic consent retry, and retained idempotency key for a pending result.
- [x] Existing notification delivery/revocation/replay/isolation browser coverage passed at 360/390/768/1440 px; 30 frontend and 19 focused consent/compatibility tests passed.

Latest detailed compatibility results and limitations: [12 November compatibility review](COMPATIBILITY_REVIEW_2026-11-12.md). Existing full B-stage CI evidence remains tied to its historical commit; it is not fresh CI evidence for later manual-review fixes.

## 2. Before any hosted non-financial rehearsal

Owner: founder approves scope; engineering prepares artifacts; designated operator verifies execution.

- [ ] Select the exact candidate commit and configuration; run relevant fresh test-only CI and retain run links, hashes, tool versions and failures. Record local/manual evidence separately.
- [ ] Complete actual Trust Wallet extension account selection, permissions reconnect, reject/cancel and background-return checks. Record browser/OS/extension versions; do not infer them from simulated-provider tests.
- [ ] Complete physical iOS/Android browser and wallet checks, including device rotation, software keyboard, interrupted sign-in and network loss. Use the [physical test packet](../compatibility/physical-device-checklist.md).
- [ ] Complete NVDA/VoiceOver/TalkBack review of labels, navigation order, dialog announcements, errors and changed states. Keyboard/browser-tree coverage alone is insufficient.
- [ ] Review the proposed hosting architecture, exact resources, bindings, host/origin/cookie configuration, operator authentication and least-privilege roles. Keep operator console access private.
- [ ] List every migration, source/destination database and artifact bucket, retention policy and rollback action. No copying local auth sessions or synthetic credentials into hosted use.
- [ ] Rehearse private-state backup/restore and public artifact recovery for the proposed environment; verify immutable receipts, access boundaries and post-restore write controls.
- [ ] Define monitoring, incident owner, alert thresholds, pause/hold controls and rollback. Do not silently discard unknown operation outcomes.
- [ ] Enumerate public pages, allowed testers, fixture labels, data-retention expectations and the explicitly disabled financial capabilities.
- [ ] Supply exact commands/resource changes, one-time and recurring costs, approval expiry, stop conditions and responsible operator for review **before** provisioning or deployment.
- [ ] Founder explicitly approves that exact non-financial rehearsal packet. This does not authorize production, paid services, funding or signing/broadcasting.

## 3. Financial release gates: all remain open

| Gate | Required evidence/decision | Owner | Current status |
|---|---|---|---|
| R01 — Permanent NFT custody | Resolve reserve-to-asset assignment, current-owner claims, unminted Genesis liabilities, external burns, plugin/update authority, metadata progression and proof portability | Founder + independent custody reviewer | **Blocked.** Burn and mutation compatibility unresolved; local Core composition is not a production custody decision |
| R02 — Stake | Enforce principal/emission protection, continuous accrual, withdrawal/harvest, empty-period behavior, exact rounding, fees and end recovery | Founder + independent protocol reviewer | **Blocked.** Existing Kamino counterexample let an unrestricted administrator remove 10 of 100 principal units |
| R02 — Earn | Ratify UTC board and activation-relative schedule; establish cutoff completeness, permanent allocated claims, actual distributor proof format and no-sweep rules | Founder + independent protocol reviewer | **Open.** Public SHA-256 archive recovery is not proof of a funded program's claim path |
| R03 — Execution/funding | Exact message and cost packet; current program/configuration/source correspondence; signer/privilege/network/lifetime bounds; real-provider finality and ambiguous-outcome recovery | Independent reviewer + founder + named signer | **Not authorized.** Local unsigned factories and fixtures only |
| R04 — Paid NFTs/providers/marketplaces | Payment/draw order, fairness, non-withholding, refunds, atomic/escrow progression, real wallet/venue compatibility, licensing and applicable legal review | Founder + specialist reviewers | **Unselected/unverified.** No provider or marketplace selected by this checklist |
| R05 — Staffed ATT pilot | R01–R03 and B20-full; R04 where paid features are offered; conserved allocation, liquidity/fee controls, complete first reserves, exact campaign costs and staffed window | Founder + staffed operator + scoped signer | **Not authorized.** At most one initial campaign after a separate go decision |
| R06 — Expansion | Reconciled observed pilot outcomes, no critical unresolved issue, measured budgets and explicit approval per expansion | Founder | **Not started** |

See [protocol findings](protocol-status.md) and [financial decision records](decisions/financial-decisions.json). An unresolved critical condition stays open; configuration toggles and favorable UI tests cannot waive it.

## 4. Founder decisions to keep explicit

- [ ] Name independent custody/protocol reviewers and select only evidence-backed implementations.
- [ ] Ratify Earn schedule and remaining unused-unit destination policy before funding.
- [ ] Choose Sydney staffed launch hours; **still unset**.
- [ ] Publish later Genesis/Season mint prices with required notice; **still unset**. The recorded first Genesis whitelist price is 0.1 SOL.
- [ ] Decide any public-sale access, founder inventory backstop, paid provider, entropy and artwork terms separately.
- [ ] Review exact cash/cost evidence. Existing bounds: target below US$10 and within 20% of cash; a separately approved exception may reach US$30; new recurring services capped at US$5/month until revised. These are ceilings, not spending authority.
- [ ] Approve each concrete hosted or financial action separately, with payer/signer, caps, expiry and recovery route. No private keys or autonomous financial authority are delegated by this document.

## 5. Review record (unfilled)

| Field | Review entry |
|---|---|
| Candidate commit/configuration and evidence digests | Pending |
| Proposed next scope | Recommended: bounded non-financial hosted rehearsal, after prerequisite checks |
| Included/excluded capabilities | Pending; financial execution remains disabled |
| Open defects, compatibility limits and accepted noncritical exceptions | Pending |
| Reviewer names and findings | Pending |
| Resource changes, costs, payer/operator and approval expiry | Pending |
| Rollback, monitoring and stop conditions | Pending |
| Founder decision: hold / approve exact scope | **Not given** |

No remote resources were provisioned or mutated, no deployment was performed, and no funds, subscriptions, marketplace actions or transaction broadcasts were used in preparing this packet.
