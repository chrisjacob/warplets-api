# Network geography

Country → state/province → city is available on the map and contextual ranking. Breadcrumbs return to a parent. A city selection filters public member cards, KPIs, token groups, wallet aggregates and Man-Months together. URLs retain the hierarchy and browser back/forward restores it. Changing a parent clears its descendants.

Only the currently public Farcaster profile location is matched. The profile description and place ID are retained with source and observation time in `network_profile_locations`. No IP, wallet activity, language, nationality or inferred residence is used. Google place IDs are provenance, not calls to Google Maps. City markers are settlement centers, never individual coordinates.

An explicit country is required. State and city names come from canonical GeoNames records, with verified Natural Earth aliases and administrative parents. Exact primary names are tried before alternate names. A match must be unique within its supported country/state/parent constraints; popularity never resolves ties. Ambiguous names stay unresolved; population does not break ties. Names absent from the gazetteer, metro areas and country-only descriptions are not assigned an invented city. Missing state/city counts remain separate ranking buckets and reconcile with parent totals. Former snapshots retain the granularity actually observed then.

## Sources and preparation

- [GeoNames cities500 and admin1](https://download.geonames.org/export/dump/readme.txt), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Canonical IDs use `gn:<geonameid>` and GeoNames admin1 codes, which differ from ISO codes in some countries.
- [Natural Earth admin1](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/), public domain. A subdivision code alone never links a boundary: names and current canonical parents must agree. Verified admin2 features can be grouped under their canonical admin1 parent. Unverified boundaries are omitted; affected states use a point marker and settlement extent from the gazetteer rather than an invented polygon. These are display boundaries, not a statement on disputed sovereignty. Some countries have different administrative structures; level 2 is their first administrative subdivision.
- Exact downloaded source URLs and SHA-256 hashes: `app/public/network/geography-sources.json`. Downloaded source/seed databases stay in `.tmp/network-geo`.

Run `python scripts/network/prepare-geography.py --local` to download the public datasets, generate simplified country-specific state maps, and seed the existing shared local D1. Only `network_*` tables are changed. This uses no Alchemy/Neynar credits or paid geocoding. State shapes total approximately 4.8 MB across 228 countries; only the opened country is downloaded by the browser. The city gazetteer is queried server-side by indexed country/name and is never sent wholesale to the browser.

Migrations `0100_network_geography.sql` and `0101_network_geography_matching.sql` are additive and Network-only. The CLI and Network test fixtures apply it. Production is still disabled: before any eventual deployment, apply the migration and stage and chunk the generated `.tmp/network-geo/sql/<COUNTRY>.sql` seeds within the actual D1 command, daily write and storage allowances. A large country file can itself exceed a daily allowance; do not treat one country as a safe execution batch. Do not run the whole world seed against free D1 at once. Public APIs never initiate external reads or geocoding. Ordinary profile ingestion saves and resolves new public text. It prioritizes previously located profiles missing a detailed-location observation, then resumes normal refresh order. Existing request budgets, cooldowns and signer-only cohort remain in force.

## Verification

Geography tests cover explicit hierarchy, state suffixes, ambiguous duplicate cities, unknown finer locations, invalid parent filters, cleared locations and equality of aggregate/member counts at every level. Browser tests drill into real imported US → California → city records, verify directory counts, breadcrumbs, constrained static routes and mobile overflow. Wallet cell keys include state and city so separate places cannot accidentally share one aggregate.

Australian city/state/postcode strings (including `Albury NSW 2640, Australia` and `Sydney, NSW 2000, Australia`) retain their explicit state while discarding the postal suffix for canonical city matching. Postcodes alone never establish a city. Source-attested Australian `<name> City` aliases are included from GeoNames. Map footer known/unknown counts refer to the current geographic level, not just country coverage. Run `node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --geography` to re-resolve saved descriptions and republish locally without any upstream requests.

## Global parser audit — 19 October 2026

`global-geography-v2` audits explicit countries in varied address positions, country-specific postal suffixes/prefixes, normalized Unicode/spacing, city/state name collisions, localized aliases and current administrative parents. Country-only descriptions (including Singapore/Hong Kong) stay country-only. Single-word country suffix guesses such as “New Mexico” or “University of Georgia”, and ambiguous state/country codes such as “San Francisco, CA”, are rejected. A postcode never locates a person or resolves an ambiguous city by itself. Unrecognized finer components do not erase an independently verified city/state pair; conflicting verified parents reject the match.

Examples fixed include US state + ZIP, Canadian and UK postal formats, French postcode prefixes, Ukraine's country-before-postcode format, UAE hyphen-delimited descriptions, Seoul/Berlin/Dhaka city-state names, New York aliases, Rome/Milan metropolitan parents, and Brazilian state and Colombian department qualifiers. State aliases are attached across administrative levels only through verified canonical relationships. Philippine ADM1 aliases are checked against the matching GeoNames ID in the official country extract, covering Metro Manila without a guessed synonym. Short airport-code-style alternatives are excluded; primary short settlement names remain valid.

The previous code-only boundary join also assigned wrong state IDs in some countries: Paris and Ho Chi Minh City are among the corrected cases. Canonical regions and their city coordinates now determine the grouping. Point-only state markers keep 43 currently matched profiles visible where a reliable boundary was unavailable; the markers are gazetteer positions, not individual coordinates. The state view includes observed city centers when an older boundary covers only part of the current canonical subdivision.

The reviewed local backfill updated 1,165 saved observations. Within the 5,582 retained location observations (2,816 nonempty), country matches increased from 2,791 to 2,812, state matches from 2,165 to 2,602, and city matches from 1,236 to 2,278. The signer denominator did not change. No upstream calls, Neynar credits or Alchemy CUs were used. These counts describe the audited observation set, not an assertion that every signer has a public location.

Run `--geography-audit` on the local CLI before `--geography` to inspect changes. Reports in `.tmp/network-geo/audit-preview.json` and `audit-applied.json` include source hashes, resolver version, before/after coverage, per-country counts and changed descriptions. The apply step preserves source observation timestamps, skips concurrent newer profile observations, updates Network tables only, and republishes a snapshot. Historical snapshots remain unchanged; new snapshots record their geography resolver version.

Verification: `node node_modules/tsx/dist/cli.mjs scripts/network/geography-qa.ts` checks 38 real-world descriptions plus eight boundary/alias regressions against the downloaded gazetteer, without upstream requests. Network Vitest covers parsing ambiguity, parent contradictions, postal formatting, all-level reconciliation and preservation of country-only data. Browser tests check country/directory reconciliation across ten countries and keyboard/click selection of states without boundary polygons. Regenerate map assets alone with `python scripts/network/prepare-geography.py --maps-only`.

## Retained-location backfill

The normal five-minute local ingestion now prioritises unknown-country profiles
whose raw location observation is missing or has a different timestamp from the
current profile. Known-country profiles with missing raw text follow unobserved
profiles, before routine age-based refreshes. Empty descriptions with matching
observation timestamps are retained as genuine blanks and do not repeatedly
enter the backfill. Each successful response uses the existing save/normalize
path and republishes aggregates. Failures retain prior observations and retry
under the existing cooldown. No paid Neynar or Alchemy calls are introduced;
public profile requests still use the shared daily/monthly request caps.

`node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --status` reports
`locationBackfill.remaining` and `.unknownCountry` for the signer cohort. The
queue is derived from current records, so restart/resume requires no cursor reset.

## Unmatched-location simplification

At the user's request, descriptions that cannot resolve to a country are stored
as empty descriptions, with no place ID. They use the existing Unknown location
group; there is no separate nonblank/unparsed product category. Member APIs
return canonical matched locations only. Previously stored current unmatched
observations were cleared locally. Matched country descriptions retain their raw
text for state/city improvements. An empty observation remains a completed fetch
and is refreshed on the normal schedule, not repeatedly backfilled.
