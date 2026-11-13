# 10X.MEME — current product and production readiness

Prepared 14 November 2026. Product candidate: `fa6d8922479d25d77f1babb9957d1486341ff481`. [Audit and measurements](APP_AUDIT_2026-11-14.md) · [Screenshot workflow guide](THREE_MONTH_QA_GUIDE_2026-11-13.md).

## Brief summary

10X.MEME now has a substantial, populated local app with visitor, wallet-holder and operator workflows. The original B00–B20 implementation plan is verified: **411/411 estimated foundation story points**. Additional consumer design, performance rankings, three-month QA population, AI-review groundwork and this audit have been implemented. This is completion of the local implementation plan, **not a production-completion percentage**.

The app is available at [app-local.10x.meme](https://app-local.10x.meme) through a tunnel to the local computer. It is a synthetic demo, not a production deployment. Real financial execution is disabled. Current AI feedback is a simulation, and performance prices/history come from a dated synthetic snapshot.

The largest remaining work is production data and AI integration, hosted operational readiness, and independent resolution of custody/protocol risks before funds can move. Several choices can require implementation changes; production readiness is not simply a deployment or configuration switch. R01–R06 remain unapproved.

The exact product candidate passed [CI43498717270](https://github.com/chrisjacob/warplets-api/actions/runs/43498717270): **1,476 tests with zero failures**, plus builds, types, contracts and recovery. Local Chromium/WebKit and actual-tunnel checks also passed. This evidence validates the local scope; it does not approve hosted or financial release.

## What people can use today

The current navigation is **Home · Tokens · NFTs · Airdrops · Stake · Earn**. Performance leaderboards live within the relevant sections, with top-three previews on Home.

| Feature | Current experience | Practical limit today |
| --- | --- | --- |
| Home and onboarding | Product introduction, optional Discover/Collect/Stake/Earn/Claim paths, category explanations, five ranking previews and recent awards. | Copy and activity clearly identify the synthetic demo. Participation paths are not all mandatory; NFTs are optional. |
| Wallet connection | Explicit wallet/account selection, message-signature authentication, account switching, disconnect, session expiry and wallet menu with My stakes. Private queries are separated by identity and cleared on session changes. | Authentication is not transaction signing. Automated wallet coverage does not replace all physical Trust Wallet/mobile checks. |
| Tokens | Paginated Attention Token catalogue, token/project pairs, token details, staking links, fee/quote presentation and price-multiple rankings. Technical information is available separately. | No enabled live trading or token launch. Quote/provenance and unsigned planning infrastructure must still be connected to reviewed real providers/programs. |
| NFTs | Genesis and Season collection views, staged inventory/eligibility, owned-asset cards, mint reservations, upgrades, visual rerolls and operation history. Responsive placeholder artwork and bounded grids help with large collections. | Fulfillment has been exercised synthetically. Production payment, custody, randomness, artwork and marketplace paths remain gated. |
| Airdrops | Consolidated reward/holding views, asset allocations, vesting and claimability, plus lifetime reward valuations and links to participant breakdowns. | A lifetime theoretical valuation is not cash, current holdings or a claimable amount. Real backed claims are not enabled. |
| Stake | Campaign catalogue, positions, independent pagination, contextual token actions and withdrawal/harvest planning/read views. Synthetic stake evidence supports Earn admission tests. | Actual staking and withdrawals are disabled. The candidate protocol's administrator-access finding is a release blocker. |
| Earn | Campaign eligibility and staffed admission, content-link submission, submission status/history, scoped final review, daily boards, settlement/allocation, vested awards and public recovery artifacts. | The local full flow works with synthetic evidence. Production content capture, AI scoring, staffing, program-specific claims and funding remain outstanding. |
| Performance rankings | Five categories: Tokens, NFTs, Airdrops, Stake and Earn. Top 100 appears ten rows at a time; Peak/Market switches re-rank results; eligible signed-in users can see their rank outside the top 100. | Optional local Node projection only; no production price ingestion or Worker performance source is enabled. Missing prices remain unavailable. |
| Participant profiles | Public reward totals, category breakdowns, twenty-token pages, recent award history, earned milestones and downloadable labelled synthetic cards. | Stake accrual snapshots are excluded from dated award history because individual award dates are unavailable. PnL/trade-performance histories are not implemented. |
| Genesis advisory voting | Member vote submission and duplicate protection; separate operator/founder closure and decision workflow. Closure and founder decisions have been tested in a separate database copy. | Advisory voting is not automatic governance execution or authority to open sales. |
| Notifications and recovery | Consent, inbox and operation-status workflows; idempotent retries, retained original attempts and explicit handling of conflicts/unknown outcomes. | Production delivery services, alert channels and operating policy are not activated by the local tests. |
| Operator tools | Scoped review/actions, workload controls, audit records, readiness checks, held work, resumable jobs and reconciliation workflows. | The local operator console/bootstrap access is not a production identity/access deployment. |
| AI-review groundwork | Versioned weighted rubric, evidence-linked suggestions, validated reports, creator feedback, appeal lineage, an opt-in real-model adapter and bounded local batch runner. | No paid model calls have been made. Actual app submissions are not automatically scored. The UI example is explicitly simulated. |

Consumer lists progressively reveal bounded batches. Mobile layouts, keyboard navigation, modal focus, readable dates, form contrast and profile pagination have been improved. Diagnostic details remain available through Technical view without dominating the retail experience.

## What the engineering foundation provides

- Portable application services and typed contracts across Node/SQLite and actual local Worker/D1/R2 tests, with runtime capability discovery that prevents mounting unsupported actions/queries.
- Atomic repository changes, monotonic revisions, guarded command receipts, scoped operator authority and fenced leases/jobs. Retries preserve operation identity instead of preparing duplicate financial outcomes.
- Recorded evidence with provenance, exact-cutoff completeness manifests, consistent settlement computation and guarded commits. Missing dependencies hold processing; contradictory later evidence creates reconciliation incidents rather than rewriting finalized awards.
- Immutable artifact publication through private staging, conditional object writes, readback verification and catalog commits. Ambiguous publication resumes the original plan.
- Separate public/private recovery. Public recovery remains mutation-disabled; private restoration revokes sessions and fences old leases before local writes resume. Both preserve the financial-execution prohibition.
- Quote evidence, unsigned action plans, cost packets, readiness checks and financial gate dossiers. These prepare reviewable operations; they do not grant signing authority or prove funded outcomes.
- An isolated, deterministic QA generator and server. The current 90-day scenario has 90 tokens, 250 participants, 24,857 reward source records, 183 NFTs, 90 selected-wallet stake positions, 90 contributions/boards and 89 Earn allocations. It preserves the original manual demo database. Selected-wallet reward quantities align with canonical readers; other participants are synthetic performance history.

The current audit fixed uncached/uncompressed asset delivery, repeated concurrent compression, logout blocked by sign-in throttling, missing direct-HTTPS Secure cookie flags, public-query personalization leakage, false guest ownership badges, keyboard focus/pagination problems, faint form borders, internal day-number display and loading layout shifts. Measured cold transfer fell about 66%, repeat transfer 93–98%, and observed layout shift was zero across the final lab samples. These are local measurements, not hosted capacity guarantees. Exact results and qualifications are in the audit report.

## Work required before hosted testing

A limited hosted rehearsal with synthetic data is a useful next milestone, but requires its own concrete approval. It is separate from a funded pilot.

1. **Finish founder product review.** Review populated visitor/member/operator flows, terminology, important disclosures, error recovery and the role of rankings. Record defects and launch scope. Later mint prices and staffed Sydney launch hours remain open.
2. **Complete physical compatibility and accessibility checks.** Test actual supported wallet/browser versions, iOS/Android keyboards/rotation/interruption/network loss, and NVDA/VoiceOver/TalkBack. Simulated wallets, viewport tests and WebKit automation provide useful evidence, not device certification.
3. **Prepare the exact hosted architecture and access model.** Specify resources, bindings, origins, cookies, private operator access, least-privilege roles and secret handling. The public local tunnel is not that architecture. Synthetic sessions, bootstrap codes and credentials must not be copied into hosted use.
4. **Prepare migration and operations packets.** Pin the candidate/configuration, schema and artifact inventory, retention policy, costs, rollback, pause/hold controls, incident owner and monitoring thresholds. Rehearse private backup/restore and public proof recovery in the proposed environment.
5. **Validate the proposed environment.** Re-run acceptance on the exact candidate, review dependency advisories and production security boundaries, and measure latency/capacity under realistic concurrency. Local Node load numbers do not establish geographic performance or D1 billed usage.
6. **Approve a bounded rehearsal.** Define allowed testers, synthetic labels, disabled capabilities, precise commands/resource changes, cost caps, approval expiry and rollback. Provisioning/deployment requires explicit authorization; none has been given.

## Production data and day-one AI

**Performance data needs a real source pipeline.** Select reviewed price sources and pools; capture contemporaneous ATT/OG and OG/USD observations; define freshness, rejection/outlier and historical-high policies; retain provenance and correction history; reconcile reward sources without duplicates; and persist/query bounded snapshots in the chosen production runtime. Approve public ranking/tie policies and truthful valuation disclosures. Historical charts need reliable historical snapshots. PnL needs trade/cost-basis evidence and should not be inferred from reward valuation.

**Your requirement for AI scoring on day one makes it a launch prerequisite.** The earlier release register treated AI as optional expansion; the later product request changes that priority. The adapter and demo preview are groundwork, not a finished moderation service. Remaining work is:

- Choose and approve the model/configuration, data handling, retention and operating budget.
- Build trusted post/media capture with provenance, bounded retrieval, duplicate/spam handling and defenses against instructions embedded in submitted content.
- Calibrate the rubric on representative content, including different languages and formats, and measure consistency, failure cases and adversarial behavior. AI can be more scalable and consistent; it is not inherently unbiased.
- Connect real submissions to a durable scoring queue with cross-run idempotency, bounded retries/timeouts, cost limits, observable failures and a safe outage/abstention path.
- Present useful evidence-based feedback and an appeal route. Decide which cases require human review and how much review capacity is actually available.
- Approve final-score authority and correction policy before automatic outcomes are enabled. Current scoped final-review authority and immutable settlement must not be silently bypassed.

No real model call, new paid service or automatic final-score authority is approved by this summary.

## Financial production gates

The authoritative requirements and dependencies are in [RELEASE_GATES.md](../blueprint/RELEASE_GATES.md). These are substantive safety/implementation gates, not paperwork after the UI is finished.

| Gate | Required next outcome |
| --- | --- |
| **R01 — Permanent NFT custody** | Independently review fair reserve-to-asset assignment, current-owner claims, all unminted liabilities, permanent portable proofs and external-burn/update/plugin powers. Resolve the conflict between burn protection and required metadata/progression changes. Local fixtures do not settle production custody. |
| **R02 — Stake and Earn** | Resolve the recorded administrator path that removed 10 of 100 principal units; establish enforceable principal/reward protections, rounding, fees and empty/end-period recovery. Ratify Earn's UTC/activation-relative schedule and verify the chosen distributor's actual root/claim format, permanent allocated balances and service-independent proofs. |
| **R03 — Execution and funding** | Independently review exact instruction bytes, accounts, programs, network, signer privileges, lifetime, output bounds, fresh all-in costs and provider finality. Demonstrate ambiguous-outcome recovery. Obtain approval for the named payer/signer and exact bounded operation. |
| **R04 — Paid NFTs and providers** | Select and verify payment/draw ordering, entropy, non-withholding, timeout/refund rules, progression custody, artwork/licensing and applicable legal requirements. Perform real wallet and marketplace transfer/list/buy/cancel/royalty/current-owner-claim tests under separately approved scope. |
| **R05 — One staffed funded pilot** | Satisfy required earlier gates; back the complete allocation, including all unminted Genesis reserves; verify liquidity, fee behavior and pool/program controls; approve costs, staffing, monitoring and recovery for one initial campaign. Choose the Sydney window explicitly. |
| **R06 — Expansion** | Expand only from observed, reconciled pilot outcomes and fresh approval. The proposed condition is three consecutive settlements with no unexplained balance variance, no unresolved critical issue and measured costs within budget. Later tranches, Seasons and integrations need their applicable gates. |

The strongest immediate blockers are unresolved custody/burn compatibility, the farm administrator-access failure, actual funded claim/execution verification, and the unconnected day-one AI/data services. Some decisions may require a different implementation or a separately reviewed controller; they cannot be solved by toggling a capability flag.

## Recommended next path

**First, review the improved populated app and this scope.** Then prepare a bounded non-financial hosted rehearsal packet while independently reviewing R01/R02 and specifying real data/AI work. Implement approved integrations and validate them in the approved environment. Only after the custody/protocol and execution gates pass should a separately funded, staffed single-campaign pilot be considered. Expansion follows measured pilot outcomes.

The outstanding [founder checklist](LOCAL_TO_RELEASE_REVIEW.md) records who must review each decision. No new release approvals, deployment, funding, signing/broadcasting, purchases or subscriptions occurred during this audit. A credible production estimate should be sized after the custody/protocol choices, AI scope and hosting plan are settled; the completed 411 foundation points must not be used to imply that these remaining risks are small.
