# 10X News: Trade The Narrative

## News-first records and selection

The v4 service researches all 44 catalog identities independently of quotes,
launch state, momentum, or minimum stock coverage. No return values are generated.
The hero contains the newest qualifying narrative for each of up to ten distinct
launched stocks. Individual stock feeds contain up to ten distinct narratives,
newest first, published within the previous eleven calendar months. Sparse feeds stay sparse.
Expired records remain available by immutable ID, with a dated archive label.

`stonklet_news_articles` stores canonical articles and source provenance separately
from `stonklet_news_links`, which associates each article with an exact catalog
identity and a direct/sector evidence classification. Indexed window queries
select one preferred source per narrative before applying stock and hero limits.
Canonical URLs drop tracking parameters. Near-identical headlines within three
days share a narrative key; changed numerical milestones remain separate. Official
sources take precedence over syndicated coverage. Local previews use the same
reconciliation, expiry, source priority and selection rules.

Migration 0077 imports v3 records without changing their share IDs or original
publication dates. Older thesis IDs resolve through a legacy archive fallback.
The old spotlight endpoint remains available for older clients; new clients use
`GET /api/stonklets/news`, `?pairs=apple,amazon` (maximum twenty validated catalog
IDs), or `?news=ID`. Mixed selectors are rejected. Responses cache for thirty
seconds; `validate=1` bypasses cache for withdrawal checks. Service errors return
503 so clients retain their last successful response.

## Editorial policy and source access

`stonkletNewsResearch.ts` is the explicit feed and identity registry. Every feed
records its owner, publisher, associated catalog IDs, public RSS retrieval method,
canonical source hosts, source priority and enabled state. Official Apple, NVIDIA,
Microsoft, Google, SK hynix and Fluence feeds complement public BBC Business and
CNBC feeds. The Robinhood IR feed is disabled after repeated access failures;
trusted-press coverage still includes Robinhood. A catalog identity being supported
does not imply that its feed currently contains a qualifying story.

Selection is conservative and deterministic: positive product launches, approvals,
commercial agreements and material adoption or revenue milestones. Neutral earnings
scheduling, advice, speculation, promotion, materially mixed or adverse evidence
are rejected. Trusted-press direct associations require an explicit issuer/product
identity in the headline; passing mentions do not establish beneficiaries. Generic
uses of the word strategy do not map to MicroStrategy.

The current reviewed sector rule maps an explicitly US online-retail growth report
to Amazon as a potential sector tailwind. It is labelled Sector narrative and never
claims Amazon's own sales grew by that amount. No generic semiconductor-positive
mapping is made to leveraged or inverse products. Gold and ETFs require their own
explicit product identities. Additional sector rules require evidence review.

Retrieved text is untrusted data, never executable instructions. Only allowlisted
RSS endpoints are fetched, redirects are rejected, article hosts are validated,
and article links are not arbitrary fetch targets. This version makes zero AI
calls and has no paid-provider fallback. It does not measure social engagement or
claim that a story caused price movement.

## Collection, resilience and observability

Hourly collection starts at :05 UTC. :10 and :15 recover incomplete dispatch only;
already dispatched or completed jobs are not recreated. The dedicated
`stonklets-news` queue is separate from notification delivery. Each source has one
idempotent job per hour. Dispatch and consumer work have leases, the consumer uses
batch size one and concurrency four, and each job permits one attempt plus two
retries. Retries wait 180 seconds, longer than the work lease. Exhausted deliveries
go to `stonklets-news-dead` and failures remain in D1. Abandoned jobs are marked
failed after thirty minutes. One failed source does not block other publication.

At most 100 enabled sources and 50 articles per feed are processed per cycle.
Each response has an eight-second timeout and a 2 MB bound. Shared feeds are fetched
once per cycle, with ETag/Last-Modified conditional requests. Article/link writes
are transactional and idempotent. Original records remain immutable. Successful
no-news and HTTP 304 evaluations count as observations; a complete hourly run
requires all source jobs terminal and at least 80 percent successful sources.

The existing authenticated `/api/admin/stonklet-spotlight` endpoint includes news,
168 recent runs, source health, and 100 recent failed jobs. Its existing off and
withdraw actions remain. Review accepted/rejected counts, repeat announcements,
coverage by pair, source failures and queue backlog/dead letters during shadow.
Accepted counts represent qualifying associations, including idempotent repeats;
compare them with new article/link counts to measure duplication. No new dashboard,
notifications or email delivery is introduced.

## UI, cache and sharing

The hero starts collapsed. Both states retain paired logos, a fixed three-line
headline including a compact green publication-date chip (for example, "28th June").
The external icon and source-domain chips are removed. A normal space before the
inline date allows it to wrap onto the third line; measured truncation keeps the
complete headline and date within three lines. Sector labels and required Yahoo
Finance attribution remain within that same area. Chart and single-chart asset containers for Launched, Voting and Upcoming
have independent inline news carousels without a hero title or collapse control.
The hero's embedded charts suppress their inline news to avoid nesting.

Carousels rotate every five seconds only while visible; hover, keyboard focus,
hidden tabs, open dialogs and reduced-motion preferences suspend automatic changes.
Dots and Next remain usable. One shared cache/polling coordinator batches nearby
stock histories (at most twenty IDs per request), deduplicates requests and retains
successful responses through transient failures. Stories expire during display.

Share 10X News freezes the selected story and uses headline, source URL and its
stock-specific news deep link. Both composer flows and image copy/download remain;
ordinary token sharing is unchanged. Upcoming stories can share text and artwork
without price history. Withdrawn stories cannot be shared. Expired stories remain
accessible as dated archives. Chart failures do not block text sharing.

## Rollout and backfill

Create `stonklets-news` and `stonklets-news-dead`, apply migration 0077 once after
0073-0075, then deploy the Worker producer/consumer and Pages functions/frontend.
Do not apply unrelated migrations as part of this release. The existing
STONKLETS_SPOTLIGHT_ENABLED flag controls dispatch. Migration 0077 resets the v4
trial to shadow (or preserves off); public reads stay gated.

Activation uses an explicit authenticated admin live action with no waiting period
or observed-day requirement. Activation and publication of existing records are
atomic; withdrawals remain excluded. Backfilling does not change the selected
mode. The owner authorized immediate production activation on 7 October 2026.
Continue monitoring coverage, mapping rejections, source failures and usage.

The dev-only Vite service restores the reviewed historical snapshot immediately,
collects up to eleven calendar months available in supported feeds, and persists archives at
`app/node_modules/.cache/stonklets-news-preview.json`. A feed may expose fewer than
eleven months; no articles are manufactured to fill that window. The checked-in
`stonkletsNewsBackfill.json` records the earlier reviewed official announcements.
Their old seven-day note describes that historical import, not the v4 policy.

## Validation

Focused tests cover selection, eleven-calendar-month expiry, source preference, mappings,
negative/neutral headlines, archives, withdrawals, quote-independent publication,
idempotent deliveries, bounded failures, source isolation, API limits and the
immediate activation and withdrawal preservation. Browser checks cover both layouts, Upcoming news, exact-story
sharing, no nested hero carousel, fixed heights and mobile overflow. Run app and
Worker typechecks, production build, security preflight and performance budget.

### Reviewed eleven-month backfill (7 October 2026)

`app/shared/stonkletsNarrativeBackfill.json` contains 380 reviewed records with
original source URLs, publication dates, stock mappings and review evidence.
After deduplication, expiry and the ten-story cap, the combined local collection
supplies 338 stories across all 44 catalog identities; 22 have ten stories,
including Tesla. See `stonklets-news-coverage.json` for per-stock counts and dates.
The newest qualifying records include October 6 announcements. Remaining sparse
carousels are not padded with duplicate, adverse or speculative stories.

Discovery now includes 43 stock-specific Yahoo Finance RSS feeds alongside the
existing official/company and business feeds. All 43 canonical RSS endpoints were
checked successfully. Tether Gold is excluded from equity-ticker feeds. Feed
membership alone does not establish a stock association: article identity,
allowlisted publisher, original publication date and catalyst eligibility are
still validated. Yahoo attribution is retained where required. This uses public
feeds, not paid market-data credits. Existing bounded concurrency, conditional
requests, timeouts, two retries and independent source failures remain in effect.

The historical review also uses official issuer announcements, public issuer
press-release feeds and individually verified trusted reporting. Some issuer
records are supported by original feed metadata and summaries rather than a
retrievable full article. Updated timestamps are never substituted for publication
dates. Tesla's October 2 delivery coverage was excluded after reviewing its mixed
year-on-year result. Unrelated Fluence companies, stale ASML update dates, price
predictions, investment advice and unverified inverse-product mappings are excluded.

Exact editorial reviews can pass keyword heuristics but still obey expiry,
withdrawal, association and deduplication. The browser imports compact SHA-256
review fingerprints rather than the full research manifest. A changed source,
headline, evidence, classification or publication date invalidates a review.
After editing the reviewed manifest run:

`node scripts/rebuild-stonklets-news-reviews.mjs`

Backfill inserts are idempotent. They preserve production shadow mode, do not
count as observed trial days and do not deploy the shared Worker. The expanded
pipeline can be activated immediately by an authorized administrator.

## Coverage improvements (7 October 2026)

The source map now covers all 44 identities with an official archive and two
independent research targets. Targets are not claims of working ingestion.
`stonkletNewsVerifiedFeeds.json` contains only successfully checked RSS additions:
eight issuer feeds and six specialist feeds. This raises enabled official feed
coverage from six to fourteen stocks, within the existing 100-source run cap.
Gold's Tether feed requires an explicit XAUT/Tether Gold identity; USDT news does
not become gold news. Failed endpoints remain disabled and their check results
are recorded in `stonklets-news-feed-checks.json`.

`pnpm exec tsx scripts/check-stonklets-news-sources.ts` checks candidates without
changing the active allowlist. Review `.tmp/stonklets-news-verified-feeds.json`
before updating the checked-in allowlist; availability alone is not approval of
article content or beneficiary mappings.

Archive backfill:

`pnpm exec tsx scripts/backfill-stonklets-news-archives.ts '--pairs=fluence,asml' --month=2026-08`

The bounded tool uses original JSON-LD publication dates, same-origin links,
linked archive pagination, a 24-hour local cache, an eight-second request timeout,
a 2MB body limit, three concurrent sources and a 200-request run cap. Each issuer
gets at most three linked archive pages and four article fetches. It does not
claim exhaustive archive search. Blocked/redirected/unsupported pages are reported,
not bypassed. Candidates and available article evidence go to the local review
file; they are never automatically promoted to reviewed/public stories.

Migration 0078 adds a feed review inbox. Apply it before deploying the changed
consumer/admin endpoint. Each feed retains at most 500 review records, bounded
also by the eleven-month window. Mapped financial/results headlines that fail the
publication checks remain visible as `needs-evidence-review`; other outcomes are
`editorial-filter`, `unmapped`, and `accepted`. These labels explain the processing
stage, not an assertion that a rejected story is false. Ingestion still publishes
only content passing existing eligibility rules or an exact editorial review.

The existing authenticated admin endpoint exposes source health (last successful
run, last attempt, failures), source mappings, review counts/pending items, and
stored monthly narrative counts. Stored counts are operational metrics; run the
quality audit for editorial eligibility and source diversity. Independent coverage
of one event contributes to source diversity while counting as one narrative.

This release does not change production activation or reset/skip the seven-day
observation requirement. No paid news, AI or market-data provider was added.
