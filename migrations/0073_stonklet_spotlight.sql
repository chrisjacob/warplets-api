CREATE TABLE IF NOT EXISTS stonklet_spotlight_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off', 'shadow', 'live')),
  trial_started_at TEXT NOT NULL,
  current_thesis_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stonklet_spotlight_runs (
  hour TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  evaluated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stonklet_spotlight_theses (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  thesis_json TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawal_reason TEXT
);
CREATE INDEX IF NOT EXISTS stonklet_spotlight_date ON stonklet_spotlight_theses(selected_at DESC);
CREATE TABLE IF NOT EXISTS stonklet_spotlight_research (
  pair_id TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  selected_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stonklet_spotlight_ai_budget (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);
