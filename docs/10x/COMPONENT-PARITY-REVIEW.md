# Warplet component parity and guided experience

Reviewed 31 October 2026, following the initial mobile brand update in PR #124.

## Review and implementation plan

The live Warplet app and its local source establish more specific conventions than a black/green palette: a named app badge between logo and account controls, outlined panels, split modal chrome, rounded full-width actions with a green offset shadow, illustrated app menu cards, top-edge feedback and a shared legal footer.

Implement those small reviewed patterns within `meme/`, without importing the Warplet/discovery/Network application. Preserve the existing Connect package, authentication, exact accounting, production isolation and disabled financial controls.

| Area                | Review finding                                                                                                    | Implemented response                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header              | A static URL badge did not behave like the product name/account badge in Warplets.                                | Named `10X Meme` account control, familiar logo/menu spacing and existing Connect entry points.                                                                                                                                                                                |
| Controls and panels | Card headings, primary/secondary actions and corner styles were inconsistent.                                     | Green section headings, black panels, 20px action corners, the reviewed green offset shadows, clear secondary actions and touch-sized controls.                                                                                                                                |
| Menu                | A list of links did not resemble the illustrated app menu.                                                        | Two local Warplet/Stonklet artwork cards with green labels, a clear guide entry and thesis/legal links.                                                                                                                                                                        |
| Footer              | Legal links were available only inside the menu.                                                                  | The same company notice and visible Terms of Service/Privacy Policy links as the other apps, plus the guide link. Local-only tools stay separate.                                                                                                                              |
| First visit         | A large inline three-step guide competed with the vote.                                                           | A small, dismissible invitation. The optional illustrated tour uses native modal focus containment, a fixed title/action area, scrollable information cards, step indicators and full-width actions.                                                                           |
| Returning users     | The page did not clearly identify the user's next task or saved choice.                                           | A read-only progress strip and one state-specific next step: Farcaster → verified Solana wallet → vote. Saved choices, selection/skip and the path to rewards are explicit.                                                                                                    |
| Wallet setup        | A missing Solana wallet could be a dead end; a previous holding-wallet choice could persist on reopening Connect. | Practical wallet-browser guidance and the reward-wallet purpose restored when Connect opens. Existing wallet/sign-in implementations are reused. Base/Warplet boosts stay optional.                                                                                            |
| Feedback            | A successful vote was mostly a changed button; share errors and clipboard results could be missed.                | Warplet-style green/red top toasts for deliberate actions, with close controls and reduced-motion support. Errors remain inline after the toast closes. Existing connection confetti/feedback stays intact; vote haptics use only an advertised host capability after success. |
| Performance         | Richer guidance could enter startup or replay state unnecessarily.                                                | The illustrated guide loads only on demand; its absence from the startup graph is enforced. No new dependency, provider collection, price replay or automatic wallet prompt.                                                                                                   |

## Guidance rules

Connect, vote and clipboard feedback use one app toast surface, so successive success messages do not overlap. Existing Connect authentication and confetti functions are reused. Empty rewards, reward rankings and history offer a direct return to today's vote rather than ending without an action.

- Loading/unknown session data never implies that setup is complete.
- Farcaster supplies participation identity; a verified Solana reward wallet is the next required step. Linked Base wallets provide optional Warplet boosts.
- The saved-vote state comes from the round response; no optimistic reward, points or vote receipt is invented.
- Closed, paused, stale, selected and skipped rounds never invite a new vote. Selection is explicitly distinct from an actual launch.
- Final allocations, funding, release and claims remain distinct. Rewards are not presented as guaranteed or immediately claimable.
- The guide explains both ATTN/OG price exposure and amplified losses, the final top 100, ten releases starting launch +24h, public trading ranks and no reward for sharing.
- Completing/dismissing onboarding persists when storage is available and stays dismissed across tabs if storage is denied. The tour can always be reopened. Explicit launcher references restore focus reliably in Safari; opening help preserves the reader's page position.

## Verification

Validation passed: `pnpm --dir meme check` (boundaries, app/Worker types, 125 core tests, 11 script checks, production build and local Worker dry run); all 62 desktop/mobile/WebKit browser checks; all 10 populated QA/admin journeys. The final modal/touch polish also passed all 18 targeted Chromium/WebKit checks.

Static startup is approximately 76 KiB gzip against the existing 80 KiB budget. The guide is excluded from startup, QA UI remains excluded from production JavaScript, and no new dependency was added.

Browser coverage includes anonymous, signed-in/unverified, verified, saved-vote and expired-round states; successful/changed/rejected vote feedback; small-screen guide controls; focus return from menu and footer; storage-denied onboarding; images, routing, shared Connect and financial guards. Modal scrolling stays within the dialog, slide changes reset its reading position, and the account badge keeps a 44px tap target around its familiar visual shape.

The browser projects cover Chromium desktop/mobile viewports and targeted WebKit checks. Short-screen checks use 320×480; ordinary layout checks include 320, 390, 500 and 1280px widths. Viewport/WebKit coverage does not certify physical phone wallet handoffs or host haptics. Those remain in the real-device QA plan.

The local review is at `http://127.0.0.1:5198/?qa=seeded`. No merge, deployment, live provider collection, external social send or financial action is included.

## Source references

- `app/src/miniAppChrome.tsx`, `app/src/index.css`: header, menu cards, controls, modal and toast conventions.
- `app/src/SearchApp.tsx`, `app/src/stonkletsOnboarding.css`: illustrated modal layout, information cards, steps and actions.
- `app/src/SiteFooter.tsx`, `app/src/StonkletsToast.tsx`: legal footer and feedback behavior.
- Reused artwork: `app/public/favicon-warplets-v2.png` and `app/public/favicon-stonklet.png`, copied into the isolated package and loaded lazily in the menu.
