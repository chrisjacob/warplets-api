import { CandidateSchema, DEFAULT_POLICY, shortlist, type Candidate } from "./model";
import { SourceError, type Reserve, type Transaction, type Accounts } from "./rpc";
import { hashJson } from "./solana";

export type Control = {
  paused: number; lease_owner: string | null; lease_until: string | null;
  last_harvest: string | null; migration_cursor: string | null;
  last_success: string | null; last_error: string | null; retry_after: string | null;
};
export type Lead = { address: string; pool: string; migration_tx: string; migration_signature: string; first_seen_at: string; attempts: number };
export async function control(db: D1Database): Promise<Control> {
  const row = await db.prepare("SELECT * FROM tenx_control WHERE id=1").first<Control>();
  if (!row) throw new Error("discovery_database_uninitialized"); return row;
}
export function reserveQuota(db: D1Database, limits: Record<"rpc" | "market", number>, now: Date): Reserve {
  return async provider => {
    const result = await db.prepare(`INSERT INTO tenx_usage(provider,day,used) VALUES(?1,?2,1)
      ON CONFLICT(provider,day) DO UPDATE SET used=used+1 WHERE used < ?3 RETURNING used`)
      .bind(provider, now.toISOString().slice(0, 10), limits[provider]).first<{ used: number }>();
    if (!result || result.used > limits[provider]) throw new SourceError(`${provider}_daily_budget_exhausted`, 3600);
  };
}
export async function acquire(db: D1Database, id: string, now: string): Promise<boolean> {
  const until = new Date(Date.parse(now) + 10 * 60_000).toISOString();
  const result = await db.prepare(`UPDATE tenx_control SET lease_owner=?1,lease_until=?2
    WHERE id=1 AND paused=0 AND (lease_until IS NULL OR lease_until < ?3)
    AND (retry_after IS NULL OR retry_after <= ?3) RETURNING id`).bind(id, until, now).first();
  return result !== null;
}
export async function saveCandidate(db: D1Database, candidate: Candidate, transactions: Transaction[] = [], state?: Accounts): Promise<void> {
  CandidateSchema.parse(candidate);
  for (const proof of candidate.mode === "live" ? [candidate.creation, candidate.graduation] : []) {
    if (!proof) continue;
    const prior = await db.prepare("SELECT payload_hash FROM tenx_proofs WHERE address=?1 AND kind=?2").bind(candidate.address, proof.kind).first<{ payload_hash: string }>();
    if (prior && prior.payload_hash !== proof.payload_hash) throw new Error("conflicting_immutable_proof");
  }
  const statements = [db.prepare(`INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?1,?2,?3,?4,?5)
    ON CONFLICT(mode,address) DO UPDATE SET pool=excluded.pool,payload=excluded.payload,checked_at=excluded.checked_at`)
    .bind(candidate.address, candidate.pool, JSON.stringify(candidate), candidate.checked_at, candidate.mode)];
  if (candidate.mode === "live") {
    for (const proof of [candidate.creation, candidate.graduation]) {
      if (!proof) continue;
      statements.push(db.prepare(`INSERT INTO tenx_proofs(address,kind,signature,instruction_index,slot,payload_hash,payload)
        VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(address,kind) DO NOTHING`)
        .bind(candidate.address, proof.kind, proof.signature, proof.instruction_index, proof.slot, proof.payload_hash, JSON.stringify(proof)));
    }
    for (const tx of transactions) {
      statements.push(db.prepare("INSERT OR IGNORE INTO tenx_evidence(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)")
        .bind(tx.transaction.signatures[0]!, await hashJson(tx), JSON.stringify(tx), candidate.checked_at));
    }
    if (state) statements.push(db.prepare("INSERT OR IGNORE INTO tenx_account_evidence(payload_hash,address,slot,payload,observed_at) VALUES(?1,?2,?3,?4,?5)")
      .bind(await hashJson(state), candidate.address, state.context.slot, JSON.stringify(state), candidate.checked_at));
  }
  await db.batch(statements);
}
export async function candidates(db: D1Database, mode: "live" | "fixture" = "live"): Promise<Candidate[]> {
  const rows = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode=?1 ORDER BY checked_at DESC LIMIT 500").bind(mode).all<{ payload: string }>();
  return rows.results.map(row => CandidateSchema.parse(JSON.parse(row.payload)));
}
export async function dryRun(db: D1Database, now: Date): Promise<unknown> {
  const ranked = shortlist(await candidates(db), DEFAULT_POLICY, now);
  const eligible = ranked.filter(row => row.eligibility === "eligible");
  const inputs = { policy: DEFAULT_POLICY, as_of: now.toISOString(), candidates: ranked };
  const inputHash = await hashJson(inputs);
  const payload = {
    id: crypto.randomUUID(), input_hash: inputHash, policy: DEFAULT_POLICY,
    as_of: now.toISOString(), mode: "dry_run", outcome: eligible.length ? "simulated_winner" : "no_eligible_winner",
    winner_address: eligible[0]?.address ?? null, launch_enabled: false, inputs,
  };
  await db.prepare("INSERT OR IGNORE INTO tenx_dry_runs(id,input_hash,payload,created_at) VALUES(?1,?2,?3,?4)")
    .bind(payload.id, inputHash, JSON.stringify(payload), now.toISOString()).run();
  return payload;
}
export async function audit(db: D1Database, action: string, reason: string, data: unknown, actor = "local-operator"): Promise<void> {
  await db.prepare("INSERT INTO tenx_audit(id,action,actor,reason,data_hash,created_at) VALUES(?1,?2,?3,?4,?5,?6)")
    .bind(crypto.randomUUID(), action, actor, reason, await hashJson(data), new Date().toISOString()).run();
}
