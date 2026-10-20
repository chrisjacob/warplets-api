# Discovery experience and navigation

21 October 2026. Local implementation of PRD §2.5 (simple, readable trading UI; separate status/admin routes), §4.3 (explicit eligibility labels) and §17.1 (freshness and visible degradation). Follows the founder’s UI/UX review: backend complexity should be available when useful, rather than required reading before the tokens.

## Implemented

- Three primary destinations: Discover, Content and My wallets. A native More disclosure groups research/information separately from local simulations and admin tools. All existing destinations remain, including The 10X Thesis. Current sections include token, campaign and election detail routes. Escape, outside pointer actions, focus leaving the disclosure and following a link close it.
- Discover starts with a short heading, eligibility/creation filters, source freshness, compact totals and token cards. Full mint addresses, artwork, eligibility labels, concrete blockers and individual reported-cap warnings remain visible. The duplicate aggregate cap notice moves below the cards.
- Collection plans, completion targets, source gaps and RPC allowances are retained behind Data & collection details after the list. A shortcut beside freshness opens the panel. Its three cached diagnostic readers mount only while expanded and abort/unsubscribe when closed. Existing `#coverage` and `#wallet-coverage-plan` links open it; this is a presentation change, not a collection scheduler change.
- Example data moves into a secondary disclosure. Synthetic mode keeps an explicit warning and a return-to-live action. Examples are never presented as evidence of a live result.
- Token details show all eligibility reasons before charts, with fee/activity diagnostics farther down. Reported-cap warnings, stale timestamps and smooth-price warnings stay visible; explanatory methods and price-fit metrics move into disclosures. All evidence, wallet-analysis and second-hop anchors remain on the page.
- System text improves body readability; addresses retain monospace. Main navigation, filters and buttons have at least 44 CSS-pixel control heights. Responsive menu columns stack on narrow screens.

## Boundaries

No policy, scoring, ordering, evidence gate, quota, API schema, backend, database, signing flow or contract changes. No extra provider integration or paid service. The homepage remains empty, and `/thesis` retains the original landing experience. Existing free-budget collectors remain independent of the browser. Closing a diagnostic panel stops its browser polling, not collection.

The ten-eligible-token target is still unmet: the local preview showed zero eligible tokens during this review. The interface does not fill the list with weaker evidence. Provider gaps, wallet sample freshness and funding completeness remain substantive blockers.

## Validation

- `pnpm exec vitest run src/discovery/DiscoveryNav.test.tsx src/discovery/navigation.test.ts src/discovery/AttentionContent.test.tsx src/discovery/ContentDuplicates.test.tsx src/discovery/walletIdentityClient.test.ts` from `app`: 28 tests passed across five files. Covers all retained navigation routes, current detail sections, native anchor/modifier behavior, and non-mounting of closed diagnostic collectors, alongside existing content/privacy and identity regressions.
- `pnpm typecheck` from `app`: passed.
- `pnpm build` from `app`: passed TypeScript, local bundle and existing aggregate performance budget. Home startup remains 233.9 KiB gzip across eleven chunks; the lazy Discovery module is 188.87 kB / 52.38 kB gzip, and its stylesheet 15.38 kB / 3.94 kB gzip.
- Local browser review checks Discover ordering, More menu/keyboard dismissal, collection shortcut and loaded diagnostics, eligible empty state, token charts before fees and retained wallet evidence links. This is a desktop browser check; dedicated small-screen device and assistive-technology testing remain open.

## Next UX work

1. Streamline the empty campaign and submission flow, introducing sign-in at contribution time and avoiding disabled forms with no available campaign.
2. Clarify the separate Solana identity and header account entry points without changing explicit signature review.
3. Add concise risk summaries with drill-down evidence for holder/wallet analysis; preserve material warnings, coverage status and direct evidence links.
4. Simplify lab summaries and move methodological explanation into expandable sections. Labs remain simulations, with real voting/launch/reward functions gated.

Local preview only. No deployment, financial execution, social publication or new authorization was introduced.
