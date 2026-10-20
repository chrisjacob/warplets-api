-- Immutable local what-if records, separate from active policies and elections.
CREATE TABLE tenx_policy_previews (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
  inputs TEXT NOT NULL CHECK(json_valid(inputs)),
  result TEXT NOT NULL CHECK(json_valid(result)),
  metadata TEXT NOT NULL CHECK(json_valid(metadata))
);
CREATE INDEX tenx_policy_previews_created ON tenx_policy_previews(created_at);
