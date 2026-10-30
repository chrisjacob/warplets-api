import { one, rows, run, requireThat, type Database } from "./db";
import { canonical } from "../shared/canonical";
import { sha, json, payload, text, integer } from "./db";
import { round, operator, type StoredRound } from "./rounds";
import { scoreRound } from "./scoring";
import { holdingForRound, campaigns } from "./holding";
import {
  allocate,
  releaseAt,
  releasesFor,
  type Recipient,
} from "../shared/settlement";
import { RULES_VERSION, DAY_MS } from "../shared/rules";
import { decimal } from "../shared/scoring";
import { requireDependableSources } from "./sources";

interface Job {
  round_id: string;
  cutoff: number;
  input_hash: string;
  result_hash: string;
  context: string;
  voter_count: number;
  allocation_count: number;
  entitlement_count: number;
  state: "freezing" | "allocating" | "finalized";
  mode: "observed" | "simulated";
  created_at: number;
  finalized_at: number | null;
}
interface FrozenInput {
  fid: number;
  rank: number;
  firstValidAt: number;
  candidateId: string;
  rewardWallet: string;
  pointUnits: string;
  boost: Record<string, string>;
  wallets: string[];
  holding: unknown;
}
interface Plan {
  id: string;
  campaignId: string;
  releaseIndex: number;
  releaseAt: number;
  total: string;
  allocated: string;
  reserve: string;
  recipients: (Recipient & { amount: string })[];
}

async function prepare(db: Database, r: StoredRound) {
  requireThat(
    r.closes_at <= Date.now() &&
      ["closed", "selected", "skipped"].includes(r.state),
    409,
    "Close voting before settlement",
  );
  requireThat(
    r.rules_version === RULES_VERSION,
    409,
    "Unsupported settlement rules",
  );
  const snapshot = await one<{
    id: string;
    mode: "observed" | "simulated";
    state: string;
  }>(
    db,
    "SELECT id,mode,state FROM meme_ownership_snapshots WHERE id=?",
    r.snapshot_id,
  );
  requireThat(
    snapshot?.state === "ready",
    409,
    "A completed ownership freeze is required",
  );
  if (snapshot.mode === "observed")
    requireThat(
      r.cycle_id,
      409,
      "Observed rounds require a committed attribute cycle",
    );
  const ledger = await holdingForRound(db, r.id, r.closes_at);
  requireThat(
    ledger.complete,
    409,
    "Holding evidence is pending at round close",
  );
  const allCampaigns = await campaigns(db);
  const relevant = allCampaigns.filter(
    (c) => c.launchedAt < r.closes_at && c.endsAt >= r.closes_at,
  );
  if (snapshot.mode === "observed") {
    requireThat(
      relevant.every((c) => c.mode === "observed"),
      409,
      "Observed settlement cannot use simulated campaigns",
    );
    for (const cp of ledger.checkpoints.values())
      requireThat(
        cp.every((c) => c.mode === "observed"),
        409,
        "Observed settlement cannot use simulated ledger evidence",
      );
    const walletScope = new Set(
      [...ledger.walletScopes.values()].flatMap((scope) => [...scope]),
    );
    for (const campaign of relevant)
      await requireDependableSources(
        db,
        campaign.id,
        campaign.mint,
        campaign.launchedAt,
        r.closes_at,
        walletScope,
        true,
      );
  }
  const scored = await scoreRound(db, r, null, ledger.units, ledger);
  const coverageProofs = new Map<
    object,
    Promise<{
      throughAt: number;
      hash: string;
      mode: string;
      scopeHash: string;
    }>
  >();
  for (const checkpoints of ledger.checkpoints.values())
    for (const cp of checkpoints)
      coverageProofs.set(
        cp,
        sha(canonical(cp.scope)).then((scopeHash) => ({
          throughAt: cp.throughAt,
          hash: cp.hash,
          mode: cp.mode,
          scopeHash,
        })),
      );
  const inputs: FrozenInput[] = await Promise.all(
    scored.ranked.map(async (v, i) => {
      const wallets = [...(ledger.walletScopes.get(v.fid) ?? [])].sort(),
        details = ledger.details.get(v.fid);
      const evidence = await Promise.all(
        relevant.map(async (c) => {
          const cp = (ledger.checkpoints.get(c.id) ?? []).find((cp) =>
            wallets.every((w) => cp.scopeSet.has(w)),
          );
          return {
            campaignId: c.id,
            coverage: cp ? await coverageProofs.get(cp)! : null,
            eventsHash: await sha(
              canonical(ledger.scopeEvents.get(v.fid)?.get(c.id) ?? []),
            ),
          };
        }),
      );
      return {
        fid: v.fid,
        rank: i + 1,
        firstValidAt: v.firstValidAt,
        candidateId: v.candidateId,
        rewardWallet: v.rewardWallet,
        pointUnits: String(v.score.pointUnits),
        boost: {
          base: v.score.base,
          warplet: v.score.warplet,
          holding: v.score.holding,
          streak: v.score.streak,
          total: v.score.total,
          points: v.score.points,
        },
        wallets,
        holding: details
          ? { ...details, units: String(details.units), evidence }
          : null,
      };
    }),
  );
  requireThat(
    inputs.length <= 10000,
    409,
    "Local settlement supports at most 10,000 voters",
  );
  const inputRows = await Promise.all(
    inputs.map(async (v) => ({
      value: v,
      payload: canonical(v),
      hash: await sha(canonical(v)),
    })),
  );
  const releases = allCampaigns.flatMap((c) =>
    releasesFor(c.launchedAt, r.closes_at).map((index) => ({
      campaign: c,
      index,
    })),
  );
  requireThat(
    releases.length <= 20,
    409,
    "Too many overlapping release campaigns",
  );
  if (snapshot.mode === "observed")
    requireThat(
      releases.every((v) => v.campaign.mode === "observed"),
      409,
      "Observed allocation cannot use simulated editions",
    );
  const winners: Recipient[] = inputs.slice(0, 100).map((v) => ({
    fid: v.fid,
    rank: v.rank,
    pointUnits: v.pointUnits,
    rewardWallet: v.rewardWallet,
  }));
  const plans: Plan[] = releases
    .map(({ campaign: c, index }) => ({
      id: `${c.id}:${index}`,
      campaignId: c.id,
      releaseIndex: index,
      releaseAt: releaseAt(c.launchedAt, index),
      total: String(BigInt(c.totalSupply) / 100n),
      ...allocate(BigInt(c.totalSupply) / 100n, winners),
    }))
    .sort((a, b) => a.releaseAt - b.releaseAt || (a.id < b.id ? -1 : 1));
  // The manifest contains evidence summaries, not one unbounded D1 cell of voter data.
  const launchSources = await rows<{ id: string; launch_evidence: string }>(
    db,
    "SELECT id,launch_evidence FROM meme_campaigns WHERE launched_at<=? AND ends_at>=?",
    r.closes_at,
    r.closes_at,
  );
  const context = canonical({
    launchSources: await Promise.all(
      launchSources
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(async (s) => ({
          id: s.id,
          evidenceHash: await sha(s.launch_evidence),
        })),
    ),
    roundId: r.id,
    cutoff: r.closes_at,
    rulesVersion: r.rules_version,
    attribute: r.attribute,
    cycleId: r.cycle_id,
    snapshotId: snapshot.id,
    mode: snapshot.mode,
    campaigns: relevant,
    releaseWindows: plans.map(({ recipients, ...p }) => p),
  });
  const inputHash = await sha(
      canonical({ context, inputHashes: inputRows.map((v) => v.hash) }),
    ),
    resultHash = await sha(canonical(plans));
  return {
    inputRows,
    plans,
    context,
    inputHash,
    resultHash,
    mode: snapshot.mode,
  };
}

// One call writes a bounded page. Identical retries resume from durable row counts.
export async function settle(
  db: Database,
  id: string,
  actor: string,
  pageSize = 40,
) {
  requireThat(
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 40,
    400,
    "Invalid settlement page size",
  );
  let job = await one<Job>(
    db,
    "SELECT * FROM meme_settlements WHERE round_id=?",
    id,
  );
  if (job?.state === "finalized") return settlementView(db, id);
  const r = await round(db, id),
    p = await prepare(db, r);
  await run(
    db,
    "INSERT INTO meme_settlements VALUES(?,?,?,?,?,?,?,?,'freezing',?,?,NULL) ON CONFLICT(round_id) DO NOTHING",
    id,
    r.closes_at,
    p.inputHash,
    p.resultHash,
    p.context,
    p.inputRows.length,
    p.plans.length,
    p.plans.reduce((n, v) => n + v.recipients.length, 0),
    p.mode,
    Date.now(),
  );
  job = await one<Job>(
    db,
    "SELECT * FROM meme_settlements WHERE round_id=?",
    id,
  );
  requireThat(
    job && job.input_hash === p.inputHash && job.result_hash === p.resultHash,
    409,
    "Settlement inputs changed; explicit recovery required",
  );
  if (job.state === "finalized") return settlementView(db, id);
  if (job.state === "freezing") {
    const saved = await rows<{ fid: number; payload_hash: string }>(
        db,
        "SELECT fid,payload_hash FROM meme_settlement_inputs WHERE round_id=?",
        id,
      ),
      seen = new Map(saved.map((s) => [s.fid, s.payload_hash]));
    const inputIndex = new Map(p.inputRows.map((v) => [v.value.fid, v.hash]));
    requireThat(
      saved.every((s) => inputIndex.get(s.fid) === s.payload_hash),
      409,
      "Frozen input hash mismatch",
    );
    const next = p.inputRows
      .filter((v) => !seen.has(v.value.fid))
      .slice(0, pageSize);
    if (next.length)
      await db.batch(
        next.map((v) =>
          db
            .prepare(
              "INSERT INTO meme_settlement_inputs VALUES(?,?,?,?,?) ON CONFLICT(round_id,fid) DO NOTHING",
            )
            .bind(id, v.value.fid, v.value.rank, v.payload, v.hash),
        ),
      );
    if (saved.length + next.length < p.inputRows.length)
      return settlementView(db, id);
    await run(
      db,
      "UPDATE meme_settlements SET state='allocating' WHERE round_id=? AND state='freezing'",
      id,
    );
    return settlementView(db, id);
  }
  // Reserve release identities first. A second round can never allocate them again.
  for (const plan of p.plans) {
    const existing = await one<{
      round_id: string | null;
      result_hash: string;
    }>(
      db,
      "SELECT round_id,result_hash FROM meme_allocations WHERE campaign_id=? AND release_index=?",
      plan.campaignId,
      plan.releaseIndex,
    );
    requireThat(
      !existing ||
        (existing.round_id === id && existing.result_hash === p.resultHash),
      409,
      "Release already belongs to another settlement",
    );
  }
  const missingPlans = [];
  for (const plan of p.plans)
    if (!(await one(db, "SELECT id FROM meme_allocations WHERE id=?", plan.id)))
      missingPlans.push(plan);
  if (missingPlans.length) {
    await db.batch(
      missingPlans.map((v) =>
        db
          .prepare(
            "INSERT INTO meme_allocations VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,release_index) DO NOTHING",
          )
          .bind(
            v.id,
            v.campaignId,
            v.releaseIndex,
            v.releaseAt,
            id,
            v.total,
            v.allocated,
            v.reserve,
            p.inputHash,
            p.resultHash,
            p.mode,
            v.recipients.length ? null : "No qualifying voters",
          ),
      ),
    );
    // A competing round may have claimed a release between the read and write.
    for (const v of missingPlans)
      requireThat(
        (
          await one<{ round_id: string }>(
            db,
            "SELECT round_id FROM meme_allocations WHERE id=?",
            v.id,
          )
        )?.round_id === id,
        409,
        "Release allocation raced with another round",
      );
  }
  const saved = await rows<{
      allocation_id: string;
      fid: number;
      amount: string;
      reward_wallet: string;
    }>(
      db,
      "SELECT e.* FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id WHERE a.round_id=?",
      id,
    ),
    seen = new Map(saved.map((v) => [v.allocation_id + ":" + v.fid, v]));
  const expected = p.plans.flatMap((v) =>
    v.recipients.map((recipient) => ({ allocation: v.id, ...recipient })),
  );
  requireThat(
    saved.every((s) =>
      expected.some(
        (v) =>
          v.allocation === s.allocation_id &&
          v.fid === s.fid &&
          v.amount === s.amount &&
          v.rewardWallet === s.reward_wallet,
      ),
    ),
    409,
    "Entitlement hash mismatch",
  );
  const next = expected
    .filter((v) => !seen.has(v.allocation + ":" + v.fid))
    .slice(0, pageSize);
  if (next.length)
    await db.batch(
      next.map((v) =>
        db
          .prepare(
            "INSERT INTO meme_entitlements VALUES(?,?,?,?,?,'finalized_unfunded') ON CONFLICT(allocation_id,fid) DO NOTHING",
          )
          .bind(v.allocation, v.fid, v.rank, v.rewardWallet, v.amount),
      ),
    );
  if (saved.length + next.length < expected.length)
    return settlementView(db, id);
  await db.batch([
    db
      .prepare(
        "INSERT INTO meme_audit(at,actor,action,subject,detail) SELECT ?,?,'settle',?,? WHERE EXISTS(SELECT 1 FROM meme_settlements WHERE round_id=? AND state='allocating')",
      )
      .bind(
        Date.now(),
        actor,
        id,
        canonical({ inputHash: p.inputHash, resultHash: p.resultHash }),
        id,
      ),
    db
      .prepare(
        "UPDATE meme_settlements SET state='finalized',finalized_at=? WHERE round_id=? AND state='allocating' AND voter_count=(SELECT COUNT(*) FROM meme_settlement_inputs WHERE round_id=?) AND allocation_count=(SELECT COUNT(*) FROM meme_allocations WHERE round_id=?) AND entitlement_count=(SELECT COUNT(*) FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id WHERE a.round_id=?)",
      )
      .bind(Date.now(), id, id, id, id),
  ]);
  return settlementView(db, id);
}

export async function settlementView(db: Database, id: string) {
  const job = await one<Job>(
    db,
    "SELECT * FROM meme_settlements WHERE round_id=?",
    id,
  );
  if (!job) return null;
  const inputs =
    job.state === "finalized"
      ? await rows<{
          fid: number;
          rank: number;
          points: string;
          firstValidAt: number;
        }>(
          db,
          "SELECT fid,rank,json_extract(payload,'$.boost.points') points,json_extract(payload,'$.firstValidAt') firstValidAt FROM meme_settlement_inputs WHERE round_id=? ORDER BY rank LIMIT 100",
          id,
        )
      : [];
  const allocations =
    job.state === "finalized"
      ? await rows(
          db,
          "SELECT id,campaign_id,release_index,release_at,total,allocated,reserve,reason FROM meme_allocations WHERE round_id=? ORDER BY release_at,id",
          id,
        )
      : [];
  const count =
    job.state === "finalized"
      ? { n: job.voter_count }
      : await one<{ n: number }>(
          db,
          "SELECT COUNT(*) n FROM meme_settlement_inputs WHERE round_id=?",
          id,
        );
  const entitlements =
    job.state === "finalized"
      ? { n: job.entitlement_count }
      : await one<{ n: number }>(
          db,
          "SELECT COUNT(*) n FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id WHERE a.round_id=?",
          id,
        );
  return {
    roundId: id,
    state: job.state,
    mode: job.mode,
    inputHash: job.input_hash,
    resultHash: job.result_hash,
    cutoff: job.cutoff,
    rulesVersion: RULES_VERSION,
    context: JSON.parse(job.context),
    progress: {
      frozen: count?.n ?? 0,
      voters: job.voter_count,
      entitlements: entitlements?.n ?? 0,
      expectedEntitlements: job.entitlement_count,
    },
    leaderboard: inputs,
    allocations: job.state === "finalized" ? allocations : [],
    claimable: false,
  };
}
export async function settledWeights(db: Database, id: string) {
  const weights = await rows<{ candidate: string; points: number }>(
    db,
    "SELECT json_extract(payload,'$.candidateId') candidate,SUM(CAST(json_extract(payload,'$.pointUnits') AS INTEGER)) points FROM meme_settlement_inputs WHERE round_id=? GROUP BY 1",
    id,
  );
  return Object.fromEntries(
    weights.map((v) => [v.candidate, decimal(BigInt(v.points) / 10n)]),
  );
}
export async function ownEntitlements(
  db: Database,
  fid: number | null,
  page?: { campaignIds: string[]; throughAt: number },
) {
  if (!fid) return [];
  const result = await rows<{
    edition_id: string;
    amount: string;
    reward_wallet: string;
    release_at: number;
    state: string;
    [key: string]: unknown;
  }>(
    db,
    `SELECT a.id allocationId,a.campaign_id edition_id,c.symbol,c.decimals,a.release_index,a.release_at,e.amount,e.state,e.reward_wallet,a.round_id,a.mode,'finalized' finality,CASE WHEN f.intent_id IS NOT NULL THEN 'funded' ELSE 'unfunded' END fundingState,CASE WHEN ?<a.release_at THEN 'scheduled' WHEN ?<(CAST((a.release_at+999)/1000 AS INTEGER)*1000+1000) THEN 'vesting' ELSE 'released' END releaseState,CASE WHEN cl.intent_id IS NOT NULL THEN 'claimed' ELSE 'unclaimed' END claimState,'local-only' executionMode,0 claimable FROM ${page ? "meme_campaigns c CROSS JOIN meme_allocations a ON a.campaign_id=c.id CROSS JOIN meme_entitlements e ON e.allocation_id=a.id" : "meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id JOIN meme_campaigns c ON c.id=a.campaign_id"} JOIN meme_settlements s ON s.round_id=a.round_id LEFT JOIN meme_financial_receipts f ON a.mode='simulated' AND f.business_key=('solana-local:fund:'||a.id) LEFT JOIN meme_financial_receipts cl ON a.mode='simulated' AND cl.business_key=('solana-local:claim:'||a.id||':'||e.fid) WHERE e.fid=? AND s.state='finalized' ${page ? "AND c.id IN(SELECT value FROM json_each(?)) AND s.finalized_at<=?" : ""} ORDER BY a.release_at,a.id`,
    Date.now(),
    Date.now(),
    fid,
    ...(page ? [canonical(page.campaignIds), page.throughAt] : []),
  );
  return result.map((row) => ({ ...row, claimable: false }));
}
export async function ownSettledScore(
  db: Database,
  id: string,
  fid: number | null,
) {
  if (!fid) return null;
  const row = await one<{ payload: string }>(
    db,
    "SELECT i.payload FROM meme_settlement_inputs i JOIN meme_settlements s ON s.round_id=i.round_id WHERE i.round_id=? AND i.fid=? AND s.state='finalized'",
    id,
    fid,
  );
  if (!row) return null;
  const input = JSON.parse(row.payload) as FrozenInput;
  return { ...input.boost, finality: "finalized", holdingStatus: "ready" };
}
export async function reserveUnoffered(
  db: Database,
  p: Record<string, unknown>,
  actor: string,
) {
  const campaignId = text(p.campaignId, "campaign"),
    index = integer(p.releaseIndex, "release index", 1, 10),
    reason = text(p.reason, "reserve reason", 2000);
  const c = (await campaigns(db)).find((c) => c.id === campaignId);
  requireThat(c, 404, "Unknown campaign");
  const at = releaseAt(c.launchedAt, index);
  requireThat(at <= Date.now(), 409, "A future release cannot be reserved");
  requireThat(
    !(await one(
      db,
      "SELECT id FROM meme_rounds WHERE closes_at>=? AND closes_at<? AND snapshot_id IN(SELECT id FROM meme_ownership_snapshots WHERE state='ready')",
      at - DAY_MS,
      at,
    )),
    409,
    "An existing round must settle this release",
  );
  const id = `${campaignId}:${index}`,
    total = String(BigInt(c.totalSupply) / 100n),
    hash = await sha(
      canonical({ campaignId, index, at, reason, rulesVersion: RULES_VERSION }),
    );
  const old = await one<{ input_hash: string }>(
    db,
    "SELECT input_hash FROM meme_allocations WHERE id=?",
    id,
  );
  requireThat(
    !old || old.input_hash === hash,
    409,
    "Release already allocated or reserve reason changed",
  );
  if (!old)
    await db.batch([
      db
        .prepare(
          "INSERT INTO meme_allocations VALUES(?,?,?,?,NULL,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          campaignId,
          index,
          at,
          total,
          "0",
          total,
          hash,
          hash,
          c.mode,
          reason,
        ),
      db
        .prepare(
          "INSERT INTO meme_audit(at,actor,action,subject,detail) VALUES(?,?,'reserve-unoffered',?,?)",
        )
        .bind(Date.now(), actor, id, canonical({ hash, reason })),
    ]);
  return {
    id,
    total,
    allocated: "0",
    reserve: total,
    releaseAt: at,
    reason,
    inputHash: hash,
    claimable: false,
  };
}
export async function settlementRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/meme/operator/reserves") {
    requireThat(request.method === "POST", 405, "Method not allowed");
    const actor = await operator(db, request);
    return json(
      await reserveUnoffered(
        db,
        await payload(request, ["campaignId", "releaseIndex", "reason"]),
        actor,
      ),
    );
  }
  const publicMatch = path.match(/^\/api\/meme\/settlements\/([^/]+)$/);
  if (publicMatch && request.method === "GET")
    return json(await settlementView(db, publicMatch[1]));
  const match = path.match(/^\/api\/meme\/operator\/rounds\/([^/]+)\/settle$/);
  if (!match) return null;
  requireThat(request.method === "POST", 405, "Method not allowed");
  const actor = await operator(db, request);
  await payload(request, []);
  return json(await settle(db, match[1], actor));
}
