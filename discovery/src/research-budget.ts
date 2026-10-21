// Both atomic INSERT guards bind the UTC day at ?6. Pending attempts retain the
// worst-case charge; this is one aggregate budget, independent of score model.
export const sharedResearchRecords = "((SELECT count(*) FROM tenx_score_cohorts WHERE day=?6)+(SELECT count(*) FROM tenx_source_reservations WHERE day=?6))";
export const sharedResearchBytes = "(COALESCE((SELECT sum(bytes) FROM tenx_score_cohorts WHERE day=?6),0)+COALESCE((SELECT sum(bytes) FROM tenx_source_reservations WHERE day=?6),0))";
export async function sharedResearchUsage(db: D1Database, day: string) {
  return db.prepare(`SELECT (SELECT count(*) FROM tenx_score_cohorts WHERE day=?1)+(SELECT count(*) FROM tenx_source_reservations WHERE day=?1) AS records,
    COALESCE((SELECT sum(bytes) FROM tenx_score_cohorts WHERE day=?1),0)+COALESCE((SELECT sum(bytes) FROM tenx_source_reservations WHERE day=?1),0) AS bytes`).bind(day).first<{records:number;bytes:number}>();
}
