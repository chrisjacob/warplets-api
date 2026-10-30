import {
  json,
  one,
  rows,
  payload,
  requireThat,
  random,
  run,
  type Database,
} from "./db";
import { operator } from "./rounds";
import { controls, changeControl } from "./controls";

export async function beginTick(db: Database, now: number) {
  const token = random();
  const result = await run(
    db,
    "INSERT INTO meme_operations_heartbeat(id,run_token,started_at,running) VALUES(1,?,?,1) ON CONFLICT(id) DO UPDATE SET run_token=excluded.run_token,started_at=excluded.started_at,running=1 WHERE excluded.started_at>=meme_operations_heartbeat.started_at+10000",
    token,
    now,
  );
  return result.meta.changes === 1 ? token : null;
}
export async function finishTick(
  db: Database,
  token: string | null,
  outcome: string,
  now: number,
) {
  if (token === null) return;
  await run(
    db,
    "UPDATE meme_operations_heartbeat SET completed_at=?,running=0,outcome=? WHERE id=1 AND run_token=? AND running=1",
    now,
    outcome,
    token,
  );
}
type Heartbeat = {
  started_at: number;
  completed_at: number | null;
  running: number;
  outcome: string | null;
};
type CurrentRound = {
  id: string;
  state: string;
  opens_at: number;
  closes_at: number;
  ownershipState: string | null;
  ownershipMode: string | null;
  ownershipSourceAt: number | null;
  scoreAsOf: number | null;
  settlementState: string | null;
};
/** Fixed-size, SELECT-only diagnostics. No job payloads, errors, cursors,
 * credentials, transaction plans, wallet addresses or approval text are read. */
export async function readiness(db: Database, now = Date.now()) {
  const flags = await controls(db);
  const heartbeat = await one<Heartbeat>(
    db,
    "SELECT started_at,completed_at,running,outcome FROM meme_operations_heartbeat WHERE id=1",
  );
  const jobs = (await one<{
    total: number;
    due: number;
    queued: number;
    running: number;
    blocked: number;
    overdue: number;
    expiredLeases: number;
    activeLeases: number;
  }>(
    db,
    "SELECT COUNT(*) total,COALESCE(SUM(state='queued' AND due_at<=? AND retry_at<=?),0) due,COALESCE(SUM(state='queued'),0) queued,COALESCE(SUM(state='running'),0) running,COALESCE(SUM(state='blocked'),0) blocked,COALESCE(SUM(state='queued' AND due_at<? AND retry_at<=?),0) overdue,COALESCE(SUM(state='running' AND lease_until<=?),0) expiredLeases,COALESCE(SUM(state='running' AND lease_until>?),0) activeLeases FROM meme_jobs",
    now,
    now,
    now - 120000,
    now,
    now,
    now,
  ))!;
  const budgets = await rows<{
    provider: string;
    ceiling: number;
    used: number;
  }>(
    db,
    "SELECT provider,ceiling,used FROM meme_source_budgets ORDER BY provider",
  );
  const sources = (await one<{
    collecting: number;
    ready: number;
    blocked: number;
  }>(
    db,
    "SELECT COALESCE(SUM(state='collecting'),0) collecting,COALESCE(SUM(state='ready'),0) ready,COALESCE(SUM(state='blocked'),0) blocked FROM meme_source_runs",
  ))!;
  const corrections = (await one<{ pending: number }>(
    db,
    "SELECT COUNT(*) pending FROM meme_source_corrections WHERE state='proposed'",
  ))!;
  const transactions = (await one<{
    total: number;
    unknown: number;
    staleSubmitted: number;
    unfinalized: number;
  }>(
    db,
    "SELECT COUNT(*) total,COALESCE(SUM(state='unknown'),0) unknown,COALESCE(SUM(state='submitted' AND updated_at<?),0) staleSubmitted,COALESCE(SUM(state='confirmed' AND chain_status NOT IN('finalized','legacy-local-confirmed')),0) unfinalized FROM meme_transaction_intents",
    now - 120000,
  ))!;
  const current = await one<CurrentRound>(
    db,
    "SELECT r.id,r.state,r.opens_at,r.closes_at,o.state ownershipState,o.mode ownershipMode,o.source_at ownershipSourceAt,s.as_of scoreAsOf,st.state settlementState FROM meme_rounds r LEFT JOIN meme_ownership_snapshots o ON o.id=r.snapshot_id LEFT JOIN meme_score_heads h ON h.round_id=r.id LEFT JOIN meme_score_snapshots s ON s.id=h.snapshot_id AND s.state='ready' LEFT JOIN meme_settlements st ON st.round_id=r.id ORDER BY CASE WHEN r.opens_at<=? AND r.closes_at>? THEN 0 WHEN r.opens_at>? THEN 1 ELSE 2 END,CASE WHEN r.opens_at>? THEN r.opens_at ELSE -r.closes_at END LIMIT 1",
    now,
    now,
    now,
    now,
  );
  const paused = (name: string) =>
      flags.some((c) => c.name === name && c.paused),
    alerts: { code: string; severity: "info" | "warning" | "critical" }[] = [];
  const add = (code: string, severity: "info" | "warning" | "critical") =>
    alerts.push({ code, severity });
  for (const flag of flags) if (flag.paused) add(`${flag.name}-paused`, "info");
  const active = !!(
    jobs.due ||
    jobs.running ||
    (current &&
      current.opens_at <= now &&
      current.settlementState !== "finalized" &&
      current.state !== "skipped")
  );
  if (
    !paused("operations") &&
    active &&
    (!heartbeat ||
      Math.max(heartbeat.started_at, heartbeat.completed_at ?? 0) <
        now - 120000)
  )
    add(heartbeat ? "runner-stale" : "runner-not-observed", "warning");
  if (jobs.blocked) add("jobs-blocked", "warning");
  if (heartbeat?.outcome === "error" && !paused("operations"))
    add("runner-error", "warning");
  if (jobs.expiredLeases) add("job-leases-expired", "warning");
  if (jobs.overdue && !paused("operations")) add("jobs-overdue", "warning");
  if (sources.blocked) add("source-runs-blocked", "warning");
  if (corrections.pending) add("evidence-correction-pending", "warning");
  if (
    transactions.unknown ||
    transactions.staleSubmitted ||
    transactions.unfinalized
  )
    add("transactions-need-reconciliation", "critical");
  if (
    budgets.length !== 2 ||
    !["helius", "pyth"].every((p) => budgets.some((b) => b.provider === p))
  )
    add("source-budget-configuration", "critical");
  if (budgets.some((b) => b.used > b.ceiling))
    add("source-allowance-overdrawn", "critical");
  if (
    sources.collecting &&
    !paused("collection") &&
    budgets.some((b) => b.provider === "helius" && b.used >= b.ceiling)
  )
    add("source-allowance-unavailable", "warning");
  if (current && current.opens_at <= now && current.closes_at > now) {
    if (current.ownershipState !== "ready")
      add("ownership-freeze-missing", "critical");
    else if (
      current.state === "open" &&
      (current.scoreAsOf == null ||
        current.scoreAsOf < now - 300000 ||
        current.scoreAsOf > now)
    )
      add("scores-stale-or-missing", "warning");
  }
  const status = alerts.some((a) => a.severity !== "info")
    ? "attention"
    : flags.some((c) => c.paused)
      ? "paused"
      : active
        ? "ok"
        : "idle";
  return {
    version: 1,
    scope: "local-preview",
    asOf: now,
    status,
    productionReady: false,
    financialActions: { launching: false, funding: false, claims: false },
    controls: flags,
    operations: {
      heartbeat: heartbeat
        ? {
            startedAt: heartbeat.started_at,
            completedAt: heartbeat.completed_at,
            running: !!heartbeat.running,
            outcome: heartbeat.running ? "running" : heartbeat.outcome,
          }
        : null,
      draining: paused("operations") && jobs.activeLeases > 0,
      jobs,
    },
    sources: {
      ...sources,
      correctionsPending: corrections.pending,
      budgets: budgets.map((b) => ({
        ...b,
        remaining: Math.max(0, b.ceiling - b.used),
      })),
    },
    transactions,
    round: current,
    alerts,
    unverifiedProductionGates: [
      "real-wallet-device-qa",
      "finalized-ownership-and-complete-history-prices",
      "approved-economics-and-actual-custody",
      "mainnet-execution-and-controlled-cycle",
      "production-authorization",
    ],
    localThresholds: {
      heartbeatSampleMs: 10000,
      runnerStaleMs: 120000,
      jobOverdueMs: 120000,
      submittedStaleMs: 120000,
      scoresStaleMs: 300000,
    },
  };
}
export async function readinessRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (
    ![
      "/api/meme/operator/operations/health",
      "/api/meme/operator/operations/controls",
    ].includes(path)
  )
    return null;
  requireThat(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname),
    404,
    "Local operator only",
  );
  const actor = await operator(db, request);
  if (request.method === "GET")
    return json(
      path.endsWith("health")
        ? await readiness(db)
        : {
            controls: await controls(db),
            financialActions: {
              launching: false,
              funding: false,
              claims: false,
            },
          },
    );
  requireThat(
    path.endsWith("controls") && request.method === "POST",
    405,
    "Method not allowed",
  );
  return json(
    await changeControl(
      db,
      await payload(request, [
        "key",
        "name",
        "paused",
        "expectedVersion",
        "reason",
      ]),
      actor,
    ),
  );
}
