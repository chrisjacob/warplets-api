import { principal, sessionView } from "./auth";
import {
  one,
  rows,
  run,
  json,
  payload,
  requireThat,
  text,
  integer,
  sha,
  Problem,
  type Database,
} from "./db";
import {
  ATTRIBUTES,
  RULES_VERSION,
  dailyTimes,
  type Attribute,
} from "../shared/rules";
import { canonical } from "../shared/canonical";
import { decode58 } from "../shared/base58";
import { cycleAttribute } from "./cycles";
import { scoreRound } from "./scoring";
export interface StoredRound {
  id: string;
  opens_at: number;
  closes_at: number;
  attribute: Attribute;
  state: "prepared" | "frozen" | "open" | "closed" | "selected" | "skipped";
  snapshot_id: string | null;
  rules_version: string;
  selected_candidate: string | null;
  outcome_reason: string | null;
  cycle_id: string | null;
  cycle_index: number | null;
}
export interface OwnershipEvidence {
  source: "warplets";
  mode: "observed" | "simulated";
  sourceAt: number;
  checkpoint: string;
  complete: true;
  ownership: {
    tokenId: number;
    wallet: string;
    levels: Record<Attribute, number>;
  }[];
}
export async function operator(db: Database, request: Request) {
  const bearer = request.headers.get("authorization");
  requireThat(
    bearer && bearer.startsWith("Bearer "),
    401,
    "Operator token required",
  );
  const row = await one<{ label: string }>(
    db,
    "SELECT label FROM meme_operator_tokens WHERE token_hash=?",
    await sha(bearer.slice(7)),
  );
  requireThat(row, 403, "Invalid operator token");
  return row.label;
}
export async function audit(
  db: Database,
  actor: string,
  action: string,
  subject: string,
  detail: unknown,
) {
  await run(
    db,
    "INSERT INTO meme_audit(at,actor,action,subject,detail) VALUES(?,?,?,?,?)",
    Date.now(),
    actor,
    action,
    subject,
    canonical(detail),
  );
}
export async function advance(db: Database, now = Date.now()) {
  await run(
    db,
    "UPDATE meme_rounds SET state=CASE WHEN closes_at<=? THEN 'closed' ELSE 'open' END WHERE state IN('frozen','open') AND opens_at<=?",
    now,
    now,
  );
}
export async function round(db: Database, id: string) {
  await advance(db);
  const r = await one<StoredRound>(
    db,
    "SELECT * FROM meme_rounds WHERE id=?",
    id,
  );
  requireThat(r, 404, "Round not found");
  return r;
}
export async function createRound(
  db: Database,
  p: Record<string, unknown>,
  actor: string,
) {
  const scheduled = typeof p.day === "string" ? dailyTimes(p.day) : null;
  const id = text(p.id, "round id", 80),
    opensAt = integer(scheduled?.opensAt ?? p.opensAt, "open time"),
    closesAt = integer(scheduled?.closesAt ?? p.closesAt, "close time");
  requireThat(
    opensAt > Date.now() &&
      closesAt > opensAt &&
      closesAt - opensAt <= 86400000,
    400,
    "Round must open in the future and last no more than 24 hours",
  );
  const cycleId =
    typeof p.cycleId === "string" ? text(p.cycleId, "cycle ID", 80) : null;
  const cycle = cycleId ? await cycleAttribute(db, cycleId, closesAt) : null;
  requireThat(
    cycle || p.simulated === true,
    400,
    "A committed cycle is required; manual attributes are simulated only",
  );
  const attribute = cycle?.attribute ?? p.attribute;
  requireThat(
    !cycle || p.attribute == null || p.attribute === attribute,
    400,
    "Attribute conflicts with cycle",
  );
  requireThat(
    ATTRIBUTES.includes(attribute as Attribute),
    400,
    "Unknown attribute",
  );
  requireThat(
    Array.isArray(p.candidates) &&
      p.candidates.length > 0 &&
      p.candidates.length <= 20,
    400,
    "Provide 1–20 reviewed candidates",
  );
  const statements = [
    db
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version,selected_candidate,outcome_reason,cycle_id,cycle_index) VALUES(?,?,?,?,'prepared',NULL,?,NULL,NULL,?,?)",
      )
      .bind(
        id,
        opensAt,
        closesAt,
        attribute,
        RULES_VERSION,
        cycleId,
        cycle?.index ?? null,
      ),
  ];
  const ids = new Set<string>();
  for (const raw of p.candidates) {
    requireThat(raw && typeof raw === "object", 400, "Invalid candidate");
    const c = raw as Record<string, unknown>,
      candidate = text(c.id, "candidate id", 80),
      mint = text(c.ogMint, "OG mint", 64);
    decode58(mint, 32);
    requireThat(!ids.has(candidate), 400, "Duplicate candidate");
    ids.add(candidate);
    const evidence = text(c.evidence, "screening evidence", 4000);
    statements.push(
      db
        .prepare("INSERT INTO meme_candidates VALUES(?,?,?,?,?,?)")
        .bind(
          id,
          candidate,
          text(c.name, "name", 80),
          text(c.symbol, "symbol", 20),
          mint,
          evidence,
        ),
    );
  }
  await db.batch(statements);
  await audit(db, actor, "create-round", id, { opensAt, closesAt });
  return { id };
}
export async function freezeOwnership(
  db: Database,
  id: string,
  input: unknown,
  actor: string,
) {
  requireThat(
    input && typeof input === "object",
    400,
    "Ownership evidence required",
  );
  const evidence = input as OwnershipEvidence;
  const r = await round(db, id);
  requireThat(
    r.state === "prepared" || r.state === "frozen",
    409,
    "Round cannot be frozen now",
  );
  const now = Date.now();
  requireThat(
    now < r.opens_at,
    409,
    "Ownership must freeze before reveal/open",
  );
  requireThat(
    evidence.source === "warplets" &&
      ["observed", "simulated"].includes(evidence.mode) &&
      evidence.complete === true &&
      typeof evidence.checkpoint === "string" &&
      evidence.checkpoint.length > 0,
    400,
    "Complete Warplets source evidence required",
  );
  requireThat(
    Number.isSafeInteger(evidence.sourceAt) &&
      evidence.sourceAt <= now &&
      evidence.sourceAt >= now - 86400000,
    409,
    "Ownership evidence is stale or from the future",
  );
  requireThat(
    Array.isArray(evidence.ownership) && evidence.ownership.length <= 10000,
    400,
    "Invalid ownership rows",
  );
  if (evidence.mode === "observed")
    requireThat(
      evidence.ownership.length === 10000,
      409,
      "Observed freeze requires complete 10K ownership coverage",
    );
  const ids = new Set<number>();
  const sorted = [...evidence.ownership].sort((a, b) => a.tokenId - b.tokenId);
  for (const item of sorted) {
    integer(item.tokenId, "token ID", 1, 10000);
    requireThat(!ids.has(item.tokenId), 400, "Duplicate NFT");
    ids.add(item.tokenId);
    requireThat(
      /^0x[0-9a-fA-F]{40}$/.test(item.wallet),
      400,
      "Invalid owner wallet",
    );
    for (const attribute of ATTRIBUTES)
      integer(item.levels?.[attribute], attribute, 1, 10);
    item.wallet = item.wallet.toLowerCase();
  }
  const snapshotId = await sha(canonical({ ...evidence, ownership: sorted }));
  const existing = await one<{
    id: string;
    captured_at: number;
    state: string;
  }>(
    db,
    "SELECT id,captured_at,state FROM meme_ownership_snapshots WHERE round_id=?",
    id,
  );
  requireThat(
    !existing || existing.id === snapshotId,
    409,
    "A different freeze is already staged for this round",
  );
  if (existing?.state === "ready") return { snapshotId, replayed: true };
  const cutoff = existing?.captured_at ?? now;
  const manifest = {
    source: evidence.source,
    mode: evidence.mode,
    sourceAt: evidence.sourceAt,
    checkpoint: evidence.checkpoint,
    complete: true,
    hash: snapshotId,
    expectedTokens: sorted.length,
  };
  if (!existing)
    await db.batch([
      db
        .prepare(
          "INSERT INTO meme_ownership_snapshots VALUES(?,?,?,?,?,?,?,'importing',?)",
        )
        .bind(
          snapshotId,
          id,
          evidence.source,
          evidence.mode,
          evidence.sourceAt,
          cutoff,
          sorted.length,
          canonical(manifest),
        ),
      db
        .prepare(
          "INSERT INTO meme_freeze_links SELECT ?,fid,address FROM meme_wallet_links WHERE chain='base' AND verified_at<=? AND (revoked_at IS NULL OR revoked_at>?)",
        )
        .bind(snapshotId, cutoff, cutoff),
    ]);
  for (let i = 0; i < sorted.length; i += 100)
    await db.batch(
      sorted
        .slice(i, i + 100)
        .map((item) =>
          db
            .prepare(
              "INSERT INTO meme_ownership_tokens VALUES(?,?,?,?) ON CONFLICT(snapshot_id,token_id) DO NOTHING",
            )
            .bind(
              snapshotId,
              item.tokenId,
              item.wallet,
              canonical(item.levels),
            ),
        ),
    );
  const links = await rows<{ fid: number; address: string }>(
    db,
    "SELECT fid,address FROM meme_freeze_links WHERE snapshot_id=? ORDER BY fid,address",
    snapshotId,
  );
  const identities = new Map<string, Set<number>>();
  for (const link of links) {
    const fids = identities.get(link.address) ?? new Set();
    fids.add(link.fid);
    identities.set(link.address, fids);
  }
  const eligibility = new Map<
    number,
    { wallets: Set<string>; tokens: number[]; level: number }
  >();
  for (const item of sorted) {
    const fids = identities.get(item.wallet);
    if (!fids || fids.size !== 1) continue;
    const fid = [...fids][0],
      entry = eligibility.get(fid) ?? {
        wallets: new Set(),
        tokens: [],
        level: 0,
      };
    entry.wallets.add(item.wallet);
    entry.tokens.push(item.tokenId);
    entry.level = Math.max(entry.level, item.levels[r.attribute]);
    eligibility.set(fid, entry);
  }
  const entries = [...eligibility];
  for (let i = 0; i < entries.length; i += 100)
    await db.batch(
      entries
        .slice(i, i + 100)
        .map(([fid, e]) =>
          db
            .prepare(
              "INSERT INTO meme_round_eligibility VALUES(?,?,?,?,?) ON CONFLICT(round_id,fid) DO NOTHING",
            )
            .bind(
              id,
              fid,
              canonical([...e.wallets].sort()),
              canonical(e.tokens),
              e.level,
            ),
        ),
    );
  const count = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) n FROM meme_ownership_tokens WHERE snapshot_id=?",
    snapshotId,
  );
  requireThat(count?.n === sorted.length, 409, "Incomplete ownership import");
  requireThat(
    Date.now() < r.opens_at,
    409,
    "Freeze missed reveal deadline; round remains unavailable",
  );
  await db.batch([
    db
      .prepare("UPDATE meme_ownership_snapshots SET state='ready' WHERE id=?")
      .bind(snapshotId),
    db
      .prepare(
        "UPDATE meme_rounds SET snapshot_id=?,state='frozen' WHERE id=? AND state='prepared'",
      )
      .bind(snapshotId, id),
  ]);
  await audit(db, actor, "freeze-ownership", id, manifest);
  return { snapshotId, eligibleAccounts: entries.length };
}
export async function vote(
  db: Database,
  id: string,
  fid: number,
  candidate: string,
  key: string,
  now = Date.now(),
) {
  requireThat(
    /^[A-Za-z0-9_-]{8,100}$/.test(key),
    400,
    "Idempotency key required",
  );
  const op = `vote:${id}:${fid}:${key}`,
    hash = await sha(canonical({ fid, candidate }));
  const previous = await one<{ payload_hash: string }>(
    db,
    "SELECT payload_hash FROM meme_operations WHERE key=?",
    op,
  );
  if (previous) {
    requireThat(
      previous.payload_hash === hash,
      409,
      "Idempotency key payload changed",
    );
    return { replayed: true };
  }
  const r = await round(db, id);
  requireThat(
    r.state === "open" && r.opens_at <= now && r.closes_at > now,
    409,
    "Voting is closed",
  );
  requireThat(
    await one(
      db,
      "SELECT id FROM meme_candidates WHERE round_id=? AND id=?",
      id,
      candidate,
    ),
    400,
    "Candidate not in round",
  );
  const wallet = await one<{ address: string }>(
    db,
    "SELECT address FROM meme_wallet_links WHERE fid=? AND chain='solana' AND role='reward' AND revoked_at IS NULL",
    fid,
  );
  requireThat(wallet, 409, "Verify a Solana reward wallet first");
  const existing = await one<{
      reward_wallet: string;
      wallet_scope_hash: string;
    }>(
      db,
      "SELECT reward_wallet,wallet_scope_hash FROM meme_votes WHERE round_id=? AND fid=?",
      id,
      fid,
    ),
    rewardWallet = existing?.reward_wallet ?? wallet.address;
  const eligible = await one<{ wallets: string }>(
    db,
    "SELECT wallets FROM meme_round_eligibility WHERE round_id=? AND fid=?",
    id,
    fid,
  );
  const baseWallets = JSON.parse(eligible?.wallets ?? "[]") as string[];
  const holdingRows = existing
    ? await rows<{ address: string }>(
        db,
        "SELECT address FROM meme_vote_wallets WHERE round_id=? AND fid=?",
        id,
        fid,
      )
    : await rows<{ address: string }>(
        db,
        "SELECT address FROM meme_wallet_links WHERE fid=? AND chain='solana' AND revoked_at IS NULL",
        fid,
      );
  const holdingWallets = [
    ...new Set([...holdingRows.map((w) => w.address), rewardWallet]),
  ].sort();
  const walletScopeHash =
    existing?.wallet_scope_hash ?? (await sha(canonical(holdingWallets)));
  const statements = [
    db
      .prepare(
        "INSERT INTO meme_operations VALUES(?,(SELECT id FROM meme_rounds WHERE id=? AND state='open' AND opens_at<=? AND closes_at>?),?)",
      )
      .bind(op, id, now, now, hash),
    ...[
      ...holdingWallets.map((w) => ["solana", w]),
      ...baseWallets.map((w) => ["base", w]),
    ].map(([chain, address]) =>
      db
        .prepare(
          "INSERT INTO meme_round_wallets VALUES(?,?,?,?) ON CONFLICT(round_id,chain,address) DO UPDATE SET fid=CASE WHEN fid=excluded.fid THEN fid ELSE NULL END",
        )
        .bind(id, chain, address, fid),
    ),
    db
      .prepare(
        "INSERT INTO meme_votes(round_id,fid,candidate_id,first_valid_at,updated_at,reward_wallet,wallet_scope_hash) VALUES(?,?,?,?,?,?,?) ON CONFLICT(round_id,fid) DO UPDATE SET candidate_id=excluded.candidate_id,updated_at=MAX(updated_at,excluded.updated_at)",
      )
      .bind(id, fid, candidate, now, now, rewardWallet, walletScopeHash),
    ...holdingWallets.map((address) =>
      db
        .prepare(
          "INSERT INTO meme_vote_wallets SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM meme_votes WHERE round_id=? AND fid=? AND wallet_scope_hash=?) ON CONFLICT(round_id,fid,address) DO NOTHING",
        )
        .bind(id, fid, address, id, fid, walletScopeHash),
    ),
    db
      .prepare(
        "INSERT INTO meme_audit(at,actor,action,subject,detail) VALUES(?,?,'vote',?,?)",
      )
      .bind(now, String(fid), id, canonical({ candidate, key })),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const replay = await one<{ payload_hash: string }>(
      db,
      "SELECT payload_hash FROM meme_operations WHERE key=?",
      op,
    );
    if (replay?.payload_hash === hash) return { replayed: true };
    throw new Problem(
      409,
      "Vote conflicted with a close, wallet reservation or repeated request",
    );
  }
  return { replayed: false };
}
export async function outcome(
  db: Database,
  id: string,
  p: Record<string, unknown>,
  actor: string,
) {
  const r = await round(db, id);
  requireThat(r.state === "closed", 409, "Close voting before selection");
  const reason = text(p.reason, "operator reason", 2000),
    skip = p.skip === true,
    candidate = skip ? null : text(p.candidateId, "candidate");
  if (candidate)
    requireThat(
      await one(
        db,
        "SELECT id FROM meme_candidates WHERE round_id=? AND id=?",
        id,
        candidate,
      ),
      400,
      "Unknown candidate",
    );
  await db.batch([
    db
      .prepare(
        "INSERT INTO meme_operations VALUES(?,(SELECT id FROM meme_rounds WHERE id=? AND state='closed'),?)",
      )
      .bind("outcome:" + id, id, await sha(canonical(p))),
    db
      .prepare(
        "UPDATE meme_rounds SET state=?,selected_candidate=?,outcome_reason=? WHERE id=?",
      )
      .bind(skip ? "skipped" : "selected", candidate, reason, id),
    db
      .prepare(
        "INSERT INTO meme_audit(at,actor,action,subject,detail) VALUES(?,?,'outcome',?,?)",
      )
      .bind(Date.now(), actor, id, canonical({ skip, candidate, reason })),
  ]);
  return { selectedCandidate: candidate, skipped: skip };
}
export async function state(db: Database, request: Request) {
  await advance(db);
  const identity = await sessionView(db, request),
    current = await one<StoredRound>(
      db,
      "SELECT * FROM meme_rounds ORDER BY CASE WHEN opens_at<=? AND closes_at>? THEN 0 WHEN opens_at>? THEN 1 ELSE 2 END,CASE WHEN opens_at>? THEN opens_at ELSE -closes_at END LIMIT 1",
      Date.now(),
      Date.now(),
      Date.now(),
      Date.now(),
    );
  const history = await rows<StoredRound>(
    db,
    "SELECT * FROM meme_rounds WHERE state IN('closed','selected','skipped') ORDER BY closes_at DESC LIMIT 30",
  );
  if (!current) return { mode: "local", identity, round: null, history };
  const candidates = await rows<{
      id: string;
      name: string;
      symbol: string;
      og_mint: string;
      evidence: string;
      uniqueVoters: number;
    }>(
      db,
      "SELECT c.*,COUNT(v.fid) uniqueVoters FROM meme_candidates c LEFT JOIN meme_votes v ON v.round_id=c.round_id AND v.candidate_id=c.id WHERE c.round_id=? GROUP BY c.id ORDER BY c.id",
      current.id,
    ),
    myVote = identity.farcasterFid
      ? await one(
          db,
          "SELECT candidate_id,first_valid_at,reward_wallet FROM meme_votes WHERE round_id=? AND fid=?",
          current.id,
          identity.farcasterFid,
        )
      : null;
  const scoring =
    current.snapshot_id && Date.now() >= current.opens_at
      ? await scoreRound(db, current, identity.farcasterFid)
      : null;
  return {
    mode: "local",
    ...(scoring?.view ?? {}),
    identity,
    round: {
      ...current,
      ownershipMode:
        (
          await one<{ mode: string }>(
            db,
            "SELECT mode FROM meme_ownership_snapshots WHERE id=?",
            current.snapshot_id,
          )
        )?.mode ?? null,
      attribute:
        Date.now() >= current.opens_at && current.snapshot_id
          ? current.attribute
          : null,
      candidates: candidates.map((c) => ({
        ...c,
        weightedVotes: scoring?.view.weightedVotes[c.id] ?? "0",
      })),
    },
    myVote,
    history,
  };
}
export async function roundsRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/meme/state" && request.method === "GET")
    return json(await state(db, request));
  const match = path.match(/^\/api\/meme\/rounds\/([^/]+)\/vote$/);
  if (match && request.method === "POST") {
    const s = await principal(db, request),
      p = await payload(request, ["candidateId", "key"]);
    return json(
      await vote(
        db,
        match[1],
        s.fid,
        text(p.candidateId, "candidate"),
        text(p.key, "key"),
      ),
    );
  }
  if (!path.startsWith("/api/meme/operator/")) return null;
  requireThat(request.method === "POST", 405, "Method not allowed");
  const actor = await operator(db, request);
  if (path === "/api/meme/operator/rounds") {
    return json(
      await createRound(
        db,
        await payload(request, [
          "id",
          "opensAt",
          "closesAt",
          "day",
          "attribute",
          "cycleId",
          "simulated",
          "candidates",
        ]),
        actor,
      ),
    );
  }
  const m = path.match(
    /^\/api\/meme\/operator\/rounds\/([^/]+)\/(freeze|outcome)$/,
  );
  requireThat(m, 404, "Unknown operator route");
  if (m[2] === "freeze")
    return json(
      await freezeOwnership(
        db,
        m[1],
        await payload(
          request,
          ["source", "mode", "sourceAt", "checkpoint", "complete", "ownership"],
          4 * 1024 * 1024,
        ),
        actor,
      ),
    );
  return json(
    await outcome(
      db,
      m[1],
      await payload(request, ["skip", "candidateId", "reason"]),
      actor,
    ),
  );
}
