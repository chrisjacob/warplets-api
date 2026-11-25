# 10X brand and app alignment — 24 November 2026

Status: confirmed product direction; brand architecture adopted by the owner on 25 November 2026. Scope: existing app-local, under `platform/`. Authority: [attached brand and app alignment PRD](10X_MEME_Brand_and_App_Alignment_PRD.md). This record supersedes conflicting brand, public terminology and first-launch theme decisions in PRD 1.2 and older handoffs. It does not supersede approved economic mechanics, historical records or release gates.

## Current product direction

| Stable concept | Public name | Role and target |
| --- | --- | --- |
| original | 10X Meme | Core product: one original cultural meme per month after readiness. First specific asset: 10X ($10X). |
| genesis | 10X NFT | One permanent 10,000 collection with Level-based benefits and eligibility. |
| attention | Attention Tokens | Separate assets around selected memes; acquisition and engagement. Target up to one daily spotlight, skips permitted. |
| season | 10X Cards | Provisional name for 1,000 seasonal collectibles per monthly edition. Seasonal utility; ownership and historical allocations persist. |

A Season identifies an edition/campaign period, not a fifth asset. Season 0 remains the standalone beta. The first planned meme is $10X, superseding Warplet/Farcaster first-launch theming. Historic Base Warplets retain their name, provenance, contracts and chain; no ongoing utility is implied. Farcaster remains a supported content source, not the launch theme.

Current adopted direction: “The future is exponential.” → “Think 10X. Not 10%.” → “10X Everything.” The mission is “Unlock exponential potential.” The full architecture below supersedes earlier provisional branding. It describes ambition, not returns. Avoid political campaign branding and implied affiliations.

## Canonical implementation

[public-content.mjs](../site/public-content.mjs) and its TypeScript declaration are the presentation source for product labels, brand lines, first-launch terms and roadmap. Stable routes, internal enums and on-chain identifiers remain unchanged. This module must never determine financial execution, budgets or eligibility. API capabilities, source evidence and domain policy continue to govern working features.

The first-meme information is on `/tokens#tenx-meme`; Season 0 information is on `/nfts#season-0`. There is no invented market, contract, transaction or inventory for $10X. The `season-0` presentation key represents the PRD's Season 0; existing `demo-season` and other inventory keys are not relabelled as the beta.

The owner-approved 25 November consumer design pass supersedes the initial navigation: Home, Tokens, Collect and Earn are primary. Collect reuses `/nfts`; Rewards reuses `/airdrops` beside the wallet. `/attention` and `/earn` share the Earn experience. Legacy routes, query links and technical views remain supported. Stake and rankings are contextual destinations.

## Reconciliation and discrepancies

- Daily Attention Token allocation in `domain/economics/launch.mjs` matches the confirmed 80% OG liquidity / 10% Earn / 5% Stake / 2.5% permanent vault / 2.5% seasonal vault model. The permanent vault receives the full 5% when seasonal weight is inactive. No economic code changed.
- PRD 1.2 and recorded stages include SOL-denominated mint terms (including the permanent collection's first whitelist policy at 0.1 SOL). The new **Season 0 Cards plan is US$1**, a 90% discount from intended US$10 standard pricing. Display these as a plan; do not convert or overwrite local or historical stage prices. A future approved release must implement and review the payment denomination/quote configuration.
- The existing daily engine has ten-day reward campaigns. The separate monthly paired campaign has no verified configuration or approved dates in the inspected checkout. Its start/end remain null, shown as “Dates to be confirmed”. Do not copy the daily duration or generate dates.
- No approved $10X contract, launch chain or token allocation was found. Display no contract, chain claim, price, liquidity or performance for this planned asset.
- **No CEX reserve, discounted OTC listing allocation or listing-linked burn plan.** Original supply/sale/liquidity split and designer allocation remain open. $10X creates no governance, buyback, treasury, pairing or revenue entitlement.
- The running app-local dataset is synthetic. Earlier local edits removed some disclosures and substituted real meme names for Attention Token tickers. Actual recorded tickers are preserved; reference imagery does not attest ownership, identity or affiliation. The owner’s subsequent consumer review explicitly overrides the PRD’s local/test-data disclaimer presentation: omit these notices from the private app-local interface. Internal provenance, execution controls, genuine availability, prices and eligibility remain unchanged.
- The existing social PNG describes attention markets as the brand. It is retained as an artifact but withheld from Open Graph metadata pending an approved replacement. The generic existing 10X favicon remains.
- The repository has no app-local terms/privacy routes or approved policy URLs for the new launch. Link to existing published technical policy; legal document content is unchanged. Approve app-specific legal links before public release.
- No AGENTS.md was found in the inspected checkout or accessible parent directories. The provided WarpletsAPI cwd was unavailable. Work is in `C:/Users/ichri/Documents/Codex/10x`, branch `work/10x-prd-foundation`, starting HEAD `b6c6623`, preserving the pre-existing dirty tree.

## Open decisions and release dependencies

| Decision | Current handling | Release dependency |
| --- | --- | --- |
| Brand architecture and Cards name | Brand architecture adopted 25 November; Cards name remains provisional | Confirm Cards name separately |
| Final $10X, permanent NFT and card art | Typographic local studies; old sample art is explicitly conceptual | Approve artwork and social preview |
| Original and designer allocations | No implementation or advertised split | Explicit economic decision and review |
| Beta paired token identity and exact dates | Unavailable / unscheduled | Verified config with explicit timezone |
| Beta mint configuration | US$1 plan, separate from recorded SOL stages | Approved denomination, fees and payment implementation |
| Public beta feature availability | Working local capabilities only; no financial execution | Relevant financial/production release gates |
| Monthly, daily and permanent NFT rollout | Planned, dependency-driven | Readiness and approved release schedule |

See [roadmap and follow-up queue](ROADMAP.md), [release gates](../blueprint/RELEASE_GATES.md) and [implementation report](../validation/BRAND_ALIGNMENT_2026-11-24.md). Preserve dated PRDs and reports as historical evidence rather than rewriting them.

## Consumer design implementation — 25 November 2026

The owner requested implementation of the consumer review and a stronger visual treatment. Home now contains the $10X introduction, Season 0 Cards and compact discovery. About and the roadmap are expandable. Tokens distinguish original memes from Attention Tokens; Collect leads with separate seasonal and permanent offers. Lime token artwork, violet Cards and silver-green permanent NFT artwork use the existing typographic brand, without claiming new asset metadata. Generic card artwork never labels historical inventory as Season 0.

Earn consolidates the earlier Attention/Earn overlap. Rewards puts available NFT allocations ahead of collectible holdings and lifetime valuations. Repeated tutorials and rankings are expandable; ranking queries mount only when opened, and Market is the default valuation. Product prices, eligibility, risk/fee disclosures and approved tokenomics are preserved. No local/test-data notices are added.

Latest-final leaderboard selection remains a follow-up: the API only supports explicit UTC dates and exposes no final-board index. The date picker is retained rather than inferring a final date. Final launch artwork, Cards naming and launch dates remain the existing product decisions.


## Campaign design refinement — 25 November 2026

The owner requested the confidence and energy of Nike and Red Bull. The 10X implementation uses original, unbranded action-sports imagery, oversized condensed italic headlines, acid lime against charcoal, a contrasting off-white Season 0 feature and more restrained application panels. This is a visual direction, with no affiliation or third-party brand assets. Home remains focused on $10X, Season 0 and three discovery paths. The same typography, spacing and navigation treatment carries through Tokens, Collect, Earn and Rewards.

Product artwork remains presentation-only: lime for memes, violet for seasonal Cards and silver for the permanent NFT collection. Existing identities, eligibility, tokenomics, prices and launch status remain authoritative. The photography is decorative; semantic headings, high-contrast actions, keyboard navigation and reduced-motion behavior remain available. Responsive crops keep the rider visible without covering the headline.

Artwork was produced with the built-in image-generation tool. Its exact prompt and the self-hosted Barlow Condensed font sources are recorded in [asset provenance](../site/src/assets/brand/provenance.json); the font license is retained alongside the files. The static adapter explicitly serves PNG and TTF build assets and permits same-origin fonts. No external font service, package dependency or animation library was added.


## Six-month design timeline and Warplet hero — 25 November 2026

The owner requested a populated view beyond Season 0 and replaced the cyclist direction with a Warplet stratospheric jump homage. The original Warplet pressure-suit/capsule illustration replaces the cyclist on both timelines and carries no Red Bull branding.

Keep the primary navigation and four-product hierarchy. Home features one current edition; the Tokens screen initially shows three original memes, with the full catalogue available on request. Collect provides searchable archive pages of six editions. Active campaign discovery searches across the complete token catalogue, independently of catalogue pagination.

The QA host supports independent Season 0 and six-month datasets. The six-month assumption is 180 Attention Token launches and Season 0 plus six subsequent monthly concepts, with real paginated fixture records for holdings and reward history. It does not authorize these dates, names or rollout cadence for release. The planned beta price, supply and status remain unchanged in the launch view. No local/test-data disclaimer is shown.

Before release, supply a verified original/edition catalogue for the same featured-release and archive components. The QA manifest is not that production source. Keep the existing financial completeness bounds and approval dependencies.

## Adopted brand architecture — 25 November 2026

The owner explicitly adopted this direction after the earlier PRD and visual refinements. It supersedes the provisional mission/tagline defaults in the attached PRD. The brand is optimistic, aspirational and culturally inclusive, spanning technological acceleration, extraordinary achievement and the power of attention.

| Role | Adopted statement |
| --- | --- |
| Rallying cry | 10X EVERYTHING. |
| Worldview | The future is exponential. |
| Philosophy | 10X, not 10%. |
| Culture | Celebrate the extraordinary. |
| Mission | Unlock exponential potential. |
| Media strategy | Showcase epic moments. |
| Economic thesis | Attention creates asymmetric opportunities. |
| Business model | Monetise attention through tokenisation. |
| Strategic positioning | The Red Bull of Memecoins. |

The minimalist manifesto follows **belief → mindset → action**:

> THE FUTURE IS EXPONENTIAL.
>
> THINK 10X. NOT 10%.
>
> 10X EVERYTHING.

Use the worldview, mindset and rallying cry in that order on the hero. Keep clear product descriptions and calls to action alongside the manifesto. The mission and culture can sit within optional About content; do not expand the homepage into a business-strategy explanation. Strategic positioning guides editorial choices and the ambition of the imagery; it is not a claim of Red Bull affiliation and is not a consumer-facing sponsor badge. The economic thesis describes potential, not promised financial returns.

The supplied purple Warplet is the approved character reference for the current campaign illustration: rounded purple body, huge white eyes, small limbs and an open toothy grin. The stratospheric capsule scene uses original artwork and no third-party branding. It remains campaign imagery, separate from collectible metadata.

Canonical strings live in `platform/site/public-content.mjs`, with matching declarations in `public-content.d.mts`. Metadata and both timeline views use the same current brand. Cards naming, launch dates, contracts and release configuration remain separate open decisions.
