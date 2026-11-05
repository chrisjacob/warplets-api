import { measureBatch } from '../atomic-driver.mjs';
export type Statement=Readonly<{sql:string;values:readonly (string|number|null)[]}>;
export function createD1AtomicDriver(db:D1Database,bookmark?:string) {
  if(bookmark!==undefined&&(!/^[A-Za-z0-9._:=+/-]{1,512}$/.test(bookmark)))throw new TypeError('Invalid read bookmark.');
  // Commands always start primary-current. A caller bookmark is continuity
  // metadata for read adapters only; it cannot relax current authorization.
  const session=db.withSession('first-primary');
  return Object.freeze({
    async batch(statements:readonly Statement[]) {
      measureBatch(statements);
      const results=await session.batch<Record<string,string|number|null>>(statements.map(s=>session.prepare(s.sql).bind(...s.values)));
      return results.map(r=>({rows:r.results,changes:r.meta.changes}));
    },
    getBookmark(){return session.getBookmark();},
  });
}
