// Counts observed statements and rows crossing the SQLite/JS boundary. Returned
// rows are not SQLite page visits and must not be used as D1 billable rows read.
export function instrumentDatabase(db) {
  const metrics={statements:0,rowsReturned:0,rowsChanged:0};
  const counted={
    get isTransaction(){return db.isTransaction;},
    exec(sql){metrics.statements++;return db.exec(sql);},
    prepare(sql) {
      const s=db.prepare(sql);
      return {
        get(...args) {metrics.statements++;const row=s.get(...args);if(row)metrics.rowsReturned++;return row;},
        all(...args) {metrics.statements++;const rows=s.all(...args);metrics.rowsReturned+=rows.length;return rows;},
        run(...args) {metrics.statements++;const result=s.run(...args);metrics.rowsChanged+=Number(result.changes);return result;},
        *iterate(...args) {metrics.statements++;for(const row of s.iterate(...args)){metrics.rowsReturned++;yield row;}},
      };
    },
  };
  return {db:counted,metrics};
}
export function percentiles(values) {
  if (!values.length) return {p50:null,p95:null,p99:null};
  const sorted=[...values].sort((a,b)=>a-b);
  const at=p=>Number(sorted[Math.ceil(sorted.length*p)-1].toFixed(3));
  return {p50:at(0.5),p95:at(0.95),p99:at(0.99)};
}
export function logicalBudget(contributors,accepted) {
  // Five logical source records at admission and closing. At one token's common
  // cutoff, four market records can be shared plus one farm read per position.
  const unshared=accepted*10, shared=accepted*6+(accepted?4:0);
  return {
    assumedMinutesPerReview:3,acceptedReviewHours:accepted*3/60,
    uncappedOnePostHours:contributors*3/60,uncappedTenPostsHours:contributors*10*3/60,
    independentSourceReads:unshared,sourceReadsWithSharedClose:shared,
    rpcAttemptBudgetIfOneCallPerReadAndOneRetry:shared*2,
    measuredRpcCalls:0,measuredTransfers:0,providerUnitPriceUsd:null,
  };
}
