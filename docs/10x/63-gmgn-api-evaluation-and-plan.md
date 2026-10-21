# GMGN API evaluation and comparison plan

GMGN candle correction, 21 October: [v2 contract and descriptive pattern review](73-gmgn-candle-contract-and-review.md) accepts consistently second/millisecond timestamps and missing turnover while rejecting malformed/open/mixed/duplicate bars. Unit-conflicting candle totals remain unknown; cache-only pattern measurements add no fraud, organic-demand or score certification. Archived v1 receipt replay and every gate/allowance remain. Today's 120/120 admission holds new live IO until the next UTC day; public vendor-example regression passes without bypassing it. No deploy.

GMGN live test, 21 October: [internal research allowance raised to 120](72-gmgn-live-test-capacity.md) follows the founder's explicit request. The former 100-record restriction was internal; the 10 MB byte cap, twenty source attempts inside market allowance, pacing, ownership and every evidence/action/election gate remain. Live PONYX info/security returned HTTP 200 and replayed; absent risk labels stayed unknown. A candle payload was rejected by existing validation and remains a recorded gap. No paid fallback, quota reset, score change or deploy.

GMGN integration, 21 October: [bounded read-only queries and cached token evidence](71-gmgn-read-only-integration.md) configures only the query key, adds exact Solana info/security/pool/minute-candle reads, validates USD versus token volume, and exposes attributed cache-only activity/risk evidence. The founder explicitly authorized needed storage/display; provider rights are not independently confirmed. A fixed three-mint investigation can use one allocated slot inside the existing three-capture maintenance pass and all original shared quotas. Today's 100/100 research bound holds IO, so real endpoint access/fixtures remain unverified. Current v4 and all action/election/evidence gates remain. No signing, funding or deploy.

The original G0–G4 checkpoints below are retained as history. The founder's later explicit storage/display direction authorizes the bounded use above; it does not independently establish provider licensing. Query-key configuration and implementation are now complete, while actual admitted endpoint verification and comparative scoring remain open. V4 is already current for independent launch-timing checks, so any future provider-based policy must use a later version.

Later scoring checkpoint: [PONYX launch timing](67-ponyx-launch-timing-review.md) makes v4 current using existing cached evidence, independently of the unactivated vendor pilot. Before that experiment, preregister the actual custom baseline; keep original v3 comparisons explicitly pinned and do not relabel older observations. The access/rights and G0–G4 requirements below remain open.

Setup follow-up, 21 October: at the founder’s explicit request, the reviewed official CLI v1.6.7 generated a local application key pair outside this repository. No API credential was applied or activated. The founder later reported independently transferring $105 and waiting for the hourly asset refresh; qualification remains unverified. No agent-initiated funding/top-up is authorized. Continue [Jupiter/GeckoTerminal activity preparation](66-source-activity-review.md) while GMGN access is pending. The original evaluation statements below describe their checkpoint.

Broader review, 21 October: [Free-source comparison](64-free-data-source-comparison.md) adds Jupiter organic metrics, GeckoTerminal/GT Score and focused Birdeye/Helius alternatives to the investigation order. GMGN remains a conditional candidate, not an assumed winner. Check applicable comparison/storage/display rights before paired API work; the new review records specific licensing conflicts and retains the same G0–G4 and shared-budget boundaries.

Reviewed 21 October 2026 for the founder's request. Recommendation: **conditional go for a read-only data pilot; retain Discovery score-v3 until a paired evaluation supports a versioned change.** GMGN could supply valuable indexed data we currently lack. Its published scores remain heuristics, and access, semantics and product-use rights need verification.

This is an evaluation and implementation plan, not an enabled integration. No GMGN account, key, subscription, asset transfer, trade, launch or deployment was created. No authenticated token response has been collected; live accuracy, latency, historical depth and account entitlements remain untested. The existing local preview, sources, scoring and evidence gates are unchanged.

## Sources and reproducibility

The official [Agent API documentation](https://docs.gmgn.ai/index/gmgn-agent-api) links to [GMGNAI/gmgn-skills](https://github.com/GMGNAI/gmgn-skills). Repository review is pinned to **`402671e2ab8d1336df9e20f4fc7da123dc719e59`**, package version **1.6.7**. Public documentation and the repository do not always describe the same surface. Treat repo descriptions as testable claims, not measured performance in our application.

Primary references at that revision:

- [Token fields, tags and request weights](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-token/SKILL.md).
- [Market candles, listings, filters and weights](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-market/SKILL.md).
- [Contract due-diligence scoring](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-contract-dd/SKILL.md) and [chart-pattern scoring](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-kline-pattern/SKILL.md).
- [Holder analysis and denominator limitations](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-holder-analysis/SKILL.md), [developer analysis](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-dev-score/SKILL.md), [portfolio queries](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-portfolio/SKILL.md).
- [Actual endpoint/auth implementation](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/src/client/OpenApiClient.ts), [configuration](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/src/config.ts), [CLI rate-limit reference](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/docs/cli-usage.md).
- [Software MIT license](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/LICENSE), [GMGN service terms](https://gmgn.ai/static/tos.html), [API dashboard](https://gmgn.ai/ai?chain=bsc&tab=paid_plans).

The seven research skills were installed globally for Codex with the user-requested `skills add` mechanism, pinning both installer and source:

```powershell
npx --yes skills@1.7.4 add https://github.com/GMGNAI/gmgn-skills/tree/402671e2ab8d1336df9e20f4fc7da123dc719e59 --global --agent codex --skill gmgn-token gmgn-market gmgn-contract-dd gmgn-kline-pattern gmgn-holder-analysis gmgn-dev-score gmgn-portfolio --copy --yes
```

Installed under `C:\Users\cjacob\.agents\skills\gmgn-*`; available for the next turn. No swap, cooking, order-preparation or publication skill was selected. Installation does not configure or activate the API/CLI. Upstream instructions cannot override our project constraints: never solicit credentials in chat, disable network protections, execute financial commands, hide missingness or auto-upgrade a plan. Some examples assume Python and `~/.claude/skills`; installation alone does not validate those scripts on Windows. Installer scanners reported mixed risk ratings, including high ratings for the token/market/portfolio instructions; these are scanner outputs, not a completed security certification.

## Skills Market follow-up: full catalog review

Following the founder's direct [Skills Market link](https://gmgn.ai/ai?chain=sol&tab=skills_market), reviewed all **66 visible catalog cards** on 21 October: 32 Data Analytics, 11 Monitor, 13 Trading, three News & Media and seven Cooking. This is a catalog assessment plus detailed review of selected relevant workflows, not an implementation/security audit or authenticated execution of all 66. The first evaluation above focused on seven underlying research skills; the complete market also exposes preset workflows over those APIs and additional skills/providers. Card counts are a dated snapshot, not a count of distinct backend endpoints. The ignored local catalog receipt is `.tmp/gmgn-skills-market-catalog.json`.

| Market entry/workflow | Assessment for 10X | Existing coverage / proposed next step |
|---|---|---|
| Token Due-Diligence Score; Chart Pattern Read & Score | Core per-token comparison models; keep risk and chart-strength semantics distinct | Underlying contract/chart skills already installed and reviewed above |
| Token Basic Info/Security, pool, Top 100 Holders/Traders | Priority indexed evidence, especially suspected insider/bundle exposure and distribution | Mostly covered by installed token/holder skills; validate actual fields and bounded denominators |
| Dev Score; Dev Info Analysis; Dev Created Tokens | Priority historical context alongside our exact creation-purchase checks | Installed developer/portfolio/token skills cover the underlying reads |
| [Migrated Token Quality Screener](https://gmgn.ai/ai/skills/migrated-token-quality-screener?chain=sol) | Useful candidate-generation/filter benchmark | Detail page is a `market trenches --type completed` preset: $50K–$200K cap, liquidity above $10K, top-ten/bundle/fresh-wallet ratios below 20%. Its $10K floor and $200K upper cap do not match our action policy; preserve our independent rules and broader observed-token view |
| [Price Surge Signal Token Screening](https://gmgn.ai/ai/skills/price-surge-signal-token-screening?chain=sol) | Useful queue for reviewing abrupt moves; a surge is not itself demand quality | Detail page composes signal type 6, info/security and holders; its command flags match the pinned CLI. Bound per-candidate fan-out, retain rejected/unknown cases and do not equate its advertised filtering with verified absence of manipulation |
| [Cross-Chain Curated Hot List](https://gmgn.ai/ai/skills/heat-rank?chain=sol) / `gmgn-heat-rank` | **Add a full screening/ranking benchmark**, separate from the per-token due-diligence arm | Not installed or executed. Pinned source defaults to seven chains/three windows, up to 21 listing requests before conditional lookups, a seven-day ceiling, at least $500K cap/$100K liquidity and at most ten survivors. Restrict a trial to Solana and record effective scope; compare candidate coverage as well as ranking quality |
| Smart Money/KOL trade, buy/exit and Pump claim signals | Secondary investigatory context | Check endpoint authentication and account entitlements before adding; activity/claims are not proof of safety, common control or organic demand |
| Hot search, KOL calls, wallet copy-trade/address scores | Lower priority for token integrity | Popularity, wallet profitability and copyability answer different questions; no positive safety credit by default |
| OpenTwitter/OpenNews; Twitter Following Posts | Separate social-evidence research | The first two are listed under **6551**, and Following Posts advertises the official paid X API. A market listing does not include these providers' access in GMGN Free. Verify separate credentials, permissions and cost; preserve the free-service constraint |
| Trading/order and Cooking/launch entries | Outside this data/scoring pilot | Catalog review confers no authority for execution, issuance or financial actions. No additional skills or runtime capabilities enabled |

**Plan refinement:** G2/G3 must assess both (i) the three per-token scoring arms and (ii) the vendor's complete candidate-selection workflow. An excellent filtered shortlist could save custom screening work even if its per-token score is unsuitable. Conversely, a filtered list can look better simply by omitting young, illiquid or label-missing tokens. Keep our unfiltered observed population/control records, measure exclusion reasons and request cost, and disclose both the stock workflow's different population and any adapted parameters. This comparator does not replace graded browsing or the action/election gates.

The pinned [heat-rank source](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-heat-rank/SKILL.md) also describes chain-dependent/default-zero risk coverage and deliberately keeps some coverage gaps out of its final report. Preserve those gaps explicitly in 10X. Its cross-chain percentile ranking is a screening heuristic, not an interchangeable calibrated trust score. These limits strengthen the case for a recorded comparison before adopting the whole workflow. Source authentication, Free eligibility, permitted reuse, shared budgets and the G0–G4 acceptance checks below still apply.

## Access, cost and permission findings

**Confirmed in the published repo:** Free, Plus and Pro use weighted rate/capacity buckets of **5/5, 20/20 and 50/50**. Free is not five requests per second for every endpoint. Standard candles cost two units, top-holder/trader lists five. A route whose weight exceeds plan capacity can return `403 PLAN_UPGRADE_REQUIRED`; one-second candles explicitly require Pro. There is enough documented Free capacity for a modest cached pilot, assuming the account is eligible. Daily allowance, historical retention and service availability must still be checked; bucket capacity is not a daily entitlement or SLA.

**Founder-supplied account-page receipt, 21 October:** the founder pasted the following GMGN API Management wording in response to our access question:

> Free tier requires a minimum balance of $100. Assets refresh hourly.

This confirms the displayed minimum-balance requirement and hourly asset-refresh statement from the supplied account-page text; it is not an independently authenticated account inspection or proof that this account currently qualifies. Classify GMGN as **balance-gated Free access**, separate from an unconditional $0 data plan. The $100 is a qualifying balance, not a stated $100 API subscription charge. No asset transfer or purchase to meet or maintain the threshold is authorized by this plan. The excerpt does not define eligible assets/chains, balance location, valuation rules, grace periods, exact access-loss timing, trading-volume conditions, endpoint entitlements or data-use rights; these remain unresolved.

The same receipt says up to three API keys per account, recommends trusted-IP access, and warns against disclosing API or Ed25519/RSA private keys. Multiple keys do not establish multiple independent plan allowances. These are quoted service conditions/security guidance, not instructions to reinstall skills, configure signing or create keys. No credentials were supplied, and no GMGN account was accessed or created here.

The documented API host is `https://openapi.gmgn.ai`. The selected token/market queries use an API key with timestamp/client ID; the docs say requests currently require IPv4. Do not disable IPv6 globally: test the actual authorized egress route. Trading uses a separate signing key, which this project does not need. Importantly, **not every read operation is API-key-only**: the reviewed client signs `wallet_holdings` and followed-wallet reads, despite broader query-only wording in the introductory docs. Exclude signed routes entirely from the pilot. Key registration may require uploading an application public key; any associated private key stays outside this runtime and is never a wallet seed.

MIT licenses the published code, not unrestricted reuse of all returned data. The service terms reserve service rights and restrict unauthorized automated access. We did not find a clear grant covering a public competing token-ranking product, indefinite raw archival, redistributable scorecard exports or model training. Confirm those specific uses and attribution/retention requirements before enabling public GMGN-derived evidence. This is an unresolved product-use question, not a claim that GMGN prohibits our application. Private evaluation must also stay within applicable access terms. No support message was sent.

Older GMGN crawling-whitelist/trading-API documentation describes different products; do not apply its old rates or authentication to the Agent API.

## What is actually scored

There are three different things:

1. **Backend fields and labels:** reported holder/trader aggregates, developer history, suspected insiders/bundlers/snipers, `is_wash_trading` and `rug_ratio` where supplied. These could be useful new observations. Algorithms, error rates and version history for those labels are not independently certified here. A zero/default/absent flag is not verified organic activity; `rug_ratio` is not established as a calibrated probability.
2. **Published skill scores:** `gmgn-contract-dd` computes a composite from multiple responses, using contract/holder/price weights 45/35/20 and risk ceilings. It renormalizes when an entire section is unavailable, unlike our fixed-denominator support model. `gmgn-kline-pattern` measures technical chart shape; developer and wallet skills answer other questions. These scores are not interchangeable, nor are they a single documented per-mint backend scoring endpoint.
3. **Our product policy:** deterministic grades, fixed coverage, dated evidence/ceilings, exact replay and separate action gates. We retain responsibility for these semantics even if GMGN becomes the main enrichment source.

Do not invert `rug_ratio` into `100 × (1 − risk)`, average unlike scores, or describe a skill's “buyable” band as 10X eligibility. The contract skill itself reports earlier high scores on tokens carrying a high provider rug label and adds caps to address that failure. Its evaluations against GMGN's own labels are useful regression work, not independent proof of fraud prediction.

## Existing validations versus GMGN

| Area | Current custom implementation | GMGN opportunity | Proposed treatment |
|---|---|---|---|
| Discovery and exact mint | Free pool/event intake; finalized creation and migration checked separately | Trenches lifecycle, launchpad and liquidity filters, indexed creation/open/migration fields | Trial as another candidate source; preserve case-sensitive mint identity and independent creation/graduation proof. A completed listing does not certify age or migration. |
| Price/volume anomalies | Sparse retained quotes; v2 large-step and v3 quiet-staircase heuristics; no OHLC wash-trading proof | Candles and richer activity/volume fields | High-priority pilot. Replace sparse-sampling approximations where measured candles are better, through a new model version. Retain old versions and all unknowns. |
| Manipulated participation | Material later-buy threshold and bounded dust sample | Wash flag, bot/bundler/insider/sniper and fresh-wallet indicators | Report provider-labelled concerns and compare with independently sampled transactions; do not certify common control or organic volume from tags. |
| Holder concentration | Certified owner/supply inventory; non-vault concentration and supply reconciliation | Fast top-holder/trader lists, tagged cohorts, costs/funding | Use for triage and cross-checks. Top 100 is not a complete inventory; reconcile LP/burn exclusions and total-supply versus float percentages before comparison. |
| Historical creator exposure | Exact signed creation purchase relative to dated supply; bounded later sales/funding | Indexed creator launches, holdings and activity | Investigate dispersion and serial-launch context. Keep historical acquisition checks: small current creator holdings do not erase a large initial purchase. |
| Authorities and pool | On-chain authority/reserve/layout checks | Security and pool summaries | Compare to receipts; provider summaries do not satisfy finality, layout or LP-lock certification automatically. |
| Overall score and research | Frozen v1/v2/v3 inputs/policies/hashes; positive support decays; missing earns no points; prospective outcomes | Published due-diligence/chart heuristics and broader features | Compare scores as separate models. Port a useful rule deterministically only after testing; preserve fixed-denominator coverage and unchanged election/action engines. |

**Expected value is better indexed evidence and less bespoke data plumbing.** We should avoid building our own comprehensive wallet-label index if a permitted, affordable provider works. We should retain lightweight independent verification, deterministic policy and research machinery. API feature breadth alone does not establish better ranking accuracy.

## Integration traps to test first

- **Contradictory field descriptions:** the contract skill says `rug_ratio` is absent from exact-address info/security/pool queries and obtains it from listings; the token reference lists it under security. The chart-pattern skill describes seconds and token-count `volume`/USD `amount`, while the contract skill describes millisecond candle times and uses `volume`. Capture actual responses before choosing timestamp/turnover units; do not infer USD volume from a field name. The chart skill also has inconsistent prose about which volume series to use.
- **Lifecycle and selection:** default listing filters can exclude failed-authority or other risky tokens; some unknown filter names are silent no-ops. A filtered result is not all candidates, and absence is not a clean result. Prove each filter's effect locally against saved unfiltered/default-matched controls and record effective defaults, pagination and truncation. Do not hide the adversarial control population behind `safe` filters.
- **Missing labels:** `rug_ratio` may be available only for listed tokens, absent entirely or default zero on poorly covered chains. No per-mint label coverage guarantee is demonstrated. Verify availability by endpoint/chain/token; do not substitute listing absence or all-zero blocks for measured safety.
- **Identity and units:** Solana base58 is case-sensitive; some sample pipelines lowercase addresses. Preserve exact addresses. Parse explicit boolean/string/numeric variants; percentage-like names may still contain fractions. Reject invalid ranges, stale/future records, duplicate candles and unknown denominator semantics.
- **Scope:** holder lists are bounded; larger lists and longer indexed histories still need pagination/coverage proofs. Token creation, pool opening and migration times are separate. GMGN migration cap or a first available candle is not automatically initial token valuation. Smart-money/KOL tags and trending ranks are not independent safety evidence.
- **Platform drift:** introductory docs list fewer chains than the CLI; the repo also contains outdated statements about whether search exists. Start with Solana and pin client/normalizer versions. HTTP 200 is not enough: validate envelope, identity and usable data; reject plausible populated defaults for unknown addresses.

## Proposed implementation sequence and acceptance checks

### G0 — Verify access and intended use

The displayed $100 minimum balance and hourly asset refresh are recorded above. Confirm actual account qualification, eligible balance rules and endpoint permissions without a purchase or asset transfer. If an already-qualifying account is later available, verify read-only access and handle eligibility rejection as unavailable evidence with bounded backoff, never paid fallback or automatic funding. Establish a securely configured query key outside Git/chat/logs and confirm data retention, derivative ranking, display and export rights. Register no signing credential in the collector. If access requires spending or rights are unsuitable, keep the adapter disabled and retain the existing sources. Deliver a dated entitlement/permission record with public facts separated from account assertions.

### G1 — Collect bounded fixtures and define a read-only adapter

Create a disabled-by-default source adapter with an exact method/path allowlist for token info, security, pool, standard candles, listings and approved creator-history reads. A POST listing query can be read-only; exclude trade, order, cooking, publication and signed portfolio endpoints regardless of HTTP method. Production collection should call a pinned, tested HTTP adapter, not spawn an LLM skill or install a new CLI on every timer tick. Retain any copied MIT notices.

Reuse owned leases, shared pause, durable source reservations and cooldowns. Proposed pilot maximums: **one in-flight request, at least three seconds between calls, 20 weighted units/minute, 100 HTTP attempts and 200 weighted units/UTC day**, no automatic paid fallback. These are proposed local ceilings, not GMGN promises. Count retries and failed attempts; reserve weight before requests and honor stricter account limits, `X-RateLimit-Reset` and `reset_at`. Authentication/entitlement failures hold the source; rate-limit bans stop all work for that key until reset. Disable implicit CLI retries so they cannot escape accounting. Existing providers' allowances and evidence budgets do not increase.

An illustrative day: 20 tokens × info/security/pool/15m candles = 80 requests/100 units; five focused tokens × holders/traders = 10 requests/50 units; one shared trenches and trending fetch = two requests/five units; five launch-window candle requests = five requests/ten units. Total **97 requests/165 units**, leaving little HTTP headroom. Creator history or retries replace other work; they are not extra allowance. Listing caches are reused across tokens. API historical windows/pagination must be verified: a default 100 one-minute candles does not cover a whole day or prove launch coverage.

Store bounded raw responses privately, normalized observations, canonical mint/pool, endpoint/query/schema version, fetch time, provider observation time or unknown, effective filters/window, response hash, completeness and request weight. Keep credentials out of artifacts. Proposed raw-body ceiling 1 MB, bounded candle/list counts and finite lookback; overflow remains a gap rather than an apparently complete sample. Retained GMGN research bodies and comparison payloads count against the same daily research byte budget; separately stored research records count toward record admission too. No unbounded parallel raw archive is introduced. Request capacity does not guarantee storage capacity. Retention must follow confirmed rights and the existing storage controls. Keep the pilot operator-only until public data rights are established. Public exports need an explicitly permitted evidence projection, not automatic raw redistribution.

Acceptance: real response fixtures confirm schemas, units, auth, supported filters and error behavior; offline tests cover null versus false/default zero, unknown mints, wrong identities, malformed/oversized bodies, stale/future/duplicate candles, pauses, concurrent leases, cooldowns and storage admission. Key absence makes zero requests. No provider request originates from a page/card render.

### G2 — Compare three models on the same frozen observations

Use (A) frozen custom v3, (B) a deterministic reproduction of the pinned GMGN contract heuristic, and (C) a preregistered hybrid using selected GMGN fields. Preserve B's own missingness semantics and label it separately; do not silently rewrite it to look like A. If exact deterministic reproduction cannot match reviewed golden examples, treat skill reports as qualitative references and do not call them a reproducible benchmark. Log a policy hash and all caps for each arm. Proposed hybrid parameters are fixed before the evaluation set is read; they are not a production activation.

Start with exact USDF, XTO and the founder's Kimchi mint, followed by a stratified sample across creation ages, liquidity, local score bands and provider-label availability. These known cases are regression investigations, not the test set or independent scam labels. Fetching today's GMGN data cannot reconstruct a GMGN score at yesterday's frozen observation. Current comparisons must carry their own dates.

For prospective comparisons, freeze all three arms at one common cutoff after the bounded collection window, with each source's actual fetch/observation time and freshness. Require a declared maximum collection skew (initial proposal 60 seconds); otherwise mark the pair incomparable. Cache/listing delays stay visible. Avoid selecting only tokens that GMGN's safety filters already retain. Use independently reviewed adverse cases and benign controls; provider wash/rug tags cannot be their own ground truth.

Paired artifacts must share the **existing aggregate 100 research records / 10 MB daily admission**, owned control lease and three capture attempts/five finalizations per maintenance turn. Normal cohorts and any additional comparison rows all count; do not grant each arm a new quota. Preserve original v1/v2/v3 cohorts and outcomes, count both an existing baseline record and a new comparison artifact if both are stored, and wait when the shared budget is full. Any migration must retain old bytes/hashes and pass rollback/foreign-key tests.

Target at least seven days and 100 comparable mature pairs before a preliminary comparison; completion depends on the unchanged budgets and coverage. A target is not a guarantee of statistical calibration. Keep a chronological held-out portion; record exclusions and missingness by age/chain/score band. Original sampled 24h price/liquidity outcomes still wait 26h and remain observational. Later GMGN queries cannot leak into a selection-time feature. Labels of wash trading need separate transaction-level adjudication.

### G3 — Measure usefulness, failure modes and maintenance cost

Report risky-case detection and independent false-positive counts; top-ranked adverse outcomes; coverage of every new field; disagreement reasons; rank stability; quote/pool differences; request/storage use; latency and downtime. Publish denominators and intervals where meaningful. Compare A/B/C on identical pairs and separately on the full inventory to expose coverage-selection bias. Large returns, popularity and low observed loss rates alone do not validate organic trading or trust. Evaluate whether better OHLCV/labels actually outperform v3's approximations and whether creator-history queries save RPC work without overstating completeness.

If the pilot cannot resolve candle units, material identity/field contradictions, label coverage or Free-plan access, keep it informational. If no model reliably improves the measured target, retain v3 and use GMGN only for investigation.

### G4 — Integrate useful features through a versioned policy

After evidence supports the choice, add a proposed score-v4 with pinned fields, freshness, coverage and explanatory concerns. Preserve v1–v3 replay. Favour GMGN candles and indexed wallet signals where validated; retire duplicated live plumbing only after checking proof obligations. Do not discard historical creation acquisition, independent origin/authority/inventory checks or research controls. Avoid double-counting related wash/bundler/insider signals or treating different providers as independent when they share underlying data.

Keep existing adverse ceilings unless a separately justified policy revision changes them; a favourable vendor label never cancels on-chain adverse evidence. Display provider attribution and uncertainty; an outage removes positive freshness credit and reports unavailable evidence, not a clean bill. Support local rollback to v3. Contract tests, recorded replay, ordinary/adversarial controls, action/election invariance, UI checks and existing performance/budget checks are release requirements. No deployment or financial execution is authorized by this plan.

## Current checklist

- [x] Review official API docs, pinned source, endpoint auth/weights and relevant scoring skills.
- [x] Install seven research skills at a known revision, without credentials or execution features.
- [x] Compare our validations with GMGN data/heuristics and document semantic risks.
- [x] Record this staged plan and link it from the PRD, task map and restart handoff.
- [x] Record the founder-supplied API Management requirement: $100 minimum balance, assets refreshed hourly, up to three keys per account.
- [ ] Verify actual account qualification, eligible balance rules, Free endpoint entitlements and intended-use/data rights (G0).
- [ ] Collect authenticated query fixtures and implement a disabled, bounded read-only adapter (G1).
- [ ] Run prospective paired comparisons without increasing shared quotas (G2/G3).
- [ ] Adopt only validated improvements through score-v4; preserve all independent gates and replay (G4).

Planning changes are documentation-only. No current score, source schedule, database schema, quota, action gate or runtime dependency changed. Markdown links, the installed skill files/source hashes and Git whitespace checks are the appropriate validation for this milestone; application tests are not rerun for prose alone.
