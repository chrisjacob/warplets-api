-- Hide historical non-ETH/refunded sales from visible Warplet market state.
-- Ownership, listings, offers, and OpenSea action logs are intentionally untouched.
UPDATE warplet_market_state
SET
  sale_eth = NULL,
  sold_at = NULL,
  sale_tx_hash = NULL,
  seller_wallet = NULL,
  sale_raw_amount = NULL,
  sale_decimals = NULL,
  sale_currency_symbol = NULL,
  sale_token_address = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE sale_eth IS NULL
  AND (
    sold_at IS NOT NULL
    OR sale_tx_hash IS NOT NULL
    OR seller_wallet IS NOT NULL
    OR sale_raw_amount IS NOT NULL
    OR sale_decimals IS NOT NULL
    OR sale_currency_symbol IS NOT NULL
    OR sale_token_address IS NOT NULL
  );
