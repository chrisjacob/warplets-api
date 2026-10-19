# 10X Warplet holder filter

Network's Latest view accepts `warplet=holders`; the map, rankings, KPIs,
wallet totals, Man-Months and member directory all apply the same FID group.
Selecting a historical date clears this filter: earlier snapshots did not
retain holder membership. The URL parser rejects historical holder claims.

No provider/API/onchain requests are made for this feature. Snapshot publication
reads existing `warplets_metadata`, `warplet_market_state`, cached
`wallet_farcaster_links` and already-imported `network_wallet_links`.

- The token's saved current owner overrides its original airdrop recipient.
- A current observed unknown owner or burn never falls back to the recipient.
- An untouched/missing ownership observation can use the metadata allocation.
- FIDs from cached links, recorded owner and unchanged original wallet must
  agree. Conflicts are left unresolved; no arbitrary identity assignment.
- Multiple NFTs/wallets per FID still produce one member. Only pledge signers
  enter Network's filtered cohort.

Only `network_warplet_holders` is materialised, atomically, with token counts and
calculation time. Warplets tables remain read-only. The snapshot retains holder
membership, source update timestamp and resolved/unresolved token coverage.
The About section reports the saved ownership date; this is last recorded
ownership and cannot detect transfers absent from Warplets' saved data.

Migration: `0102_network_warplet_holders.sql`. Empty optional snapshot fields are
omitted to accommodate the new grouping without increasing the storage budget.
Historical snapshots and default aggregate interpretations remain unchanged.
