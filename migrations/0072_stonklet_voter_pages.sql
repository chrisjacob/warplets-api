CREATE INDEX IF NOT EXISTS idx_stonklet_asset_favourites_voter_pages
  ON stonklet_asset_favourites (pair_id, asset, active, favourited_at DESC, identity_wallet ASC);
CREATE INDEX IF NOT EXISTS idx_warplets_users_normalized_primary_wallet
  ON warplets_users (lower(trim(primary_eth_address)), fid);
