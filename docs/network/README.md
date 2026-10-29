# Network feasibility and implementation status

The current production release scope and prepare → bootstrap → activate procedure are in [RELEASE.md](RELEASE.md). The older feasibility and original-MVP gates below are historical context; release targets the latest local feature set with its existing coverage disclosures.

Status: **signer-only next-stage preview implemented at https://network-local.10x.meme**.

The user narrowed the population to accounts that accepted the Network School
rules through NFT signing. This supersedes the original full-Farcaster import
gate below. See [current implementation and runbook](./IMPLEMENTATION.md) for
the signer cohort, namespaces, local preview, source coverage and remaining
production gates. The investigations below are retained as historical evidence
for why importing millions of accounts was rejected. Production remains disabled.

## Run the investigations

From the repository root:

```powershell
node --test scripts/network/feasibility.test.mjs
node scripts/network/feasibility.mjs --live
node scripts/network/official-profile-probe.mjs --live
```

Without `--live`, either probe prints usage and makes no requests. The main probe
reads `NEYNAR_API_KEY` from the environment or existing local `.dev.vars` files;
it never prints credentials. It reserves at most 360 request attempts, has no
automatic retries, spaces request starts, bounds response sizes, and limits
each portfolio to three pages. The separate official-client probe uses no
authentication and makes at most 100 serial profile requests, stopping on 429.

The main probe returns exit code 2 when the feasibility gate is unresolved.
This is an investigation outcome, not a passing launch check. Both probes save
aggregate-only evidence here; they never persist individual wallet valuations
joined to identity, geography or voting status. They never write D1/KV, send
transactions, create subscriptions or post messages.

## Evidence and findings

### A. Voting

The official [vote page](https://farcaster.xyz/~/vote) serves a client bundle
that configures Base contract
`0x4ecfed276c566aeb49da1f3a888e8dbb7263028d`. The address agrees with the
[reference tracker](https://fc.dylanbrodeur.org). The first probe records the
exact bundle URL and SHA-256, contract address and agreement identifier in
[feasibility-results.json](./feasibility-results.json).

Acceptance signs EIP-712 data containing `fid`, `to`, `deadline`, `generation`
and `agreement`; it then calls the client mint/confirmation APIs. A signed-data
schema is **not** a verified contract ABI. The observed leave action calls
`POST /v2/opt-in/opt-out`; no leave action was invoked during investigation.
The client explicitly allows decision changes. A lifetime NFT mint counter
therefore cannot automatically be labelled current acceptance.

An unauthenticated `GET https://client.farcaster.xyz/v2/user?fid={fid}` returns
`viewerContext.optInStatus`. All 100 early-FID profiles tested returned a status.
This offers a possible official source for current status, but its public bulk
access policy, rejection semantics, eligibility rules and reconciliation with
onchain events remain unverified. `moderated_out` must never be classified as
rejection. Missing status must never be classified as undecided.

Base bytecode was readable through the existing public RPC fallback. The same
provider returned HTTP 403 for the bounded initial-event log query. Basescan
did not expose a verified ABI in the retrieved page, and checked Sourcify
repositories returned no matching contract. A supported log provider and
verified event/calldata schema remain required; do not reverse-engineer a FID
assignment from NFT ownership or token IDs.

### B. Profiles, location and profile tokens

Neynar Snapchain `/v1/info` reported **3,355,055 registrations** across two
identity shards. This is a source-reported count, not independent full-network
enumeration. `/v1/fids` requires `shard_id` and uses camel-case `pageSize` and
`pageToken`; an unsharded scan is incomplete.

The existing key retrieved 376/376 sampled hydrated profiles. All omitted
usable hydrated country and profile-token fields. **These omissions do not
establish unknown location or absence of a token.** Raw userdata from 24 FIDs
contained no profile-token assignment. A separate targeted raw-location check
found a public `geo:` location where the hydrated API omitted one, confirming
that hydration alone is insufficient.

The official-client source returned all 100 early-account profiles requested:
31 explicit location descriptions normalized to countries and 69 remained
unknown/unresolved. It also returned canonical CAIP-19 token assignments. See
[official-profile-results.json](./official-profile-results.json). Empty token
URIs mean explicitly cleared affiliations; absent fields remain `not_returned`
until absence semantics are verified. Locations are normalized only when the
description explicitly names a country; city-only text is never guessed.

This establishes a promising source for the desired fields, not a supported
complete export or refresh contract. The sample deliberately overrepresents
early accounts; none of its coverage rates can be extrapolated to the network.

The [profile-token proposal](https://github.com/farcasterxyz/protocol/discussions/247)
specifies CAIP-19 identifiers. The [Neynar bulk-user API](https://docs.neynar.com/reference/fetch-bulk-users)
and [raw userdata API](https://docs.neynar.com/reference/fetch-user-data) must
not be assumed to expose the same fields as the production client.

### C. Base valuation

The existing Neynar key can read the [wallet balances API](https://docs.neynar.com/reference/get-wallet-balances).
The probe attempted 100 distinct verified EVM wallets and requested 145 balance
pages. **91 portfolios completed; nine exceeded the pagination cap.** Those nine
were kept unavailable, never assigned zero or partial valuations.

The probe checked an explicit Base allowlist for native ETH, WETH, USDC and
cbBTC, preserving quantities as integers and calculating with fixed-point
arithmetic. It rejected 5,413 unsupported balance rows in completed portfolios.
This intentionally narrow investigation allowlist is not a final product asset
catalogue. Provider `balance_usd` values without explicit accepted prices are
insufficient. Duplicate asset rows invalidate a portfolio rather than inflating
its sum.

Native-balance completeness, block timestamps, quote timestamps and full-network
wallet ambiguity remain unverified. Consequently monetary totals are withheld
from the saved country tables. The sample contains no shared wallet, so the
cross-FID duplicate path is tested with fixtures rather than claimed to have
been validated against a real ambiguous sample.

### D. Geography and infrastructure cost

The country sample in the official-client report reconciles located plus
unknown/unresolved profiles to the retrieved cohort. Country groups below ten
are suppressed. Sensitive status breakdowns and small token cells are withheld;
there is no individual financial output. An end-to-end country table containing
chain-reconciled votes, validated affiliations and timestamped wallet value
has **not** yet been established.

The [D1 capacity observation](./cloudflare-capacity.json) records approximately
160 MB of current data, 122 tables and existing daily query/row operations.
That is storage headroom evidence, not proof that the shared database can
accommodate Network's ingestion and filtering load. Cloudflare documents a
[10 GB paid D1 database limit and single-threaded database execution](https://developers.cloudflare.com/d1/reference/faq/).

At the reported network size, a REST profile sweep needs at least 33,551
100-FID batches. A per-FID token sweep needs at least 3,355,055 requests; repeating
it hourly would require **2,415,639,600 requests per 30 days**, before pagination
or retries. This is a call-count calculation, not a fabricated credit or dollar
estimate. Efficient incremental ingestion is essential.

[Neynar exports](https://docs.neynar.com/docs/parquet) require provisioned access
and setup/pricing confirmation. Existing local configuration establishes API-key
access, but does not establish an export entitlement, remaining monthly credits,
endpoint tariffs, or permitted official-client collection volume. The probes
did not buy an export, raise a limit or request millions of accounts.

## Inputs needed to clear the gate

1. Existing Neynar plan, remaining credits and any provisioned full/incremental
   export or indexer access. Verify that it includes client profile tokens,
   locations and changes, and a complete activity stream for the agreed 30-day
   active definition.
2. Supported access to official current-status data, including rejection and
   absence semantics; verified contract ABI/events and eligibility conditions.
3. A reliable Base balance/log source and timestamped accepted price source,
   with a measured request budget for all distinct included wallets.

If these require paid capacity, report the measured incremental cost for a
decision before proceeding. Once the exit condition passes, resume the agreed
namespaced migrations, ingestion, aggregate APIs, dashboard and local tunnel.
Do not replace any of these missing capabilities with synthetic public numbers
or label this feasibility sample a working dashboard.

## Validation

Eight dependency-free Node tests cover precision, partial/empty portfolios,
duplicate assets and wallets, token clearing/absence, canonical identifiers,
country normalization, identity validation and scale calculations. Both live
probes have been exercised; the main run used 181 of its 360 reserved attempts.
No application code or dependencies changed, so app build/test runs are not
required for this investigation-only change.
