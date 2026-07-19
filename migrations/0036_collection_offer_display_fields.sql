ALTER TABLE opensea_criteria_offers ADD COLUMN remaining_quantity INTEGER;
ALTER TABLE opensea_criteria_offers ADD COLUMN order_status TEXT;
ALTER TABLE opensea_criteria_offers ADD COLUMN bidder_profile_json TEXT;

CREATE INDEX IF NOT EXISTS idx_opensea_criteria_offers_collection_status
  ON opensea_criteria_offers(collection_slug, criteria_kind, active, order_status, offer_raw_amount);
