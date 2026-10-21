-- Operator requests are discovery leads, never candidate/eligibility evidence.
CREATE TABLE tenx_mint_reviews (
  address TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  curve TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','scanning','admitted','unsupported_quote','not_found','expired')),
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0 CHECK(pages BETWEEN 0 AND 3),
  before_signature TEXT,
  page_full INTEGER NOT NULL DEFAULT 1 CHECK(page_full IN (0,1)),
  pending TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pending)),
  migration_signature TEXT,
  quote TEXT,
  last_error TEXT
);
CREATE INDEX tenx_mint_reviews_due ON tenx_mint_reviews(state,updated_at,address);
CREATE TABLE tenx_mint_review_pages (
  address TEXT NOT NULL REFERENCES tenx_mint_reviews(address),
  page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 3),
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(address,page)
);
CREATE TABLE tenx_mint_review_reads (
  address TEXT NOT NULL REFERENCES tenx_mint_reviews(address),
  signature TEXT NOT NULL,
  slot INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  payload_hash TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(address,signature)
);
