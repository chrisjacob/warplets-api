# Marketaux news-quality backfill ? 7 October 2026

Used all **100 authorized requests**. The provider returned **0 remaining**; the shared D1 ledger accounts for 98 completed responses and two failed network attempts. No further Marketaux calls were made. The routine ingestion cap remains 90 requests per rolling 24 hours.

The audit searched 19 low-coverage symbols across month/quarter windows within the existing eleven-month horizon. It returned 215 article/stock associations covering 194 distinct article IDs. Exact ticker matches frequently included incidental mentions, investment advice and adverse stories; no story was published solely because its provider sentiment was positive.

Added **24 reviewed stock-news entries across 10 stocks**, representing **22 distinct articles**: 21 associations discovered through Marketaux and three entries checked against official issuer/SEC pages. Dates use provider publication metadata or visible issuer publication dates, never the crawl date. All entries have exact review fingerprints and checked-in provenance.

| Stock identity | Before | After |
|---|---:|---:|
| alibaba | 6 | 8 |
| direxion-soxl | 5 | 8 |
| direxion-soxs | 2 | 3 |
| gamestop | 4 | 5 |
| invesco-qqq | 1 | 8 |
| ishares-korea | 4 | 5 |
| lumentum | 6 | 7 |
| netflix | 6 | 7 |
| spacex | 6 | 7 |
| spy | 1 | 7 |

Counts are distinct accepted narratives in the checked-in research manifest, not the number of raw search hits. Ten remains a maximum display size, not a reason to pad feeds. SPY and QQQ still have gaps; the searches did not establish ten sufficiently strong distinct stories for either.

## Quality findings

- Broad ticker queries returned unrelated company stories using SPY/QQQ as comparison benchmarks. Those associations were rejected.
- Some positive-sentiment results described losses, mixed earnings, speculation or a different fund. Those were rejected.
- Two SOXL stories covered the same August 4 rebound; only one was accepted. GameStop's June earnings were already covered, so another article about that release was rejected.
- SOXS is inverse semiconductor exposure. Its dated short-term rally is explicitly mapped to chip weakness and its evidence retains the source's severe year-to-date loss context.
- SPY benchmark advances and broader ETF flows are labelled sector narratives. Industry flow totals are not presented as SPY/QQQ inflows.
- QQQ's fee reduction and $13.8 billion Q2 net inflow figure were confirmed from issuer pages/SEC material. The former is one story, not separate approval/implementation stories.
- Marketaux free responses provide short extracts. Truncated highlights were not treated as full articles. Unknown syndication/sponsorship ownership remains unverified in the diversity audit.

## Saved state

The local endpoint serves the new SPY/QQQ histories. A cache precedence defect found during verification was fixed: older persistent records no longer overwrite checked-in reviewed records.

All 24 additions were inserted and verified in production D1 with `published=0`. The existing **shadow publication gate remains unchanged**. No application deployment or automatic ingestion activation was performed.

The JSON companion records request filters, quota headers, every request ledger entry, accepted evidence, and candidate dispositions. Credentials and credential-bearing request URLs are excluded.

Relevant news/backfill/local-preview regression tests passed. Coverage audit rerun: 22/44 meet volume, 9/44 have verified primary plus independent coverage, and 2/44 meet both. Remaining gaps are recorded honestly.
