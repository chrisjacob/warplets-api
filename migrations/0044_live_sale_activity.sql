DROP TRIGGER IF EXISTS trg_market_activity_from_notification;

CREATE TRIGGER trg_market_activity_from_notification
AFTER INSERT ON warplet_activity_events
WHEN NEW.token_id BETWEEN 1 AND 10000
  AND NEW.occurred_at >= '2026-07-02T00:00:00.000Z'
  AND LOWER(NEW.event_type) IN ('listed', 'listing', 'offered', 'offer', 'sold', 'sale', 'purchased')
BEGIN
  INSERT INTO warplet_market_activity (
    canonical_key, event_type, token_id, price_eth, amount_raw, currency_symbol,
    transaction_hash, order_hash, from_wallet, from_fid, to_wallet, to_fid,
    occurred_at, source, raw_payload, updated_at
  ) VALUES (
    CASE
      WHEN LOWER(NEW.event_type) IN ('sold', 'sale', 'purchased') AND NEW.transaction_hash IS NOT NULL
        THEN 'live-sale:' || LOWER(NEW.transaction_hash) || ':' || NEW.token_id
      ELSE 'activity:' || NEW.event_key
    END,
    CASE
      WHEN LOWER(NEW.event_type) IN ('listed', 'listing') THEN 'listing'
      WHEN LOWER(NEW.event_type) IN ('offered', 'offer') THEN 'offer'
      ELSE 'sale'
    END,
    NEW.token_id, NEW.amount_eth, NEW.amount_raw, NEW.currency_symbol,
    NEW.transaction_hash, NEW.order_hash,
    CASE WHEN LOWER(NEW.event_type) = 'purchased' THEN NEW.counterparty_wallet ELSE NEW.actor_wallet END,
    CASE WHEN LOWER(NEW.event_type) = 'purchased' THEN NEW.counterparty_fid ELSE NEW.actor_fid END,
    CASE WHEN LOWER(NEW.event_type) = 'purchased' THEN NEW.actor_wallet ELSE NEW.counterparty_wallet END,
    CASE WHEN LOWER(NEW.event_type) = 'purchased' THEN NEW.actor_fid ELSE NEW.counterparty_fid END,
    NEW.occurred_at, NEW.source, NEW.raw_payload, CURRENT_TIMESTAMP
  )
  ON CONFLICT(canonical_key) DO UPDATE SET
    price_eth = COALESCE(excluded.price_eth, warplet_market_activity.price_eth),
    from_wallet = COALESCE(excluded.from_wallet, warplet_market_activity.from_wallet),
    from_fid = COALESCE(excluded.from_fid, warplet_market_activity.from_fid),
    to_wallet = COALESCE(excluded.to_wallet, warplet_market_activity.to_wallet),
    to_fid = COALESCE(excluded.to_fid, warplet_market_activity.to_fid),
    raw_payload = COALESCE(excluded.raw_payload, warplet_market_activity.raw_payload),
    updated_at = CURRENT_TIMESTAMP;
END;
