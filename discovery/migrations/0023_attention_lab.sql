CREATE TABLE tenx_attention_labs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  inputs TEXT NOT NULL,
  result TEXT NOT NULL,
  metadata TEXT NOT NULL
);
CREATE INDEX tenx_attention_labs_created ON tenx_attention_labs(created_at DESC, id);
