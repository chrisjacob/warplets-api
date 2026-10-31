import {
  one,
  rows,
  run,
  sha,
  requireThat,
  text,
  integer,
  Problem,
  type Database,
} from "./db";
import { canonical } from "../shared/canonical";
import { decode58 } from "../shared/base58";
import { dailyTimes } from "../shared/rules";
import {
  commandScope,
  ADMIN_ACTION_SCOPES,
  type AdminActor,
  type AdminQuery,
  type AdminCommand,
  type AdminCandidate,
  type AdminReply,
} from "../shared/adminContracts";
import { audit, outcome } from "./rounds";
import { changeControl } from "./controls";
import { enqueue } from "./operations";
import { readiness } from "./readiness";
import { readTrading } from "./trading";
import { cycleAttribute } from "./cycles";
import { refreshTrending } from "./gmgn";
import { commsCommand } from "./adminComms";
import { Exact, zero } from "../shared/exact";
export interface AdminOptions {
  environment: "local" | "production";
  gmgnKey?: string;
  gmgnFetch?: typeof fetch;
  publicOrigin?: string;
  simulation?: (
    action: string,
    payload: Record<string, unknown>,
    id: string,
  ) => Promise<unknown>;
}
function permission(actor: AdminActor, scope: string) {
  requireThat(
    actor &&
      typeof actor.id === "string" &&
      actor.id.length > 0 &&
      actor.id.length <= 100 &&
      Array.isArray(actor.scopes) &&
      (actor.scopes.includes(scope) || actor.scopes.includes("*")),
    403,
    "Admin capability required: " + scope,
  );
}
function day(value: unknown) {
  const key = text(value, "UTC date", 10);
  try{dailyTimes(key);}catch{throw new Problem(400,'Use a valid UTC calendar date');}
  return key;
}
function candidates(value: unknown): AdminCandidate[] {
  requireThat(
    Array.isArray(value) && value.length <= 3,
    400,
    "Choose at most three candidates",
  );
  const seen = new Set<string>();
  return value.map((row) => {
    requireThat(row && typeof row === "object", 400, "Candidate required");
    const c = row as Record<string, unknown>,
      mint = text(c.ogMint, "Solana mint", 64);
    try{decode58(mint,32);}catch{throw new Problem(400,'Use a valid Solana mint');}
    requireThat(!seen.has(mint), 400, "Duplicate candidate mint");
    seen.add(mint);
    requireThat(
      ["manual", "gmgn"].includes(String(c.origin)) &&
        typeof c.reviewed === "boolean",
      400,
      "Candidate origin and review required",
    );
    return {
      ogMint: mint,
      name: text(c.name, "candidate name", 80),
      symbol: text(c.symbol, "symbol", 20),
      origin: c.origin as "manual" | "gmgn",
      reviewed: c.reviewed,
      ...(typeof c.snapshotId === "string"
        ? { snapshotId: text(c.snapshotId, "snapshot ID", 100) }
        : {}),
    };
  });
}
export async function adminRead(
  db: Database,
  query: AdminQuery,
  actor: AdminActor,
  options: AdminOptions,
) {
  permission(actor, "meme:read");
  requireThat(
    ["overview", "performance", "comms", "health"].includes(query.section),
    400,
    "Unknown admin section",
  );
  const now = Date.now(),
    date = query.date
      ? day(query.date)
      : new Date(now).toISOString().slice(0, 10),
    version =
      (
        await one<{ version: number }>(
          db,
          "SELECT version FROM meme_admin_state WHERE id=1",
        )
      )?.version ?? 0;
  const common = {
    version,
    environment: options.environment,
    asOf: now,
    date,
    capabilities: Object.fromEntries(
      Object.entries(ADMIN_ACTION_SCOPES).map(([action, scope]) => [
        action,
        actor.scopes.includes(scope) || actor.scopes.includes("*"),
      ]),
    ),
    financialActions: { launching: false, funding: false, claims: false },
    registered: false,
    realDeliveryEnabled: false,
  };
  if (query.section === "health")
    return {
      ...common,
      health: await readiness(db, now),
      jobs: await rows(
        db,
        "SELECT id,kind,subject,state,attempts,due_at,retry_at,last_error FROM meme_jobs ORDER BY created_at DESC LIMIT 50",
      ),
      commands: await rows(
        db,
        "SELECT id,actor,action,state,created_at,completed_at FROM meme_admin_commands ORDER BY created_at DESC LIMIT 50",
      ),
      telemetry: {
        runtimeErrors: null,
        latencyP95: null,
        authFailures: null,
        source: "Runtime telemetry not connected",
      },
      gmgn: await one(
        db,
        "SELECT ceiling,used,next_at FROM meme_gmgn_allowance WHERE id=1",
      ),
    };
  if (query.section === "performance") {
    requireThat(
      !query.range ||
        ["day", "previous", "30d", "overall"].includes(query.range),
      400,
      "Unknown metrics range",
    );
    const daily = await rows<{ day: string; payload: string; as_of: number }>(
      db,
      "SELECT day,payload,as_of FROM meme_admin_daily ORDER BY day DESC LIMIT 365",
    );
    const meta = await one<{ payload: string; as_of: number }>(
      db,
      "SELECT payload,as_of FROM meme_admin_metrics_meta WHERE id=1",
    );
    return {
      ...common,
      range: query.range ?? "day",
      daily: daily.map((r) => ({
        ...JSON.parse(r.payload),
        day: r.day,
        asOf: r.as_of,
      })),
      overall: meta ? { ...JSON.parse(meta.payload), asOf: meta.as_of } : null,
      trading: await readTrading(db, "24h"),
      coverage: {
        metricsMaterialized: !!meta,
        visitorsInstrumented: false,
        protocolFeesAvailable: false,
      },
    };
  }
  if (query.section === "comms")
    return {
      ...common,
      editions: await rows(
        db,
        "SELECT id,symbol FROM meme_campaigns ORDER BY launched_at DESC LIMIT 40",
      ),
      controls: await one(
        db,
        "SELECT social_paused FROM meme_comms_controls WHERE id=1",
      ),
      notifications: await one(
        db,
        "SELECT paused FROM meme_notification_control WHERE id=1",
      ),
      drafts: await rows(
        db,
        "SELECT id,version,title,body,target_path,state,source_event,card_id,approved_by,updated_at,cast_hash FROM meme_social_drafts ORDER BY updated_at DESC LIMIT 50",
      ),
      rules: await rows(
        db,
        "SELECT * FROM meme_milestone_rules ORDER BY updated_at DESC LIMIT 50",
      ),
      milestones: await rows(
        db,
        "SELECT id,edition_id,threshold_usd,at FROM meme_milestone_crossings ORDER BY at DESC LIMIT 50",
      ),
      candidates: await rows(
        db,
        "SELECT * FROM meme_admin_notice_candidates ORDER BY priority DESC,created_at LIMIT 50",
      ),
      outbox: await one(
        db,
        "SELECT COUNT(*) total,COALESCE(SUM(state='sent'),0) sent,COALESCE(SUM(state='unknown'),0) unknown,COALESCE(SUM(state IN('queued','retry')),0) queued FROM meme_notification_outbox",
      ),
      baseOutbox: await one(
        db,
        "SELECT COUNT(*) total,COALESCE(SUM(state='sent'),0) sent,COALESCE(SUM(state='unknown'),0) unknown FROM meme_base_notification_outbox",
      ),
    };
  const round = await one<Record<string, unknown>>(
      db,
      "SELECT * FROM meme_rounds WHERE date(closes_at/1000,'unixepoch')=?",
      date,
    ),
    draft = await one<{
      version: number;
      candidates: string;
      status: string;
      round_id: string;
    }>(db, "SELECT * FROM meme_admin_drafts WHERE day=?", date);
  const shortlist = round
    ? await rows(
        db,
        "SELECT c.*,COUNT(v.fid) voters FROM meme_candidates c LEFT JOIN meme_votes v ON v.round_id=c.round_id AND v.candidate_id=c.id WHERE c.round_id=? GROUP BY c.id ORDER BY c.id",
        round.id,
      )
    : [];
  const snapshots = await rows<{
    window: string;
    id: string;
    as_of: number;
    payload: string;
  }>(
    db,
    "SELECT h.window,s.id,s.as_of,s.payload FROM meme_gmgn_heads h JOIN meme_gmgn_snapshots s ON s.id=h.snapshot_id",
  );
  const health = await readiness(db, now);
  return {
    ...common,
    round,
    candidates: shortlist,
    draft: draft
      ? { ...draft, candidates: JSON.parse(draft.candidates) }
      : null,
    timetable: dailyTimes(date),
    cycles: await rows(
      db,
      "SELECT id,start_day,commitment FROM meme_attribute_cycles ORDER BY start_day DESC LIMIT 20",
    ),
    gmgn: {
      configured: !!options.gmgnKey,
      allowance: await one(
        db,
        "SELECT ceiling,used,next_at FROM meme_gmgn_allowance WHERE id=1",
      ),
      snapshots: snapshots.map((s) => ({
        window: s.window,
        id: s.id,
        asOf: s.as_of,
        ...JSON.parse(s.payload),
      })),
    },
    launch: {
      enabled: false,
      simulated: !!options.simulation,
      blockers: health.unverifiedProductionGates,
      controls: health.controls,
      actualCustodyConfigured: false,
      adapterConfigured: false,
      minimumOgRawUnits: "1",
    },
    campaigns: await rows(
      db,
      "SELECT id,symbol,mint,launched_at,ends_at,mode FROM meme_campaigns ORDER BY launched_at DESC LIMIT 40",
    ),
    releases: await rows(
      db,
      "SELECT a.id,c.symbol,a.release_at,a.total,a.allocated,a.reserve,EXISTS(SELECT 1 FROM meme_financial_receipts f WHERE f.operation='fund' AND f.subject=a.id) funded FROM meme_allocations a JOIN meme_campaigns c ON c.id=a.campaign_id WHERE a.release_at>=? ORDER BY a.release_at LIMIT 100",
      now - 86400000,
    ),
  };
}
export async function refreshAdminMetrics(db: Database, now = Date.now()) {
  const daily = await rows<{
    day: string;
    rounds: number;
    skips: number;
    voters: number;
    voteChanges: number;
    returningVoters: number;
  }>(
    db,
    "SELECT date(r.closes_at/1000,'unixepoch') day,COUNT(DISTINCT r.id) rounds,COUNT(DISTINCT CASE WHEN r.state='skipped' THEN r.id END) skips,COUNT(DISTINCT v.fid) voters,COALESCE(SUM(v.updated_at>v.first_valid_at),0) voteChanges,COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM meme_votes old JOIN meme_rounds pr ON pr.id=old.round_id WHERE old.fid=v.fid AND pr.closes_at<r.opens_at) THEN v.fid END) returningVoters FROM meme_rounds r LEFT JOIN meme_votes v ON v.round_id=r.id WHERE r.opens_at<=? GROUP BY 1 ORDER BY 1 DESC LIMIT 31",
    now,
  );
  const tradeDays = new Map<
    string,
    {
      volume: Exact;
      fees: Exact;
      fids: Set<number>;
      buys: number;
      sells: number;
    }
  >();
  let sourceCount = 0,
    tradeVolume = zero(),
    tradeFees = zero();
  for (let offset = 0; offset < 1000; offset += 64) {
    const sources = await rows<{ payload: string }>(
      db,
      "SELECT s.payload FROM meme_trading_source_heads h JOIN meme_trading_sources s ON s.id=h.source_id ORDER BY h.fid LIMIT ? OFFSET ?",
      Math.min(64, 1000 - offset),
      offset,
    );
    sourceCount += sources.length;
    for (const source of sources) {
      const data = JSON.parse(source.payload) as {
        fid: number;
        events: { kind: string; at: number; usd?: string; feeUsd?: string }[];
      };
      for (const event of data.events) {
        if (!["buy", "sell"].includes(event.kind) || event.at > now) continue;
        const day = new Date(event.at).toISOString().slice(0, 10),
          row = tradeDays.get(day) ?? {
            volume: zero(),
            fees: zero(),
            fids: new Set<number>(),
            buys: 0,
            sells: 0,
          };
        const usd = Exact.decimal(event.usd ?? "0"),
          fees = Exact.decimal(event.feeUsd ?? "0");
        row.volume = row.volume.add(usd);
        row.fees = row.fees.add(fees);
        row.fids.add(data.fid);
        if (event.kind === "buy") row.buys++;
        else row.sells++;
        tradeDays.set(day, row);
        tradeVolume = tradeVolume.add(usd);
        tradeFees = tradeFees.add(fees);
      }
    }
    if (sources.length < 64) break;
  }
  const totalSources = (await one<{ n: number }>(
    db,
    "SELECT COUNT(*) n FROM meme_trading_source_heads",
  ))!.n;
  for (const entry of daily) {
    const launches = await one<{ n: number }>(
        db,
        "SELECT COUNT(*) n FROM meme_campaigns WHERE date(launched_at/1000,'unixepoch')=?",
        entry.day,
      ),
      trades = tradeDays.get(entry.day);
    await run(
      db,
      "INSERT INTO meme_admin_daily VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET payload=excluded.payload,as_of=excluded.as_of",
      entry.day,
      canonical({
        ...entry,
        launches: launches?.n ?? 0,
        cohortVolumeUsd: sourceCount
          ? (trades?.volume ?? zero()).decimal(8)
          : null,
        cohortTraders: sourceCount ? (trades?.fids.size ?? 0) : null,
      }),
      now,
    );
  }
  const totals = await one<{ uniqueVoters: number; votes: number }>(
      db,
      "SELECT COUNT(DISTINCT fid) uniqueVoters,COUNT(*) votes FROM meme_votes",
    ),
    campaigns = await one<{ launches: number; activeCampaigns: number }>(
      db,
      "SELECT COUNT(*) launches,COALESCE(SUM(ends_at>?),0) activeCampaigns FROM meme_campaigns",
      now,
    ),
    rewards = await rows<{
      id: string;
      symbol: string;
      decimals: number;
      total: string;
      allocated: string;
      reserve: string;
      release_at: number;
      funded: number;
    }>(
      db,
      "SELECT c.id,c.symbol,c.decimals,a.total,a.allocated,a.reserve,a.release_at,EXISTS(SELECT 1 FROM meme_financial_receipts f WHERE f.operation='fund' AND f.subject=a.id) funded FROM meme_allocations a JOIN meme_campaigns c ON c.id=a.campaign_id ORDER BY a.release_at DESC LIMIT 4000",
    );
  const rewardsByEdition = Object.values(
    rewards.reduce<
      Record<
        string,
        {
          id: string;
          symbol: string;
          decimals: number;
          allocated: string;
          reserve: string;
          claimed: string;
        }
      >
    >((out, r) => {
      const old = out[r.id] ?? {
        id: r.id,
        symbol: r.symbol,
        decimals: r.decimals,
        allocated: "0",
        reserve: "0",
        claimed: "0",
      };
      old.allocated = String(BigInt(old.allocated) + BigInt(r.allocated));
      old.reserve = String(BigInt(old.reserve) + BigInt(r.reserve));
      out[r.id] = old;
      return out;
    }, {}),
  );
  for (const edition of rewardsByEdition) {
    const claims = await rows<{ amount: string }>(
      db,
      "SELECT e.amount FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id JOIN meme_financial_receipts f ON f.operation='claim' AND f.subject=a.id||':'||e.fid WHERE a.campaign_id=? LIMIT 1001",
      edition.id,
    );
    edition.claimed = String(claims.reduce((n, c) => n + BigInt(c.amount), 0n));
  }
  const value = {
    ...totals,
    ...campaigns,
    rewardAllocations: rewards.length,
    fundedAllocations: rewards.filter((r) => r.funded).length,
    releasedAllocations: rewards.filter(
      (r) => r.funded && Number(r.release_at) + 1000 <= now,
    ).length,
    rewardsByEdition,
    cohortVolumeUsd: sourceCount ? tradeVolume.decimal(8) : null,
    cohortTradingFeesUsd: sourceCount ? tradeFees.decimal(8) : null,
    tradingSources: sourceCount,
    coverage: {
      allocationLimit: 4000,
      limited: rewards.length === 4000,
      tradingSourceLimit: 1000,
      tradingLimited: totalSources > 1000,
      fees: "protocol fees unavailable",
      visitors: "not instrumented",
    },
  };
  await run(
    db,
    "INSERT INTO meme_admin_metrics_meta VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,as_of=excluded.as_of",
    canonical(value),
    now,
  );
  return { days: daily.length, asOf: now };
}
export async function adminCommand(
  db: Database,
  command: AdminCommand,
  actor: AdminActor,
  options: AdminOptions,
) {
  const scope = commandScope(command?.action);
  requireThat(scope, 400, "Unknown admin command");
  permission(actor, scope);
  const id = text(command.id, "command ID", 100),
    reason = text(command.reason, "reason", 500),
    expected = integer(command.expectedVersion, "expected version", 0),
    p = command.payload;
  requireThat(
    p && typeof p === "object" && !Array.isArray(p),
    400,
    "Command payload required",
  );
  const fingerprint = await sha(canonical({ command, actor: actor.id })),
    old = await one<{
      request_hash: string;
      state: string;
      result: string | null;
    }>(db, "SELECT * FROM meme_admin_commands WHERE id=?", id);
  if (old) {
    requireThat(
      old.request_hash === fingerprint,
      409,
      "Command ID belongs to another intent",
    );
    if (old.state === "done")
      return { ...JSON.parse(old.result!), replayed: true };
    requireThat(
      old.state === "pending",
      409,
      "Failed command; review and create a new intent",
    );
  } else {
    requireThat(
      (
        await one<{ version: number }>(
          db,
          "SELECT version FROM meme_admin_state WHERE id=1",
        )
      )?.version === expected,
      409,
      "Admin state changed; refresh before acting",
    );
    await db.batch([
      db
        .prepare(
          "INSERT INTO meme_admin_commands(id,request_hash,actor,action,request,state,result,created_at,completed_at) SELECT ?,?,?,?,?,'pending',NULL,?,NULL WHERE EXISTS(SELECT 1 FROM meme_admin_state WHERE id=1 AND version=?) AND NOT EXISTS(SELECT 1 FROM meme_admin_commands WHERE state='pending')",
        )
        .bind(
          id,
          fingerprint,
          actor.id,
          command.action,
          canonical(command),
          Date.now(),
          expected,
        ),
      db
        .prepare(
          "UPDATE meme_admin_state SET version=version+1 WHERE id=1 AND version=? AND EXISTS(SELECT 1 FROM meme_admin_commands WHERE id=?)",
        )
        .bind(expected, id),
    ]);
    requireThat(
      await one(db, "SELECT id FROM meme_admin_commands WHERE id=?", id),
      409,
      "Concurrent admin update; reload",
    );
  }
  const accepted = await one<{ created_at: number;request_hash:string;state:string;result:string|null }>(
    db,
    "SELECT created_at,request_hash,state,result FROM meme_admin_commands WHERE id=?",
    id,
  );
  requireThat(accepted, 409, "Command reservation missing");
  requireThat(accepted.request_hash===fingerprint,409,'Command ID belongs to another intent');
  if(accepted.state==='done')return {...JSON.parse(accepted.result!),replayed:true};
  requireThat(accepted.state==='pending',409,'Command failed; review before creating another intent');
  const lease=crypto.randomUUID();
  requireThat(await one(db,"UPDATE meme_admin_commands SET lease_token=?,lease_until=? WHERE id=? AND state='pending' AND (lease_until IS NULL OR lease_until<=?) RETURNING id",lease,Date.now()+120000,id,Date.now()),409,'Command is in progress; wait and retry the same action');
  const acceptedAt = accepted.created_at;
  let result: unknown;
  try {
    if (command.action === "draft.save") {
      const date = day(p.day),
        list = candidates(p.candidates),
        existing = await one<{
          status: string;
          version: number;
          last_command_id: string;
        }>(
          db,
          "SELECT status,version,last_command_id FROM meme_admin_drafts WHERE day=?",
          date,
        );
      requireThat(
        existing?.status !== "published",
        409,
        "Published shortlist is immutable",
      );
      requireThat(
        !(await one(
          db,
          "SELECT id FROM meme_rounds WHERE date(closes_at/1000,'unixepoch')=?",
          date,
        )),
        409,
        "Round already exists",
      );
      if (existing?.last_command_id !== id)
        await run(
          db,
          "INSERT INTO meme_admin_drafts VALUES(?,1,?,'draft',NULL,NULL,?,?,?) ON CONFLICT(day) DO UPDATE SET version=version+1,candidates=excluded.candidates,updated_at=excluded.updated_at,actor=excluded.actor,last_command_id=excluded.last_command_id WHERE status='draft'",
          date,
          canonical(list),
          Date.now(),
          actor.id,
          id,
        );
      result = { day: date, saved: list.length };
    } else if (command.action === "round.publish") {
      const date = day(p.day),
        draft = await one<{
          candidates: string;
          status: string;
          round_id: string;
          publish_key: string;
        }>(db, "SELECT * FROM meme_admin_drafts WHERE day=?", date);
      requireThat(draft, 404, "Save a shortlist first");
      const list = candidates(JSON.parse(draft.candidates));
      requireThat(
        list.length === 3 && list.every((c) => c.reviewed),
        409,
        "Exactly three manually reviewed candidates required",
      );
      const schedule = dailyTimes(date),
        roundId = "daily-" + date,
        body = {
          id: roundId,
          day: date,
          cycleId: text(p.cycleId, "committed cycle ID", 100),
          candidates: list.map((c, index) => ({
            id: "candidate-" + index,
            name: c.name,
            symbol: c.symbol,
            ogMint: c.ogMint,
            evidence: canonical({
              reviewedBy: actor.id,
              reason,
              origin: c.origin,
              ...(c.snapshotId ? { snapshotId: c.snapshotId } : {}),
            }),
          })),
        };
      await cycleAttribute(db, body.cycleId, schedule.closesAt);
      if (draft.status === "published") {
        requireThat(
          draft.publish_key === id,
          409,
          "Shortlist is already published",
        );
        result = { roundId: draft.round_id, published: true };
      } else {
        requireThat(
          schedule.freezeBy > Date.now() ||
            (await one(
              db,
              "SELECT id FROM meme_jobs WHERE id=?",
              "prepare:" + roundId,
            )),
          409,
          "Freeze deadline passed; prepare a later round",
        );
        await enqueue(
          db,
          "prepare:" + roundId,
          "prepare",
          roundId,
          body,
          acceptedAt,
          acceptedAt,
        );
        await run(
          db,
          "UPDATE meme_admin_drafts SET status='published',round_id=?,publish_key=?,version=version+1,updated_at=? WHERE day=? AND status='draft'",
          roundId,
          id,
          Date.now(),
          date,
        );
        result = { roundId, queued: true };
      }
    } else if (command.action === "round.outcome") {
      const roundId = text(p.roundId, "round ID", 100),
        body = {
          skip: p.skip === true,
          ...(p.skip === true
            ? {}
            : { candidateId: text(p.candidateId, "candidate", 100) }),
          reason,
        };
      const prior = await one<{ payload_hash: string }>(
        db,
        "SELECT payload_hash FROM meme_operations WHERE key=?",
        "outcome:" + roundId,
      );
      if (prior) {
        requireThat(
          prior.payload_hash === (await sha(canonical(body))),
          409,
          "Round outcome already differs",
        );
        result = { roundId, replayed: true };
      } else result = await outcome(db, roundId, body, actor.id);
    } else if (command.action === "control.set")
      result = await changeControl(
        db,
        {
          key: id,
          name: p.name,
          paused: p.paused,
          expectedVersion: p.controlVersion,
          reason,
        },
        actor.id,
      );
    else if (command.action === "job.retry") {
      const jobId = text(p.id, "job ID", 200);
      await run(
        db,
        "UPDATE meme_jobs SET state='queued',retry_at=0,last_error=NULL WHERE id=? AND state='blocked'",
        jobId,
      );
      result = { jobId };
    } else if (command.action === "metrics.refresh")
      result = await refreshAdminMetrics(db, acceptedAt);
    else if (command.action === "gmgn.refresh")
      result =
        options.simulation && options.environment === "local"
          ? await options.simulation(command.action, p, id)
          : await refreshTrending(
              db,
              p.window,
              options.gmgnKey,
              id,
              options.gmgnFetch,
            );
    else if (
      command.action.startsWith("social.") ||
      command.action.startsWith("comms.") ||
      command.action === "milestone.save"
    )
      result = await commsCommand(
        db,
        command.action,
        p,
        actor.id,
        id,
        acceptedAt,
        options.publicOrigin,
      );
    else if (command.action.startsWith("launch.")) {
      requireThat(
        options.environment === "local" && options.simulation,
        409,
        "Financial adapters and actual custody are not configured; no signing or submission is available",
      );
      result = await options.simulation(command.action, p, id);
    } else throw new Problem(409, "This adapter is not configured");
    const completed=await run(
      db,
      "UPDATE meme_admin_commands SET state='done',result=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
      canonical({ result, version: expected + 1 }),
      Date.now(),
      id,
      lease,
    );
    requireThat(completed.meta.changes===1,503,'Execution lease changed; reconcile the same command');
    await audit(db, actor.id, "admin:" + command.action, id, { reason });
    return { result, version: expected + 1 };
  } catch (error) {
    await run(
      db,
      "UPDATE meme_admin_commands SET state=?,result=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
      error instanceof Problem ? "failed" : "pending",
      canonical({
        error:
          error instanceof Problem
            ? error.message
            : "Outcome unresolved; retry the same command",
      }),
      Date.now(),
      id,
      lease,
    );
    throw error;
  }
}
export async function adminReply(
  task: () => Promise<unknown>,
): Promise<AdminReply> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof Problem ? error.status : 503,
      error:
        error instanceof Problem
          ? error.message
          : "Launchpad admin request could not complete",
    };
  }
}
