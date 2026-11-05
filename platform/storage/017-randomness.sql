CREATE TABLE fair_inventories(
 inventory_id TEXT PRIMARY KEY REFERENCES collect_inventories(id), policy_hash TEXT NOT NULL,
 traits TEXT NOT NULL, registered_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE fair_reserved_assets(
 inventory_id TEXT NOT NULL REFERENCES fair_inventories, slot_index INTEGER NOT NULL CHECK(slot_index BETWEEN 0 AND 999),
 asset_id TEXT UNIQUE NOT NULL, PRIMARY KEY(inventory_id,slot_index)
) WITHOUT ROWID;
CREATE TABLE fair_requests(
 operation_id TEXT PRIMARY KEY REFERENCES collect_operations, target_round INTEGER NOT NULL, context_digest TEXT NOT NULL
) STRICT;
CREATE TABLE fair_results(
 operation_id TEXT PRIMARY KEY REFERENCES fair_requests, proof_id TEXT UNIQUE NOT NULL, signed_round TEXT NOT NULL,
 fixture TEXT NOT NULL, settled_ms INTEGER NOT NULL
) STRICT;
