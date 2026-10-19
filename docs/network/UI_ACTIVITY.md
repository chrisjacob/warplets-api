# Network UI and Man-Months — 19 October 2026

The local preview at https://network-local.10x.meme uses the existing Cloudflare
Pages Functions / D1 backend. Production flags remain disabled.

## Interface

The main view is four KPIs (members, Man-Months, partial Base wallet value,
represented countries), collapsed filters, country/token rankings, map, monthly
participation and public member profiles. The headline is “The Farcaster Network
State.” Sources, balances, detailed coverage and membership history live inside
About the data. Errors retain one short retry message. Location help stays
collapsed. The map's bubble scale excludes unmapped groups so the visible
countries have a useful size range.

## Man-Months definition

The user confirmed one distinct FID per UTC calendar month with a qualifying
activity, beginning with the original pledge-signing month. Signing grants one
for that month; elapsed time alone never earns more. Later months need observed
Farcaster protocol activity (posts/replies, reactions, follows, user-data updates
or verifications). Ordinary wallet transfers do not count. A hundred actions in
one month still count once.

Onchain signing timestamps establish the first month. Client confirmations with
no chain timestamp stay undated; their signing month is never guessed from the
import date. Historical snapshots stop at their own creation timestamp. Country,
location, status, affiliation and held-token filters use the same aggregate cube
as population and valuations. Activity month sets are part of the cube grouping
key, so differing histories cannot be merged accidentally.

`0098_network_activity.sql` adds only `network_*` tables. Positive evidence stores
FID/month, message hash, action type, source, action timestamp and observation
time. Publication rechecks activity against the current original signing time,
including after chain reconciliation. Old snapshots remain immutable.

The bounded scheduled collector reads at most one missing member-month per run
from the five Neynar Snapchain ByFid endpoints, with pageSize=1 / reverse=true.
It checks the latest retained action from each surface and stops when positive
evidence is found. Signing months need no activity API reads. This collector is
an initial positive-evidence collector, not an exhaustive historical archive.
Latest-state APIs can omit removals, pruned messages and earlier actions.
Consequently unobserved months remain unresolved, not confirmed inactive/churned.
Totals show ≥ when unresolved member-months or undated members remain. The API
includes observed consecutive-month retention counts and denominators; a final
churn count or exact retention rate needs complete archival/live-event coverage.
No future activity or synthetic retention data is shown.

Reads use a namespaced concurrency lease, daily retry checks, source cooldown,
shared request budget and the same monthly Neynar credit reservation cap as
wallet collection. No new paid service or signer permission was created.
The existing scheduler and local CLI call the collector; manual invocation is
`node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --activity`.

References verified during implementation:
- https://snapchain.farcaster.xyz/reference/httpapi/httpapi (Farcaster epoch, paging)
- https://snapchain.farcaster.xyz/reference/httpapi/casts
- https://github.com/neynarxyz/OAS/blob/main/src/hub-api/spec.yaml

## Wallet budget

The user explicitly retained the 100,000-credit monthly cap. The latest run
increased full wallet coverage from 40 to 105 and stopped at the reservation
boundary (99,908 credits reserved). These are conservative local reservations,
not a claim about the provider's actual billed usage. Prices and resulting USD
values can change. No subscription or overage setting was changed. A full
40,000+ wallet sweep remains incomplete under that budget. Dashboard value is
labelled with measured-wallet coverage rather than extrapolated.

## Checks

Network typecheck, isolated production build, 40 backend tests, security
preflight and browser checks cover desktop/mobile overflow, collapsed details,
map interactions, cross-filtering, search, pagination, profile links and route
restrictions. Ignored screenshots are in `.tmp/network-qa`. The additional
activity tests cover duplicate months, pre-pledge/future records, UTC/year
boundaries, historical snapshots, filtered totals, identity validation, budget
exhaustion and zero provider calls in the signing month.
