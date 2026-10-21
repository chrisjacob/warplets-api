# GMGN read-only integration and next comparison plan

GMGN candle correction, 21 October: [v2 contract and descriptive pattern review](73-gmgn-candle-contract-and-review.md) accepts consistently second/millisecond timestamps and missing turnover while rejecting malformed/open/mixed/duplicate bars. Unit-conflicting candle totals remain unknown; cache-only pattern measurements add no fraud, organic-demand or score certification. Archived v1 receipt replay and every gate/allowance remain. Today's 120/120 admission holds new live IO until the next UTC day; public vendor-example regression passes without bypassing it. No deploy.

GMGN live test, 21 October: [internal research allowance raised to 120](72-gmgn-live-test-capacity.md) follows the founder's explicit request. The former 100-record restriction was internal; the 10 MB byte cap, twenty source attempts inside market allowance, pacing, ownership and every evidence/action/election gate remain. Live PONYX info/security returned HTTP 200 and replayed; absent risk labels stayed unknown. A candle payload was rejected by existing validation and remains a recorded gap. No paid fallback, quota reset, score change or deploy.

21 October 2026 (Australia/Sydney). Continues the [GMGN API and 66-card marketplace review](63-gmgn-api-evaluation-and-plan.md), [source foundation](68-source-collection-foundation.md) and [authentic daily attention requirement](70-authentic-attention-momentum.md).

## Updated authority and plan

The founder now reports having an API key. It was found in the **ignored, untracked root `.dev.vars`**, not `.dav.vars`. Only `GMGN_API_KEY` was copied into Discovery's ignored `.dev.vars`; no application private key, wallet key, other root secret or CLI credential was copied. The generated Worker types contain the binding name and type only. Query credentials never enter browser bundles, request descriptors, replay artifacts or command-line arguments.

After the earlier rights question, the founder explicitly instructed:

> There is no indication of data storage being limited, so proceed with what we need to make our app work.

This authorizes the bounded storage and app display in this milestone, recorded as `founder-direction-2026-10-21`. It supersedes our earlier internal hold pending founder direction. It is **not independently verified provider licensing**; that distinction stays in status/evidence. No repeated permission question or invented provider grant is required. Account qualification and actual endpoint access still require a successful admitted response; key presence alone does not establish either.

The prior marketplace review remains useful: prioritize token/security, candles and distribution intelligence over adopting a complete vendor screener. Market presets use different creation/cap/liquidity scopes and often omit missing-label cases. GMGN contract/chart heuristics, provider rug ratios and our Discovery score remain different constructs. Trading, orders, launches, signed portfolio routes, paid external social services and seven-chain fan-out remain outside this integration.

Implementation sequence:

1. **Implemented:** safely configure the query key, fixed read contracts, bounded shared transport, explicit provenance/normalization, cached app evidence and a small declared regression pilot.
2. **Next:** collect admitted real Free responses and confirm error/envelope/field/window semantics, identity, coverage and IPv4 egress. Preserve missing data or endpoint rejection; do not expand quotas or enable paid fallback to finish a bundle.
3. **Next:** preregister fresh v4 comparisons and independently chosen controls, with a common cutoff, source timestamps, incomplete/rejected rows and authentic-attention measurements. The three founder cases below are investigations, not fraud labels or an independent test set. Current queries cannot reconstruct historical GMGN readings.
4. **Later:** test holder/trader samples, creator history and adapted marketplace screening as separate bounded research arms when their information gain warrants the calls. Top holders and provider net-buyer counts do not establish dust-resistant holder growth. No unbounded wallet graph or extra provider schedule.
5. **Only after evidence supports it:** propose a new scoring version, publish attribution/ceilings/missingness and compare outcomes. Keep adverse independent evidence dominant, archive v1–v4 unchanged and preserve every action/election/source gate. No vendor label inversion into a safety probability, silent v4 weight edit or automatic score-policy adoption.

## Implemented queries and measurements

All queries are fixed **GET** requests to `https://openapi.gmgn.ai`, `chain=sol`, one exact case-sensitive mint. Authentication uses `X-APIKEY` and per-attempt timestamp/client ID generated immediately before IO. The source is API-key-only; no signing capability exists in this adapter.

| Read | HTTP path | Selected measurements and limits |
|---|---|---|
| Token info | `/v1/token/info` | Exact response mint; reported 5m/1h/24h USD volumes, current holder count, main pool and selected wallet ratios. Future creation reports and malformed units reject. Token names/descriptions/social instructions are excluded from normalized/public output |
| Security | `/v1/token/security` | Explicit wash flag, rug/insider/bundler ratios and authority flags; missing stays null, false/zero never proves label coverage. Missing response mint is request context only |
| Pool info | `/v1/token/pool_info` | Exact base mint, reported pool/quote/liquidity. Provider main-pool choice is not independent canonical-pool proof |
| One-minute candles | `/v1/market/token_kline` | Closed, minute-aligned window of at most six hours / 360 candles. HTTP bounds are milliseconds, with `to` one millisecond before our exclusive end; candle `time` is seconds. **`amount` is USD; `volume` is token units.** Validate OHLC, order, duplicates, gaps and window boundaries; mark partial coverage explicitly |

The official [Agent API docs](https://docs.gmgn.ai/index/gmgn-agent-api), [pinned HTTP client](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/src/client/OpenApiClient.ts), [market command unit conversion](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/src/commands/market.ts), [token field contract](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-token/SKILL.md) and [chart response reference](https://github.com/GMGNAI/gmgn-skills/blob/402671e2ab8d1336df9e20f4fc7da123dc719e59/skills/gmgn-kline-pattern/SKILL.md) informed these contracts. The normalizer accepts bounded array and `{list}` candle data, reflecting inconsistent examples; **real endpoint fixtures are still required**. It does not infer undocumented field aliases.

The app displays a small normalized projection under **GMGN activity & risk evidence** on a token page. Opening it reads the local cache only. Volumes remain raw reported totals, current holders remain unclassified balances, organic volume and meaningful holder growth stay unknown. A wash flag is attributed to GMGN rather than stated as proven fraud. Receipt age and unknown measurement times remain explicit. The public summary is bounded to the seven most recent UTC days; exact older receipts remain available by operator ID. No raw upstream body is publicly returned, and no app/card render starts upstream collection.

Implementation: [request contract](../../discovery/src/gmgn-request.ts), [normalizer](../../discovery/src/gmgn-normalize.ts), [controller and pilot](../../discovery/src/gmgn.ts), [public schema](../../discovery/src/gmgn-model.ts), [owned transport](../../discovery/src/source-collection-transport.ts), [token evidence panel](../../app/src/discovery/GmgnEvidence.tsx), [operator CLI](../../scripts/discovery-gmgn.mjs).

With the existing local Node relay enabled, GMGN uses a [strict IPv4 bridge](../../scripts/discovery-gmgn-relay.mjs): fixed host/four GET paths, exact Solana identity/query shape, fresh timestamp/UUID and closed one-minute bounds. Native HTTPS pins address family 4, keeps ordinary TLS validation, follows no redirects and forwards only selected JSON/rate headers. The local relay Bearer-equivalent credential is never sent to GMGN; only the query API key reaches that host. No global network/IPv6 setting changes. The Worker-native fallback remains available when the local relay is deliberately disabled; its egress is not independently verified here.

## Collection and free-budget boundaries

GMGN shares the existing prepared-source **20 HTTP attempts/day inside the market maximum of 600/day**, **100 research records / 10 MB per UTC day**, owned lease, pause, backoff and atomic admission. Lower configured market allowances are respected. At most one pilot request is in flight; starts are at least ten seconds apart. Allowed endpoint weights are at most two: this is at most 40 units/day and at most 12 units in a minute under the existing spacing, stricter than the earlier proposed GMGN-only allowances. No additional allowance was introduced.

When the fixed pilot has pending work and shared headroom, the existing maintenance pass allocates **two** score capture attempts and at most **one** GMGN attempt inside its original three-attempt limit. This prevents a busy score queue from starving source research. When the pilot is complete, unconfigured, paused, paced or capacity-held, score research keeps all three slots. A failed/waiting score pass cannot start the GMGN attempt; atomic admission still rechecks every limit before IO. There is no second timer, per-visitor work, default retry or paid fallback. Finalization limits remain unchanged. The initial fixed investigations are:

- PONYX: `ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump`.
- USDF: `AMK8R8NqJ18VQnxsoGgv75pZVLyAG24BafFfp3Zpump`.
- Founder-confirmed Kimchi: `CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump`.

Each receives at most one attempt per endpoint per UTC day, including failures/abandonment: at most twelve of the shared twenty attempts. Stable day/mint/kind IDs prevent concurrent maintenance from duplicating a request. These historical regression mints do not become eligible or re-enter the current creation window because GMGN has data for them. Manual operator investigations share the same original bounds too.

Responses are bounded to 1 MB and fifteen seconds, with manual redirects, no cookies, JSON/complexity validation and no implicit retries. All attempts reserve before IO. Failures count and retain sanitized receipts, not upstream failure text/bodies; echoed API credentials reject. `Retry-After`, exhausted-bucket reset and bounded error `reset_at` hold collection, with large values held conservatively. Authentication/entitlement HTTP failures hold for at least 24h; no top-up or upgrade. Publication still requires current owned lease, UTC day and unpaused state. Successful private research receipts replay hashes; this is integrity verification, not independent provider signatures or pool proof.

## Operator and API use

```powershell
# No key or private-key argument, and no upstream request:
node scripts/discovery-gmgn.mjs sync-key
node scripts/discovery-gmgn.mjs status

# Each admitted command below costs one shared attempt/record:
node scripts/discovery-gmgn.mjs probe ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump
node scripts/discovery-gmgn.mjs review ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump info
# Other review kinds: security, pool, candles. Candles request the last six closed hours.
node scripts/discovery-gmgn.mjs saved REQUEST_UUID
```

The probe validates query access/selected token-info semantics and discards token data and its hash before retention. It still consumes ordinary shared admission. Cached status/replay/public reads cost no provider calls. API paths are generated in [OpenAPI](../../discovery/openapi.json): authenticated `GET admin/gmgn/status`, `POST admin/gmgn/review`, `GET admin/gmgn/reviews/{request_id}`; cached normalized `GET gmgn/solana/{address}`. Existing local-only, Bearer, browser-origin and body-size guards apply. No raw response export, key-management endpoint or action endpoint was added.

## Verification and current limitation

At the local status check, the query key was configured but the shared daily store already contained **100/100 records** and 1,752,343 bytes. Admission must therefore hold before GMGN IO. **No authenticated GMGN token fixture or successful endpoint access is claimed.** Collection can use normal spare capacity on a later UTC day; no old record is deleted or quota reset to make room. No schema migration is needed for these requests, which reuse the existing source reservation store.

The existing v4 score and historical artifacts, independent origin/authority/holder/wallet checks, action/election rules, finalization allowances and provider settings are retained. No signing key, financial action, new subscription, funding, social publication or deployment is introduced.

Validation:

- Full Discovery suite: **1,107 tests / 64 files passed**. Following final scheduling/cache/candle refinements, the three affected admission/GMGN/score-research modules passed **90 tests**; the final GMGN module rerun passed **21**, including an admitted authenticated Worker-to-loopback-bridge request with a fake upstream. The default score-only pass still admits at most three; an explicitly allocated pass admits at most two before one bounded source attempt. No quota was increased. Final Discovery typecheck passed.
- Discovery UI: **84 tests / 16 files passed**. App typecheck/build passed; home startup remains **234.1 KiB gzip / 11 chunks**, under the unchanged 250 KiB budget. Existing third-party annotation warnings remain non-fatal.
- Node credential/operator/relay checks: **nine passed**, with fake upstreams only. They verify exact IPv4 egress options, unchanged TLS validation, local authentication, forbidden routes/parameters, bounded closed windows, rate status/reset propagation and no local-credential forwarding.
- Local status reported the query key configured; the explicit authenticated PONYX probe held with **zero provider calls**. All original 100 score cohorts and zero outcomes stayed byte-identical; foreign keys passed, source reservations remained zero and existing shared usage was untouched.
- Browser QA verified the collapsed GMGN panel and truthful no-observation state on the existing PONYX preview. No upstream call originates from opening it. An ignored screenshot is retained at `.tmp/gmgn-evidence-preview.png`.
- Secret scan found the actual query key absent from changed product sources and all **72 built JS/CSS assets**; both secret files remain ignored and untracked. OpenAPI was regenerated; local documentation targets and whitespace checked.

Only the verified supervisor-owned Discovery launcher tree was restarted to load the new relay, inside the original restart allowance. Other projects/tunnels and the supervisor were preserved; no migration, database replacement, pause/backoff reset or quota reset was performed. Live endpoint semantics/access remain pending ordinary admission.
