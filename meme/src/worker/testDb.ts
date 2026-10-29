import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
/** Real SQLite, transactional batches; only the D1 transport is substituted. */
export function testDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(
    resolve(import.meta.dirname, "../../migrations"),
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    raw.exec(
      readFileSync(
        resolve(import.meta.dirname, "../../migrations", file),
        "utf8",
      ),
    );
  class Statement {
    values: unknown[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    }
    async first<T>(column?: string) {
      const row = raw
        .prepare(this.sql)
        .get(...(this.values as (string | number | null)[]));
      return (column ? row?.[column] : (row ?? null)) as T | null;
    }
    async all<T>() {
      return {
        results: raw
          .prepare(this.sql)
          .all(...(this.values as (string | number | null)[])) as T[],
        success: true,
        meta: {},
      };
    }
    async run() {
      const result = raw
        .prepare(this.sql)
        .run(...(this.values as (string | number | null)[]));
      return {
        success: true,
        results: [],
        meta: { changes: Number(result.changes) },
      };
    }
  }
  const transport = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const out = [];
        for (const s of statements) {
          if (/^\s*(SELECT|PRAGMA)/i.test(s.sql)) out.push(await s.all());
          else out.push(await s.run());
        }
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
  // This test adapter implements the subset used by the Worker; real runtime uses its D1 binding.
  const db = transport as unknown as D1Database;
  return { db, raw, close: () => raw.close() };
}
