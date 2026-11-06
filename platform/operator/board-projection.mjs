import {transaction} from '../storage/database.mjs';
import {workloadMetrics,moderatorQueue} from '../earn/operations.mjs';
import {historicalUsageSql,historicalSpendSql} from '../storage/atomic-operations.mjs';
import {pressureFromRows} from '../operations/portable-controls.mjs';

/** Local staffing/control projection, not wallet/campaign/evidence eligibility.
 * Keep the legacy reference helper unchanged; the guarded admission path has
 * no implicit staffing policy. Read all metrics and controls in one snapshot. */
export function readOperatorBoard(db,{epoch,nowMs,state='pending',cursor=null}){
 return transaction(db,()=>{
  const metrics=workloadMetrics(db,{epoch,nowMs});
  const policy=db.prepare('SELECT * FROM earn_workload_policies WHERE effective_epoch<=? AND recorded_ms<=? ORDER BY effective_epoch DESC,recorded_ms DESC LIMIT 1').get(epoch,nowMs);
  const scope=db.prepare("SELECT paused FROM ops_scope_log WHERE scope='earn-admission' AND at_ms<=? ORDER BY at_ms DESC LIMIT 1").get(nowMs);
  const archived=!!db.prepare('SELECT 1 FROM earn_recovered_boards LIMIT 1').get();
  const read=s=>db.prepare(s.sql).all(...s.values);
  const pressure=pressureFromRows(read(historicalUsageSql(nowMs)),read(historicalSpendSql(nowMs)),nowMs);
  const admitted=metrics.capacity.admitted,limit=policy?Math.min(policy.admission_limit,Math.floor(policy.staffed_minutes*60/policy.seconds_per_review)):0;
  const reason=archived?'read_only_archive':metrics.boardStatus==='final'?'board_closed':Math.floor(nowMs/86400000)!==epoch?'epoch-not-current':
   scope?.paused?'operator-pause':pressure.status==='pending'?pressure.reason:pressure.level==='limit'?'budget-limit':
   !policy?'staffing-required':admitted>=limit?'board_capacity':'available';
  return {metrics:{...metrics,capacity:{epoch,limit,admitted,remaining:Math.max(0,limit-admitted),accepting:reason==='available',policy:policy?.revision??null,reason}},
   queue:moderatorQueue(db,{epoch,state,cursor})};
 });
}
