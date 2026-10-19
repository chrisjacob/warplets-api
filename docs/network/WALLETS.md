# Network verified-wallet valuation

Local preview implementation. Production collection remains off.

**19 October update:** [Alchemy backfill](ALCHEMY.md) now supplies balances when
the local Alchemy key is present, with a separate 10M-CU hard monthly cap.
The Neynar credit cap remains 100,000. Earlier pilot notes below are historical.

## Scope and status

The initial association sweep observed 17,814 imported FIDs, 40,653 verified EVM
links and 40,581 distinct wallets. Ten FIDs had no verified EVM wallet. These are
timestamped observations; the live signer cohort continues to grow.

The first bounded valuation pilot retrieved 40 complete wallets and excluded
1,749 unsupported/unpriced balances. It is not a representative network sample
and is not extrapolated. The preview labels the total as **partial**, with
whole-cohort measurement coverage. The rest of the balance sweep awaits the
operator's credit-cap selection. No plan upgrade or overage configuration changed.

## Attribution and valuation

- Base only, using current observed verified EVM associations. Custody/signing
  addresses are not silently substituted for missing verified wallets.
- Deduplicate addresses globally. Wallets shared by multiple imported FIDs are
  counted once in the global total and remain unallocated to countries, profile
  tokens and top-held groups. Ambiguity checks cover the imported cohort.
- Retrieve every Neynar wallet-balance page before replacing a valid value.
  At most 20 pages of 100 entries per wallet; repeated cursors, missing page
  metadata and malformed quantities do not produce a measured zero.
- Native ETH is canonical `eip155:8453/slip44:60`; ERC-20 assets use chain and
  lower-case contract in CAIP-19. Native aliases cannot double-count ETH.
- Provider USD totals are ignored. DefiLlama quotes must be positive, no more
  than two hours old at acceptance, not future-dated by over five minutes, have
  confidence >=0.95, and match token decimals. Unsupported, unpriced and
  decimal-mismatched balances are excluded with counts. No NFTs, DeFi positions,
  debt or offchain assets are included. This is not net worth/liquidation value.
- Quantities and USD calculations use BigInt, with 24-decimal price precision
  and 8-decimal USD accounting. A complete per-account portfolio requires every
  included wallet to have a valid retrieval and no shared-wallet ambiguity.
- Average/median use complete attributable accounts. Partially retrieved
  accounts still contribute their observed attributable wallet values to the
  partial total, but do not receive a top-held assignment.

## Top token held

Separate from self-declared profile-token affiliation. Rank each asset by the
sum of its independently priced USD positions across that FID's verified Base
wallets. Native ETH and stablecoins are included by the current default; equal
values break ties by canonical asset ID. Pending measurements, ambiguous shared
wallets, only-unpriced holdings and no positive priced holding remain distinct.

The `held` URL filter combines with country, location, current status, profile
token and stored snapshot. It updates dashboard statistics, map, rankings and
the current public-profile directory. Historical snapshots before wallet data
exist do not acquire synthetic wallet history.

## Refresh and limits

- Daily balance/association freshness target, subject to budgets. The root
  Network scheduled owner can collect one wallet per invocation when
  `NETWORK_WALLETS_ENABLED=true`; its production defaults remain false.
- Hourly independent price refresh reuses recorded token quantities. It does
  not refetch every balance or rewrite every wallet. New immutable snapshots
  record the recalculated estimate, original balance observation window and
  accepted price window. Older snapshots never change.
- A shared wallet-value lease prevents duplicate collection. Failed reads keep
  prior values, delay that wallet for one hour, and use a 15-minute cooldown on
  provider 429/402/403. No retries bypass the existing Network request caps.
- `NETWORK_WALLET_CREDITS` is a conservative monthly reservation cap, default
  100,000. Associations reserve two credits per FID. Balance pages reserve up to
  1,000, then release unused reservation using ten per returned object (minimum
  ten). Failed requests retain their reservation. These upper-bound reservations
  are not an account billing statement or proof of unused subscription credits.
- Existing Network source-request caps (100,000/day, 600,000/month) include
  Neynar and price requests. Reaching either cap pauses work rather than raising
  a limit. Provider keys remain server-side; public GETs never call providers.

Local commands use the existing shared D1 and only `network_*` tables:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --wallet-addresses --steps=250
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --wallet-values --steps=1000
node node_modules/tsx/dist/cli.mjs scripts/network/local.ts --publish
```

The valuation command always publishes the last valid completed results even
when a later wallet hits a cap. Resume the same command after an approved budget
change or source reset; existing fresh wallets are skipped.

Sources: [Neynar balances](https://docs.neynar.com/reference/get-wallet-balances),
[Neynar public pricing](https://dev.neynar.com/pricing),
[DefiLlama prices](https://coins.llama.fi/prices/current/coingecko:ethereum).

## Member directory (19 October)

Member cards include canonical public location and supported Base verified-wallet
estimates on request. Portfolios use cached balances and current accepted cached
quotes, falling back to last valid estimates with a stale label. No provider calls
are made when browsing members. Only the 24 visible members' portfolios load.
Shared-wallet ownership is checked across the whole signer cohort regardless of
filters; ambiguous portfolios show no personal estimate. Missing measurements
are pending, distinct from a fully measured zero; partial estimates show partial.

Wallet collection remains limited by the combined 100,000 requests/day budget as
well as Alchemy CU caps. A daily-budget pause resumes after midnight UTC. These
are local safety limits, not evidence that the provider's free tier was exhausted.
