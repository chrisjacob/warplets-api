# Customer journeys and progressive evidence

21 October 2026. Completes the requested UI/UX review beyond the [initial navigation milestone](48-discovery-experience.md). Implements PRD §2.5’s simple, readable interface while retaining the authoritative backend assessments, evidence and signing boundaries.

## Review checklist

| Review item | Result |
|---|---|
| Primary navigation | Discover, Content and My wallets remain prominent. More groups research/information and **Tools · local simulations**, including admin and The 10X Thesis. |
| Tokens before operations | Discover contains filters, compact freshness, totals and token cards. Collection plans, requests and diagnostic readers now live in Data status; old Discover collection anchors redirect there. Browser navigation does not change background collection. |
| Token decision hierarchy | Image/name/chain, copyable mint/explorer, price, reported market cap, liquidity, age, eligibility and important warnings precede charts. Known wallet relationship signals remain visible as review evidence. |
| Understandable status | Canonical Eligible/Provisional/Excluded labels remain, paired with “Required checks passed”, “Checks incomplete” or a failure explanation. Missing checks have a drill-down; all excluded reasons remain visible. “Verified” inventory/origin labels are scoped to those retained checks. No-signal wallet results explicitly apply only to a sample. |
| Evidence on demand | Identity/artwork, origin/graduation, market sources, trading/fees, holders, funding and account permissions expand individually. Existing wallet/second-hop/fee anchors open their containing disclosures. Full data and replay links remain. Market staleness, cap warnings and chart-pattern warnings are visible without opening methodology. |
| Content empty/submission states | Browsing has no disabled form or admin dead end. Open campaigns offer contribution; choosing one prompts for Solana sign-in only when needed. Closed/upcoming/unavailable campaigns never mount submission controls. Rights/feature consent and backend admission remain unchanged. |
| Solana entry and task return | The discovery header identifies Solana wallets instead of the separate EVM connect action. Legacy connections remain in the account menu and are labelled EVM. Sign-in preserves a validated local task, returns only after successful verified login, and offers an explicit Continue action for an already signed-in visitor. Message review, expiry, account-change invalidation, signing, link/unlink and logout remain explicit. |
| Experimental features | Backing, selection, curve, recovery and reward labs share “Simulation — no real votes or rewards. No tokens are launched or funds moved.” Methods and long rehearsal projections are collapsed; operational errors remain visible. |
| Readability | Body reading text is 14–15px, numerical summaries are larger, addresses retain monospace and tables use 12px. Main controls/chart periods/sign-in targets have 44px minimum height. Summary grids and menu columns adapt to narrow screens. |

## Sign-in navigation and evidence safeguards

- `safeWalletReturn` accepts bounded relative paths for the homepage/thesis and public discovery, content, campaign/submission, token, research, status and simulation views. External/protocol-relative/control-character/backslash routes, wallet loops, APIs and admin routes fall back to Discover. A return path grants no identity or permission.
- Automatic return is permitted only after the existing signature verification response confirms authentication for a login challenge. Link/unlink and failed verification never trigger it. Responses after an account change or component disposal are ignored. Direct wallet management has no automatic return.
- Evidence disclosure anchors use exact document IDs, decode safely and open only the containing hierarchy; untrusted strings are never interpreted as CSS selectors or HTML.
- Campaign timing and sign-in conditions control presentation only. Server validation, signed identities, moderation/holds, request IDs and eligibility gates remain authoritative and unchanged.
- No production-looking content is seeded into the main local database. Positive campaign/form paths are checked with isolated in-memory test inputs. No real wallet signature is requested during browser QA.

## Validation and boundaries

`pnpm exec vitest run src/discovery` from `app` passes all 54 UI tests across seven files. These include closed/future/missing campaign admission, form non-mounting, malicious return links, verified-login-only return, visible known failures, unknown market cap versus FDV, stale timestamps, escaping, evidence anchor opening and existing identity/content/navigation regressions. `pnpm typecheck` passes.

Local browser QA covers Discover, real token summaries, closed/open evidence panels and second-hop deep links, the empty Content page, Solana task-return links, Data status diagnostics and common lab notices. Real signing is covered by the existing mocked wallet/client tests and the added return-policy tests; it is not claimed as a live wallet exercise. Dedicated small-screen-device and assistive-technology testing remain open.

`pnpm build` passes TypeScript, Vite and the original aggregate startup budget: **234.1 KiB gzip across eleven home startup chunks**, below the unchanged 250 KiB limit. The first bundle check exposed a new shared helper being folded into the home chunk and changing its manifest identity. The shell now constructs only a local navigation hint; validation remains in the discovery consumer. The final stylesheet refinements are also checked with `pnpm exec vite build` and `pnpm performance:budget`; no budget threshold or checker was changed.

All changes are local presentation/navigation. No backend/schema/migration, scoring, evidence gate, provider budget, treasury, launch or reward capability changes. The homepage stays empty and `/thesis` keeps the landing experience. Ten recent eligible tokens remains an unmet coverage target, rather than a display guarantee. No deployment, social publication or financial execution.
