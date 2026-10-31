import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
/** Real SQLite, transactional batches; only the D1 transport is substituted. */
export function testDb(options: { file?: string } = {}) {
  const raw = new DatabaseSync(options.file ?? ":memory:");
  if (options.file)
    raw.exec(
      "PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA busy_timeout=10000",
    );
  const queries: string[] = [];
  let interrupt = false;
  let batchTail = Promise.resolve();
  raw.exec("PRAGMA foreign_keys=ON");
  raw.exec(
    "CREATE TABLE IF NOT EXISTS qa_applied_migrations(name TEXT PRIMARY KEY)",
  );
  for (const file of readdirSync(
    resolve(import.meta.dirname, "../../migrations"),
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    if (
      !raw.prepare("SELECT 1 FROM qa_applied_migrations WHERE name=?").get(file)
    ) {
      raw.exec("BEGIN");
      try {
        raw.exec(
          readFileSync(
            resolve(import.meta.dirname, "../../migrations", file),
            "utf8",
          ),
        );
        raw.prepare("INSERT INTO qa_applied_migrations VALUES(?)").run(file);
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    }
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
    prepare: (sql: string) => {
      if (!options.file || queries.length < 10000) queries.push(sql);
      return new Statement(sql);
    },
    batch: (statements: Statement[]) => {
      const task = batchTail.then(async () => {
        raw.exec("BEGIN IMMEDIATE");
        try {
          const out = [];
          for (const s of statements) {
            if (/^\s*(SELECT|PRAGMA)/i.test(s.sql)) out.push(await s.all());
            else out.push(await s.run());
          }
          raw.exec("COMMIT");
          if (interrupt) {
            interrupt = false;
            throw new Error("Simulated lost response after commit");
          }
          return out;
        } catch (e) {
          if (raw.isTransaction) raw.exec("ROLLBACK");
          throw e;
        }
      });
      batchTail = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
  // This test adapter implements the subset used by the Worker; real runtime uses its D1 binding.
  const db = transport as unknown as D1Database;
  return {
    db,
    raw,
    queries,
    close: () => raw.close(),
    interruptNextBatch: () => {
      interrupt = true;
    },
  };
}
