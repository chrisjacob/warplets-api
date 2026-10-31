# Mobile product review · 31 October 2026

## Direction

Keep the launchpad in the existing 10X product family: black surfaces, neon green actions, compact rounded controls, the established 10X mark and a centered mobile shell. The reference products were the public 10X home, Warplet and Stonklet apps, cross-checked against their local shared shell styles. A wider desktop layout is a later product decision.

The primary journey remains **Connect → vote → follow selection → claim**. The interface must distinguish an advisory vote from operator selection, a provisional score from a final allocation, and released rewards from unfunded allocations. A price comparison must show losses as clearly as gains.

## Findings and changes

| Finding                                                                             | Implemented change                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The sage palette and wide layout did not resemble the existing mini apps.           | Black/neon green visual system, 500px shell, existing logo and a lightweight static matrix poster. No video, remote font or additional UI library.                                                                                                                 |
| Chrome and secondary links lacked the familiar product structure.                   | Compact logo/account/menu header; accessible native menu with the existing products, thesis and legal pages. Existing Connect behavior is retained.                                                                                                                |
| Long stacked candidate cards obscured the daily choice.                             | Compact candidate rows, one obvious vote control, selected state, per-candidate saving state, voter totals and an estimated boost summary. Identity, ownership and deadline checks remain authoritative.                                                           |
| Unrounded display values were difficult to scan.                                    | Format estimates and signed performance values for display; exact token amounts and settlement arithmetic remain unchanged.                                                                                                                                        |
| Tiny static charts were hard to inspect on phones.                                  | Larger matched-time chart, consistent green ATTN/purple OG legend, baseline, keyboard inspection and touch/pointer readout. Missing observations still break the lines; missing ATTN prices stay unknown.                                                          |
| Price performance and realized trading profit could be confused.                    | Separate price-return metrics and realized net trading rankings; retained fee, coverage, freshness and loss disclosures.                                                                                                                                           |
| A full Top 100 made the initial page excessively long.                              | Initially show 20 rows with progressive expansion through every rank. Show the participant's reward rank independently; retain trader lookup, periods, public profiles and P&L sharing.                                                                            |
| Reward balances obscured their operational state and actions appeared too far down. | Released/upcoming/claimed asset counts, separately grouped unfunded allocations, collapsed claimed balances and actions near the overview. Different token amounts are never combined into a fictitious monetary total. Loaded-campaign coverage remains explicit. |
| Menus and QA share previews needed predictable focus.                               | Native modal focus containment, Escape dismissal and return focus; explicit help focuses its heading. Reduced motion, safe-area spacing, keyboard tabs, a skip link and readable touch controls are retained.                                                      |
| Navigation and developer tools added friction.                                      | Selected view persists on reload; sticky view tabs remain available while scrolling. Design preview is grouped under development-only local tools. QA simulation controls remain clearly identified.                                                               |
| Discovery and share artwork used a different palette.                               | Regenerated bounded offline icon/social PNGs and updated the existing share renderer. The original 10X mark is copied into the isolated package's asset pipeline; application imports still stay inside reviewed package boundaries.                               |

## Validation

- `pnpm --dir meme check`: package boundaries, app/Worker typechecks, 125 core regressions, 11 script/asset checks, production build and local Worker dry run.
- `pnpm --dir packages/meme-qa test:browser`: 53 desktop/mobile browser checks, including three Safari-engine checks, 320/390/500/1280px layout, skip-link/menu focus, reload-safe navigation and keyboard chart inspection without API writes.
- `pnpm --dir packages/meme-qa seed:browser`: populated month and private admin journeys, progressive access to all 100 ranks, voting, simulated trades/claims and native QA share focus behavior.
- Final static startup: approximately 74 KiB gzip, below the existing 80 KiB limit. Panels and Connect remain lazy-loaded. QA seed data, share-preview UI and legacy design fixtures are excluded from production JavaScript.
- Local screenshots inspected for Today, Rewards, Leaders, History and narrow/desktop layouts; no page errors or horizontal overflow in the review harness.

Browser automation uses disposable local accounts and isolated data. Viewport checks do not certify physical iPhone/Android wallet handoffs or mini-app host behavior. Actual phone and real-wallet checks remain in the delivery QA plan. No deployment, production-data mutation, provider collection or financial transaction is part of this review.

## Review locally

- Populated app: `http://127.0.0.1:5198/?qa=seeded`
- Private local admin: `http://127.0.0.1:5198/__adminhidden/meme?qa=seeded`
- Normal local app: `http://127.0.0.1:5198/`

Keep the production financial controls and existing provider caps unchanged. Launch/funding/claims activation and a wider desktop design remain separate work.
