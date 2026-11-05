import { transaction } from '../database.mjs';
import { measureBatch } from '../atomic-driver.mjs';
export function createNodeAtomicDriver(db) {
  return Object.freeze({
    async batch(statements) {
      measureBatch(statements);
      // Deliberately synchronous from BEGIN through COMMIT; never await here.
      return transaction(db,()=>statements.map(({sql,values})=>{
        const statement=db.prepare(sql);
        if(/^\s*(?:SELECT|WITH)\b/i.test(sql))return {rows:statement.all(...values).map(row=>({...row})),changes:0};
        return {rows:[],changes:Number(statement.run(...values).changes)};
      }));
    },
    getBookmark(){return null;},
  });
}
