import { transaction } from '../database.mjs';
import { measureBatch } from '../atomic-driver.mjs';
export function createNodeAtomicDriver(db,{transactionGuard}={}) {
  if(transactionGuard!==undefined&&(typeof transactionGuard!=='function'||transactionGuard.constructor?.name==='AsyncFunction'))
    throw new TypeError('Transaction guard must be synchronous.');
  const guard=()=>{
    if(transactionGuard&&transactionGuard()!==undefined)throw new TypeError('Transaction guard must return undefined.');
  };
  return Object.freeze({
    async batch(statements) {
      measureBatch(statements);
      // A guarded savepoint could be committed by its outer owner after expiry.
      if(transactionGuard&&db.isTransaction)throw new TypeError('Guarded batches require their own transaction.');
      // Deliberately synchronous from BEGIN through COMMIT; never await here.
      return transaction(db,()=>{
       guard();
       const results=statements.map(({sql,values})=>{
        const statement=db.prepare(sql);
        if(/^\s*(?:SELECT|WITH)\b/i.test(sql))return {rows:statement.all(...values).map(row=>({...row})),changes:0};
        return {rows:[],changes:Number(statement.run(...values).changes)};
       });
       guard();
       return results;
      });
    },
    getBookmark(){return null;},
  });
}
