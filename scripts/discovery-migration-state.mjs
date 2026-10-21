import { readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// A read-only fast path for a fully initialized local store. Any uncertainty or
// pending filename falls back to the existing Wrangler migration command.
export function localMigrationsCurrent(discoveryDir, persistDir) {
  let db;
  try {
    const expected = readdirSync(path.join(discoveryDir, "migrations")).filter(file => file.endsWith(".sql"));
    const directory = path.join(persistDir, "v3", "d1", "miniflare-D1DatabaseObject");
    const stores = readdirSync(directory).filter(file => /^[a-f0-9]{64}\.sqlite$/.test(file));
    if (expected.length === 0 || stores.length !== 1) return false;
    db = new DatabaseSync(path.join(directory, stores[0]), { readOnly: true });
    const applied = new Set(db.prepare("SELECT name FROM d1_migrations").all().map(row => row.name));
    return expected.every(name => applied.has(name));
  } catch { return false; }
  finally { db?.close(); }
}
