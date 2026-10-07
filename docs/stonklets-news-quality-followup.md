
## Follow-up source review

The current registry has 43 Yahoo ticker feeds, broad BBC/CNBC discovery and six
enabled official RSS identities. This does not mean every stock has verified
independent content. Yahoo is a distribution channel; original authorship must be
resolved before counting it as a second editorial source. Press-release wires and
QuoteMedia issuer releases do not become independent journalism through syndication.

Specialist coverage checked on 7 October 2026:

- Space.com: verified reporting of AST SpaceMobile's August 5 launch with SpaceX.
  https://www.space.com/space-exploration/launches-spacecraft/spacex-launches-ast-spacemobile-11-13-direct-to-cell-satellites
  Candidate for independent corroboration; deduplicate against the issuer's same launch.
- Energy-Storage.news: Fluence company archive and September supply agreement coverage.
  https://www.energy-storage.news/tag/fluence/
  https://www.energy-storage.news/fluence-and-eve-energy-agree-206gwh-battery-supply-deal/
  Coverage also describes a guidance reduction. Do not automatically classify the
  entire article as bullish from its title.
- Utility Dive: May 12 Fluence hyperscaler supply-agreement coverage.
  https://www.utilitydive.com/news/fluence-energy-signs-master-supply-agreements-with-two-major-hyperscalers/820016/
  Reports weaker revenue and losses as well as the agreement. Not added merely to
  meet the monthly quota.
- Renewables Now: August 14 reporting on Fluence's 400-MWh LEAG project.
  https://renewablesnow.com/news/fluence-starts-deploying-400-mwh-battery-for-leag-in-germany-1299667/
  Candidate for a missing August narrative; requires full article/date review and
  comparison against existing project announcements.
- ETF.com: QQQ coverage includes portfolio comparisons and advice, which do not
  qualify as new bullish catalysts. ETF and inverse-product gaps need actual fund
  or explicitly mapped sector events, not generic investment articles.

These checks do not enable additional automated fetches: retrieval permissions,
feed format, canonical hosts and evidence checks must be established first.

## Remediation priority

1. Complete stocks below ten narratives, starting with SPY/QQQ, inverse ETFs,
   Fluence, GameStop, Korea exposure, SOXL and Trump Media.
2. Add independently reported evidence for the 38 stocks currently failing source
   diversity; preserve original company evidence as the primary source.
3. Add validated official discovery endpoints for the 38 identities without an
   enabled official feed. A registry homepage is not equivalent to working ingestion.
4. Use missing-month lists to guide searches, but accept ten distinct events within
   eleven months when launches/earnings cluster. Count original publication dates,
   not crawl/update dates; never split one launch into multiple syndicated stories.

Rerun `pnpm exec tsx scripts/audit-stonklets-news-quality.ts` after each backfill.
The generated JSON is the detailed, reproducible checklist. No production state,
publication gate, ingestion permissions or story eligibility was changed by this audit.
