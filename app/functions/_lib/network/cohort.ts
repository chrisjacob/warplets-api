// One public/import cohort. Keep acceptance evidence for audit and later re-entry;
// client opt-outs, moderation restrictions and unobserved statuses are excluded.
export const NETWORK_CURRENT_COHORT = `SELECT p.fid FROM network_profiles p
  WHERE p.opt_in_status='opted_in' AND (EXISTS(SELECT 1 FROM network_events e WHERE e.fid=p.fid)
  OR EXISTS(SELECT 1 FROM network_confirmed c WHERE c.fid=p.fid))`;
