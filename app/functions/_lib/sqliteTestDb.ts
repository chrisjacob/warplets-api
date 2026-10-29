import { DatabaseSync } from 'node:sqlite';
export function sqliteD1(sqlite: DatabaseSync) {
  function prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        if (args.length > 100) throw new Error("D1 binding limit exceeded");
        values = args;
        return statement;
      },
      async first(column?: string) {
        const row = sqlite
          .prepare(sql)
          .get(...(values as (string | number | null)[]));
        return row ? (column ? row[column] : row) : null;
      },
      async all() {
        return {
          success: true,
          results: sqlite
            .prepare(sql)
            .all(...(values as (string | number | null)[])),
          meta: {},
        };
      },
      async run() {
        const prepared = sqlite.prepare(sql);
        // D1 batch() returns rows for SELECT statements as well as write results.
        if (prepared.columns().length) return { success: true, results: prepared.all(...(values as (string | number | null)[])), meta: {} };
        const result = sqlite
          .prepare(sql)
          .run(...(values as (string | number | null)[]));
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        };
      },
    };
    return statement;
  }
  return {
    prepare,
    async batch(statements: Array<ReturnType<typeof prepare>>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
