# 10X — Brand, product and app-local alignment

**Product requirements document | 24 November 2026**  
**Audience:** AI coding agent / product designer / maintainer  
**Status:** Implementation brief; explicitly identified recommendations remain provisional  
**Target:** Existing 10X.MEME app-local experience and its supporting product documentation

## 1. Executive brief

Reposition 10X as a culture-led memecoin brand celebrating exponential thinking and extraordinary human achievement. The first original monthly memecoin is **10X ($10X)**, the brand's own meme, replacing the previous Warplet/Farcaster-themed first launch. The long-term ambition is to build original memecoins with enduring cultural relevance, using daily Attention Tokens to attract and engage the memecoin trenches, a permanent 10X NFT collection to build continuity, and monthly collectible editions to create reasons to return.

This is a brand, information architecture, content, design and roadmap alignment task, not a ground-up rebuild or a request to redesign smart contracts. Preserve working functionality and established economic decisions. The interface must distinguish real, available features from planned features. A visitor should understand what 10X is, what it offers, what is available now and what comes next without needing to understand its entire tokenomics model.

### Goals

- Establish $10X as the first original 10X Meme and the cultural anchor of the brand.
- Replace internal product terminology with intuitive public names.
- Make the monthly 10X Meme the core product and daily Attention Tokens its attention/acquisition engine, not the other way around.
- Express an ambitious, optimistic and politically independent brand across all public touchpoints.
- Align the website, launch/beta presentation, product pages, metadata, in-app explanations, roadmap and supporting documentation.
- Preserve existing architecture, launch constraints, rewards logic and validated implementation unless a specific change is authorised.

### Non-goals

No new on-chain deployment, mint, liquidity change, token allocation, market-making activity, automatic purchasing, paid campaign, or external publication. No retroactive change to historical records or deployed contracts. No speculative token price promises or invented traction. No new social network or content platform. No expansion of token discovery beyond the existing product scope. Do not touch unrelated 10X Network or legacy projects.

## 2. Decision hierarchy and conflict resolution

This PRD supersedes earlier branding and first-launch theme decisions, not every previous product requirement. Reconcile it with the latest repository decision records and live implementation before changing anything.

| Status | Decision |
|---|---|
| Confirmed | First original monthly memecoin is 10X ($10X), not Warplet/Farcaster themed. |
| Confirmed | Public product names: 10X Meme (replaces Originals), 10X NFT (replaces Genesis), Attention Tokens. |
| Confirmed | Target cadence: one original per month; up to one daily Attention Token; one permanent 10,000 NFT collection; 1,000 seasonal collectibles per monthly edition. |
| Confirmed | Standalone Season 0 beta with US$1 collectible mint (90% discount from intended US$10 standard pricing); later launches are not yet scheduled. Preserve existing approved paired-token campaign dates where known. |
| Confirmed | No CEX reserve, discounted OTC listing allocation or listing-linked burn plan. |
| Proposed default | Brand line: 10X Everything. Mission: 10X Memecoin Culture. Philosophy: 10X, not 10%. Culture: Celebrate the extraordinary. CTA: Think 10X. |
| Proposed default | Public seasonal collectible name: 10X Cards. Keep the label configurable pending final naming. |
| Open | Final original memecoin allocation and designer allocation; do not implement an allocation based on this PRD. |
| Open | Final card visual treatment, final brand artwork, actual future launch dates and which capabilities are ready for public beta. |

The proposed defaults are sufficient for a coherent local design and copy pass. They are not approval for irreversible launch or financial decisions. If code and documentation conflict, record the discrepancy in the implementation report. Use the most recent explicitly confirmed decision for UI content; do not silently change live economic behaviour. Never resurrect an older token model solely because an older PRD contains it.

## 3. Brand architecture

### Brand positioning

10X is a memecoin brand built around the idea of thinking bigger: not incremental improvement, but the pursuit of extraordinary outcomes. Its products are crypto-native; its culture can be understood by anyone.

| Layer | Recommended canonical copy | Role |
|---|---|---|
| Master brand | 10X | Stable identity |
| Movement / headline | 10X Everything. | Broad cultural ambition |
| Philosophy | 10X, not 10%. | Exponential thinking, not a return target |
| Culture | Celebrate the extraordinary. | Editorial and creative direction |
| Mission | 10X Memecoin Culture. | Product-specific purpose |
| Rallying cry | Think 10X. | Flexible CTA or sign-off |
| First meme | 10X ($10X) | The brand embodied as a memecoin |

Use one or two relevant lines per surface; do not stack every tagline everywhere. **10X Everything** is an aspirational mindset, not a claim that prices, wealth or rewards will rise tenfold. “Make Memecoins Great Again” should not be the default mission, homepage headline, SEO tagline or permanent brand descriptor. Its association with a political slogan creates unnecessary ambiguity. It may be used as occasional nonpartisan meme copy if explicitly approved, but no such campaign is in scope here.

### Voice and audience

Confident, optimistic, concise, internet-native, ambitious, playful and substantive. Avoid corporate jargon, faux motivational hustle language, partisan references, get-rich-quick framing and claims of superior investment outcomes. Speak to both crypto-native users and curious newcomers. The brand is not affiliated with SpaceX, Red Bull, XPRIZE, Google X, Farcaster or other reference brands merely because they inspire it.

### Editorial direction

Use extraordinary achievement as the brand's creative territory: technology and engineering (AI, robotics, space), human performance and audacious challenges, cultural creativity, new forms of coordination and civilisation, and crypto innovation and internet culture. Crypto success stories may be discussed with context, not as typical outcomes or purchase inducements. Prefer verifiable achievements over hype. Reference third parties accurately and without implying sponsorship or endorsement. This guides the existing content surfaces and marketing copy; do not build a new editorial CMS or news feed just to implement this brief.

## 4. Product architecture

| Public product | What it is | Target frequency/supply | Strategic role |
|---|---|---|---|
| 10X Meme | An original, culture-led memecoin launched by 10X | 1/month after beta | Core product; ownable culture and community |
| 10X NFT | Permanent collection with Level-based ecosystem benefits | 10,000, one-off | Long-term continuity and loyalty |
| Attention Tokens | Separate tokens that direct focused attention to selected memecoins, including associated campaigns where applicable | Up to 1 new daily spotlight after readiness; skips allowed | Acquisition, engagement and support for the trenches |
| 10X Cards (provisional) | Limited monthly digital collectibles associated with a 10X Meme season | 1,000 per monthly edition | Repeat participation, collection and retention |

The distinctions must remain clear:

- 10X Meme is a product category; $10X is its first specific token. Do not use $10X as the ticker for future originals or for Attention Tokens.
- A 10X Meme is a pure cultural memecoin, not automatically a utility, governance, revenue-sharing or reward token. Do not bolt ecosystem functionality onto $10X in this task.
- Attention Tokens are separate assets, not the selected underlying meme itself. A monthly paired Attention Token may have a different campaign duration from the daily spotlight product. Do not conflate the two schedules or assume the $10X token is the reward token.
- 10X NFT is the permanent collection. Cards are seasonal collectibles with finite utility under existing rules. Both may technically be NFTs. Calling the latter Cards does not change token standards, ownership or transfer rights.
- A Season is a campaign/edition/time period, not an additional standalone asset type. Use a stable season identifier. Distinguish campaign end from collectible-specific utility expiry.
- The historic Base Warplets remain historical assets. Do not rename their on-chain collection or erase their provenance. Do not imply they retain ongoing utility if that has been superseded by the permanent collection.

### Product flywheel (strategic hypothesis, not guaranteed)

Daily Attention Tokens bring new users and concentrated attention to 10X; users discover the monthly original; monthly Cards offer a reason to return and collect; permanent 10X NFTs provide continuity and long-term participation. Subsequent original launches create fresh cultural narratives and new reasons to engage. There is no implied automatic economic value transfer among these products.

## 5. Naming and terminology migration

| Previous user-facing term | New display term | Implementation constraint |
|---|---|---|
| Original / Originals | 10X Meme / 10X Memes | Preserve existing internal enum/IDs where useful |
| Genesis / Genesis NFT | 10X NFT | Preserve collection identifier and deployed metadata |
| Season NFT / Seasons NFT | 10X Cards (provisional) | Retain technical NFT descriptions where appropriate |
| Season / Seasons | Season / Seasons | Keep for campaign chronology and history |
| ATTN / Attention Token | Attention Token | Keep actual token tickers; never rename on-chain assets |
| First original: Warplet | 10X ($10X) | Change planned theme only; never relabel an existing deployed Warplet token |

Create or reuse a central public terminology/content source (typed configuration, copy dictionary or existing CMS/i18n equivalent). Use canonical labels across titles, cards, navigation, empty states, tooltips, onboarding, help, roadmap, metadata and fixtures. Prefer a display alias over invasive schema or route renames. Keep old URLs working and use redirects only where beneficial and supported. Internal names may remain where they represent genuine technical or historical concepts. Do not perform an indiscriminate global find-and-replace.

## 6. App-local UX and information architecture

### 6.1 Navigation

Inspect current navigation before changing it. Prefer retaining existing destinations rather than adding one top-level tab per product. The most recent proposed simplified navigation is Home, Tokens, NFTs, Airdrops, Attention and Leaderboard. Reuse current equivalents where routes differ; Stake/Earn/Vault destinations must remain accessible through the existing navigation or related product pages. Do not create duplicate or empty tabs solely to conform to a label list.

| Destination | Required content hierarchy |
|---|---|
| Home | Brand; first/featured monthly meme; what is available now; four-product overview; upcoming roadmap; genuine live metrics if present |
| Tokens | 10X Memes first; Attention Tokens as a distinct section/filter; no conflation of token types |
| NFTs | 10X NFT and 10X Cards as distinct permanent/seasonal categories |
| Airdrops | Existing claimable/earned rewards and applicable eligibility; no invented balances |
| Attention | Existing daily spotlight/discovery/participation experience, including truthful status for beta vs planned |
| Leaderboard | Existing meaningful performance metrics and filters; truthful timestamps and metric definitions |

On mobile, keep existing navigation patterns and accessible labels. Maintain deep links and primary actions. No Stonklets or legacy products in primary navigation unless already explicitly required elsewhere.

### 6.2 Home page — target hierarchy

1. **Hero:** 10X Everything. Brief explanation of 10X as a culture-led memecoin brand. One primary CTA matched to the real launch state (e.g. Explore $10X / Learn about $10X). Secondary CTA: How 10X works.
2. **Featured meme:** 10X ($10X), the first 10X Meme. Indicate Season 0 beta if appropriate. Include token-specific details and on-chain links only once verified and applicable. Use a distinct token art/brand mark and never display Warplet art as the new flagship's artwork.
3. **Live/next product:** Surface what users can actually do now: explore a launched token, view a beta campaign, mint a collectible if available, or learn about planned products. Do not invent a waitlist, signup or mint flow.
4. **Four products:** Four compact cards, with monthly 10X Meme visually first, permanent 10X NFT, Attention Tokens and 10X Cards. Show cadence and purpose; link to existing real detail destinations where available.
5. **How it works:** A simple explanation of attention → discovery → collecting/participation → continuity. Avoid a complicated token-flow diagram on the homepage.
6. **Roadmap:** Clearly distinguish standalone beta, subsequent monthly product target and planned daily cadence. Show approved dates only. Link to further detail if implemented.
7. **Footer:** Product help, terms/privacy, chain/contract references and appropriate risk disclosures consistent with existing site policy.

If reliable live metrics and mini leaderboards are already present, retain them below core product messaging. Do not use placeholder gains, fake activity or fabricated token launch performance.

### 6.3 Suggested copy (editable canonical starting point)

**Hero**  
10X Everything.  
Think exponentially. Celebrate the extraordinary.  
10X is a memecoin brand for people who think bigger. We create original memecoins, amplify the culture and build reasons to keep coming back.

**Featured first meme**  
10X ($10X)  
The first 10X Meme. A meme for those who think bigger.  
Inspired by extraordinary human achievement, exponential innovation and the belief that the future can be bigger than the present.

**10X Meme**  
Original memecoins. One new cultural idea at a time. Our target is one launch per month.

**10X NFT**  
10,000 permanent digital collectibles. Your ongoing connection to the 10X ecosystem, with Level-based benefits under the published rules.

**Attention Tokens**  
Focus the trenches. Discover selected memecoins and participate in attention campaigns. Our target is up to one new spotlight per day.

**10X Cards**  
1,000 limited-edition digital collectibles per season. Collect, trade and, where supported, upgrade them. Utility is seasonal; ownership is not necessarily time-limited.

**Roadmap introduction**  
Start with one standalone beta. Learn from real participation. Expand to a monthly launch cadence and daily attention campaigns when the product is ready.

Use plain-language risk notices where users encounter token purchase, mint or reward actions. For example: “Memecoins are speculative and can lose their entire value. 10X is a brand philosophy, not a promise of returns.” Verify final legal language against approved policies; do not unilaterally rewrite legal documents.

### 6.4 Token and collectible detail pages

- Clearly display token type (10X Meme vs Attention Token), asset name, ticker, chain, verified contract where available, and relationship to the campaign or underlying meme. Avoid shared imagery that makes two different tokens indistinguishable.
- On collectible pages distinguish permanent collection vs seasonal edition, supply, Level (where relevant), mint status, current utility, expiry and any supported upgrades/rerolls. Use real metadata, not guessed rarity or benefits.
- Retain existing price charts, staking, earn, vault and claim functionality if supported. Any displayed numbers must have a clear source and meaning. Separate realised rewards from estimated present or historical values. Do not introduce ATH-only return marketing as part of this branding change.
- If a product is planned and has no usable route, present truthful informational copy rather than a non-functional CTA or dead-end screen.

## 7. Visual design direction

Evolve the existing design system rather than create an unrelated theme. Aim for bold, minimal, high-contrast, contemporary and distinctly internet-native. Make the 10X wordmark and strong typography the visual anchor; use restrained accent colours and deliberate imagery rather than a dashboard full of competing emphasis. Preserve an existing established palette if it supports this direction; no mandatory full rebrand of design tokens is implied.

- **10X Meme:** hero-scale art, strong cultural identity, largest editorial emphasis; future memes may have distinct artwork within a consistent frame.
- **10X NFT:** permanent, premium, collection-led aesthetic; distinguish Level and long-term role through clear labels.
- **Attention Tokens:** compact, high-information cards with clearly labelled statuses and actual market data where available; use focus and momentum as metaphors without presenting tokens as guaranteed opportunities.
- **10X Cards:** consistent collectible template, edition and Level indicators, optional visual rarity/traits if supported; season art is modular and not hard-coded to Warplets.
- **Shared system:** consistent typography, spacing, buttons, focus states, contrast and responsive layouts. Support existing light/dark modes where present. Avoid politically coded hats, campaign typography, flags or visual mimicry of MAGA branding.

Use existing licensed assets and original brand elements. Where final $10X art does not yet exist, use a clearly provisional typographic brand treatment in local development; document the missing production asset. Do not import reference-brand logos or generate final brand artwork without separate authorisation. Update favicons/social previews only with verified or approved assets; remove stale theme references on current launch surfaces, not historical archives.

## 8. Roadmap and launch sequencing

Roadmap represents intended sequencing and readiness, not commitments to dates or automatic activation.

| Phase | Scope | Public status/copy rules |
|---|---|---|
| Foundation | Brand alignment, canonical product names, $10X launch theme, consistent app-local UX | Internal implementation phase, not a token launch |
| Season 0 — standalone beta | First 10X Meme: $10X; associated 1,000 monthly collectibles with US$1 beta mint; separate paired Attention Token campaign as previously planned, where ready | Display confirmed availability and exact approved campaign start/end dates. Keep the established Season 0 identifier rather than inventing Season 001. |
| Beta learnings / readiness | Validate user comprehension, participation, operations and technical/economic readiness; resolve launch allocations and other blockers | No promise that the next launch will occur exactly one month after beta |
| Monthly 10X Meme cadence | New original and 1,000 seasonal collectible edition per month; normal target mint pricing US$10 subject to the approved release configuration | Planned until formally scheduled; no invented date for Season 1 |
| Daily Attention Token cadence | Target up to one spotlight per day with authority to skip or extend, alongside existing overlapping reward campaigns | Planned until launch readiness; no invented start date |
| Permanent 10X NFT | One-time 10,000 collection, benefits and migration as already decided | Sequence according to actual dependencies and approved release plan; do not assume it mints simultaneously with the beta |

The post-beta monthly cadence, daily cadence and permanent NFT activation need not occur in the table order; dependencies and real readiness determine rollout. If the repository contains already approved exact dates for the beta paired-token campaign, preserve and render them with the explicit timezone. If absent, mark as TBD internally and block date-specific publication; don't calculate a date from an inferred month or launch day. Display target cadence separately from current schedule. No speculative launch countdowns.

## 9. Economics and engineering guardrails

The agent must inspect the latest approved model, implementation and release configuration before surfacing economics. This PRD does not authorise economics changes.

- Keep original monthly meme and associated Attention Token allocations separate. Preserve the prior decision against CEX reserve/OTC/listing-linked burn. Designer allocation and remaining original sale/liquidity split are open; do not ship a new allocation or advertise it as final.
- For daily Attention Tokens, the later approved model in prior decisions was 80% OG-paired liquidity, 10% Earn, 5% Stake, 2.5% permanent NFT vault and 2.5% seasonal vault (full 5% to permanent NFT vault when the seasonal vault is inactive). This is a reconciliation reference, not a contract migration instruction. If the live implementation or newer approved spec differs, flag it. Never copy the older native/OG/$10X three-pool model into current copy without explicit approval.
- Preserve existing daily reward windows, stake eligibility, Level mechanics, claims, vesting, burns, airdrop rules, launch fee schedules and security boundaries. Do not apply the daily campaign duration to the separately configured monthly paired campaign. Do not infer eligibility or promise rewards from ownership alone.
- Preserve existing token identities, contract addresses, chain selection, chain adapters and permission checks. Do not conflate Solana brand assets with legacy Base assets, or imply multi-chain launches are live when not verified.
- Do not create a $10X ecosystem-wide pair, treasury linkage, buyback, burn, governance or profit entitlement merely because $10X is the brand token.
- Do not reset databases, alter economic fixtures used for production, or remove working features. Keep mock beta data explicitly marked and separate from real data.

## 10. AI agent implementation plan

### A. Audit and establish baseline

Locate the app-local project and the relevant package/workspace using the actual repository layout. Read AGENTS.md or equivalent, current decision logs, roadmap, app routes, shared UI, product definitions, config, mock/production boundaries and test commands. Record branch and worktree status; preserve unrelated user changes. Identify all references to Originals, Genesis, Season NFTs, Warplet/Farcaster first-launch themes, and old slogans. Classify occurrences as current UI, shared config, technical, legal or historical. Identify competing economic specs without treating the oldest or most verbose one as authoritative.

### B. Establish canonical configuration

Reuse or create a typed public product/brand copy definition and first-launch presentation config. Separate stable product ID and asset type from display name. Represent launch/availability status through the existing source of truth. Keep season identifier, dates, collectible supply/price, token contract and live metrics sourced from actual verified config/data; do not hard-code a fictitious contract or time. Mark 10X Cards as provisional in internal docs, not as a warning banner across the UI. Update relevant fixtures and tests with these distinctions.

### C. Implement the UI and copy pass

Update home, navigation labels, token list/detail, NFT list/detail, existing launch/beta screens, onboarding, help/FAQ, empty states, reward screens where necessary, and roadmap. Apply reusable design components and existing patterns. Keep active product state/action truthful. Update relevant page title, descriptions, Open Graph/social copy, structured metadata and other public-facing content if they exist. Maintain accessibility, localization if present, and route compatibility.

### D. Align documentation

Update active product PRD/decision log, roadmap, README/product overview, implementation backlog, internal agent context and launch checklist where present. Record this as a dated decision change, including that Warplet first-launch theming is superseded, CEX allocation is excluded, and designer allocation remains open. Preserve prior dated records as historical; do not rewrite history to imply earlier launches never existed. Avoid duplicating multiple contradictory sources of truth; link to the canonical record instead.

### E. Validate and hand off

Run repository-standard lint, formatting, type-check, targeted tests and build. Test the actual app-local UI on mobile and desktop using available browser tooling. Exercise planned vs beta vs live states, first token, campaign date status, NFT/season distinction, relevant routes and reward visibility. Verify no on-chain transaction or production deployment occurs. Review diffs for unrelated changes and provide a summary of modified files, tests, screenshots if available, unresolved decisions and follow-up dependencies. If a test cannot run, report the actual blocker and remaining risk.

## 11. Acceptance criteria

| ID | Required outcome |
|---|---|
| AC-01 | The homepage and current roadmap identify $10X as the first original 10X Meme, without any stale Warplet/Farcaster first-launch theme. Historical assets remain correctly identified. |
| AC-02 | All current public product naming consistently uses 10X Meme, 10X NFT, Attention Tokens and the provisional 10X Cards label. Technical IDs are stable. |
| AC-03 | A visitor can distinguish the first meme, the separate Attention Token, the permanent NFT and seasonal collectibles from the homepage without specialist knowledge. |
| AC-04 | The monthly meme is the core product; Attention Tokens are an inbound attention/engagement mechanism, not presented as the only reason 10X exists. |
| AC-05 | Brand copy uses nonpartisan exponential-thinking positioning; no permanent MAGA-style mission, price guarantee or implied third-party affiliation. |
| AC-06 | Season 0 is a standalone beta, with 1,000 seasonal collectibles and US$1 beta pricing where applicable. Later launch dates remain unscheduled unless explicitly approved; beta campaign dates are sourced from approved records. |
| AC-07 | Planned features are not presented as live. Links and primary actions are valid, and inactive features are informational rather than broken. |
| AC-08 | Existing routes, verified token identities, economic logic, contracts, permissions and unrelated projects are preserved. No unauthorised tokenomics changes. |
| AC-09 | Mobile and desktop layouts are readable and accessible; no horizontal overflow, inaccessible controls or broken visual hierarchy. |
| AC-10 | Active roadmap and product docs reflect the new hierarchy; unresolved economic and naming decisions are explicit, not silently finalised. |
| AC-11 | Required repo validation commands pass, or documented blockers and failures are reported accurately. |
| AC-12 | No fabricated market data, contract addresses, launch dates, collectible benefits, partnerships or investment outcomes appear. |

## 12. Success measures and open decisions

Use these as product evaluation questions rather than inventing numerical KPI targets: Can a new visitor explain what the four products are? Can they tell the difference between $10X and an Attention Token? Can they identify what is available now and when the next confirmed campaign begins? Do users return from attention campaigns to explore original memes or collectibles? Where existing analytics allow, track discovery-to-meme-detail engagement, seasonal participation and return visits. Reuse existing analytics with appropriate consent; no new tracking vendor is required.

Open decisions before public launch: final brand tagline/mission approval; final 10X Cards naming and artwork; original supply split and designer allocation; final $10X artwork; approved beta campaign dates if missing; readiness and dependencies of the paired Attention Token, monthly cadence, permanent NFT and daily launches. Resolve irreversible or financial decisions through explicit owner approval. A coherent local brand/UX pass may proceed with the documented defaults without resolving them all.

## 13. Builder directive

Implement this as a cohesive app-local change, not merely a copy edit or new mockup. Start by auditing the repository; use the existing stack, components and real data sources. Prioritise clear, minimal, product-led UX over adding features. When a decision is provisional, keep it reversible. When a fact is missing, do not invent it. Preserve working behaviour, technical identity and unrelated work. Return the implemented changes, validation results and a short decision/blocker register. Do not deploy to production or submit on-chain transactions as part of this task.
