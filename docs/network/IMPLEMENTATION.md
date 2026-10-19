# Network signer-cohort preview

The dashboard now targets the acceptance cohort, not every registered Farcaster
FID. Review at **https://network-local.10x.meme**. The public production hostname
`network.10x.meme` has not been deployed or enabled.

## Membership and provenance

Two evidence paths contribute distinct FIDs to the cohort:

1. **Independent onchain evidence:** matching `OptInMinted(uint256 indexed fid,
   address indexed to)` and original zero-address `Transfer` events in the same
   transaction on `0x4ecfed276c566aeb49da1f3a888e8dbb7263028d` on Base. Preserve
   transaction hash, log index, block number/hash and chain timestamp. Later NFT
   transfers never establish acceptance for their recipients.
2. **Official confirmation:** a candidate FID from the contract tracker's
   signer list is independently read from the official client's user endpoint.
   Only `optInStatus=opted_in` establishes an official confirmation. Candidates
   alone, opt-outs, pending records, moderation and missing records never do.

Once observed, official confirmation is historical acceptance evidence; a later
client opt-out changes current status, not the fact that acceptance was observed.
FIDs present in both paths count once. This does not establish unique humanity,
bot status, citizenship or current ownership of the NFT.

The event signature hashes to
`0xb51e0080591358c6acd543e4989b2cc178707c6d20c9218e83f2af19a8a1e315`.
The first observed successful mint has selector `0x0a815f2c`, matching
`mint(uint256,address,uint256,uint256,string,bytes,bytes)`. Its calldata FID and
recipient match both events. Audit example:
`0xdc37161c321d017ade09a4f23c0407887e52339f49a7456a0ab8b1ad85770aa4`.
This is the observed minimal schema, not a claim to have independently verified
the complete deployed contract source or every signature.

The preview visibly distinguishes official confirmations from independently
chain-reconciled FIDs. Acceptance charts use chain timestamps only. An official
confirmation's observation time is never backdated into a signing date.

## Delivered behavior

- Namespaced React dashboard, responsive desktop/mobile layouts, country map
  with bubbles/shading, keyboard and touch selection, country/token rankings,
  token search, source explanations, Reset and URL-backed filters.
- Combined country, location, current client status, token and stored-snapshot
  filters. All displayed aggregates for a response come from one immutable cube.
- Unknown/unresolvable public location differs from a profile not retrieved.
  Explicit token clearing differs from a field omitted by the source. Canonical
  identifiers preserve chain and contract/mint identity.
- Public signer directory with display names, usernames, avatars and stable
  Farcaster FID links. Search by username, display name or FID, with keyset
  pagination and country/location/status/token cross-filters. Per the updated
  product direction, public profile counts and directory entries are visible
  at every group size. Member cards show supported Base verified-wallet estimates, following the user’s explicit request. Partial portfolios are labelled; shared wallets remain unattributed.
  Historical snapshots contain aggregates only; the directory clearly requires
  the latest observation. The aggregate cube is not returned by public APIs.
- Immutable snapshots, read-only cached public APIs, request budgets, leases,
  source failure preservation, per-profile retry delay and 429 cooldown.
- A resumable finalized-block scan with checkpoint hash verification and reorg
  replay. The root scheduled Worker owns production ingestion when enabled;
  Pages GET requests never collect provider data.

Base verified-wallet valuation and the separate top-held-token filter now have a
real, bounded pilot. See [wallet methodology and import status](./WALLETS.md).
Pending wallets remain unavailable, not zero; the whole-cohort balance sweep
awaits a credit-cap decision. Complete 30-day activity remains unavailable, and
this preview is not represented as the complete PRD MVP.
The public RPC quota interrupted the initial chain scan; the last checkpoint
remains intact. Full independent chain reconciliation requires a suitable
existing dedicated Base RPC or another validated bulk log source.

## Local operation

The existing shared local D1 receives only `network_*` tables from migration
`0095_network.sql`, `0096_network_members.sql` and `0097_network_wallets.sql`. Existing schemas, records, migration bookkeeping and app
processes are not reset. The local CLI prints aggregate counts only.

```powershell
# Inspect/init only the Network namespace.
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --status

# Resumable signer candidates + official confirmation/profile enrichment.
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --profiles --steps=200

# Resume independent onchain reconciliation with an available log provider.
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --scan --steps=100

# Publish the latest validated aggregate state.
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --publish

# Seed/refresh public presentation from the existing signer feed (two budgeted
# requests, no full per-FID sweep). Official-client identities take precedence.
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --members

# Build and serve only the compiled Network preview plus its public read APIs.
node scripts/dev-tunnel-network.mjs
# Add --local-only for http://127.0.0.1:8799 without the tunnel.
```

The launcher also runs a bounded local refresh every five minutes, respecting
profile freshness, source cooldowns, the ingestion lease and daily/monthly caps.
Preview ports are 8798 (private Pages Functions) and 8799 (restricted public
proxy). No Vite source server is exposed. The proxy rejects non-GET/HEAD methods,
admin routes, other apps, secrets and source paths. Browser tests check these
restrictions. The tunnel is `network-local`; its credentials live in ignored
`.tmp/network-tunnel.json`, never in tracked source.

## Configuration and limits

`NETWORK_ENABLED` gates public APIs/HTML. `NETWORK_INGEST_ENABLED` gates the
scheduled job. Both remain false in production/preview configuration; the local
launcher overrides serving only. The local ingestion CLI explicitly enables its
own bounded execution. No remote D1 migration or production deployment was run.

- Existing D1/KV bindings remain `WARPLETS` / `WARPLETS_KV`.
- `NETWORK_RPC_URL` optionally selects the dedicated Base endpoint; the existing
  `BASE_RPC_URL` is also supported by the Worker. Secrets stay server-side.
- Profile refresh defaults to 24 hours; candidate discovery to 15 minutes.
  `NETWORK_PROFILE_REFRESH_HOURS` supports 1–168 hours, subject to the request cap.
- Production batches default to eight 50-block ranges and 20 profiles per run;
  local bootstrap uses 50 ranges / 100 profiles. Only four readers run concurrently.
- Default caps are 100,000 total source attempts/day and 600,000/month, including
  failed/fallback requests. These are request caps, not credit/dollar estimates.
  No paid Neynar requests or paid fallback is used for signer/profile ingestion.
- Snapshots publish at most every ten minutes during routine work; local
  `--publish` forces a reconciled snapshot. Keep recent snapshots and the latest
  snapshot for each older UTC day. Historical profile memberships are frozen
  in that snapshot, not reconstructed from today's profiles.

The official client endpoint is public and works for the cohort, but a supported
long-term bulk/incremental access agreement remains a production dependency.
Daily profile refresh is deliberate; hourly full-cohort polling is not promised.

## Validation

```powershell
node app/node_modules/typescript/bin/tsc --noEmit -p app/tsconfig.network.json
node app/node_modules/vitest/vitest.mjs run --config app/vitest.network.config.ts
node app/node_modules/vite/bin/vite.js build --config app/vite.network.config.ts
node scripts/network/browser-test.mjs
node scripts/security-preflight.mjs
```

The isolated preview build avoids importing unrelated applications and emits
approximately 226 KB JavaScript / 70 KB gzip, 18 KB CSS / 4.1 KB gzip, plus a
193 KB Natural Earth map asset. Desktop/mobile screenshots and browser results
are in ignored `.tmp/network-qa`. Full-app type checking currently encounters
pre-existing missing `tldts` and `lightweight-charts` installations; the Network
typecheck/build is separate and does not reinstall the running workspace.

## Rollout and removal

### Permission-free location updates

The map includes expandable instructions linking to `https://farcaster.xyz`.
People edit their own public profile inside Farcaster; Network never requests
a signer, login, wallet connection, or profile-write permission for this flow.
Public client assets checked on 18 October 2026 (`index-cd8plQi8.js` and
`ProfileContent-D4MVv_ML.js`) expose an Edit profile modal with a location
selector and Save changes. No stable direct editor route was identified, so
the link opens Farcaster and gives the profile navigation steps instead.
The UI explains the daily profile refresh target and country normalization;
opening the link does not trigger an ingestion or guarantee immediate updates.
User-provided iOS screenshots confirm Profile → Edit profile → Location,
manual metro-area entry, a separate Location Save button, and an optional
Enable location prompts toggle. Instructions explain that this toggle can stay
off and that the saved location is public; Network needs no device location
access. The external link remains the Farcaster homepage, not an unverified
native editor deep link.

Before enabling production: finish source reconciliation, validate provider
capacity and recovery, complete the required wallet/activity datasets, run full
workspace checks with its declared dependencies installed, and review the local
preview. Use the existing migration/Pages/Worker deployment ownership in the
production runbook; do not create a second deployment pipeline.

To remove Network later: disable both flags, remove its hostname/tunnel route,
remove its lazy frontend/metadata/scheduler integrations, then explicitly drop
only the `network_*` tables and expire only `network:` KV keys. Do not delete or
replace the shared D1/KV resources. Keep migration history intact.

See [UI and monthly participation](UI_ACTIVITY.md) for the 19 October interface,
Man-Months, source coverage and retained wallet budget.

Country, state/province and city navigation are implemented for the local preview. See [GEOGRAPHY.md](GEOGRAPHY.md) for canonical matching, map assets, migration 0100 and staged production seed requirements.
