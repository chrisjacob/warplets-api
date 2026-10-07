import { getAppSession, type AppAuthEnv, type AppSession } from "./appAuth.js";
import type { SecurityEnv } from "./security.js";
import {
  DEFAULT_SOCIAL_CONFIG,
  calculateBoost,
  DAY,
  utcDay,
  type BoostEvidence,
  type SocialConfig,
  type SocialAction,
} from "../../shared/social.js";

export interface SocialEnv extends AppAuthEnv, SecurityEnv {
  WARPLETS: D1Database;
  NEYNAR_API_KEY?: string;
  BASE_RPC_URL?: string;
  BNB_RPC_URL?: string;
  SOCIAL_CHECKIN_ADDRESS?: string;
  SOCIAL_SIGNER_SPONSOR_PRIVATE_KEY?: string;
  SOCIAL_APP_FID?: string;
}
export class SocialError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface Member {
  id: string;
  group_id: string;
  username: string;
  avatar: string | null;
  status: string;
  next_post_at: number;
  bonus_opt_out: number;
}
export const FAMILY = "SELECT id FROM social_members WHERE group_id=?";
export async function socialConfig(
  db: D1Database,
): Promise<{ version: number; config: SocialConfig }> {
  const row = await db
    .prepare(
      "SELECT version,config_json FROM social_config ORDER BY version DESC LIMIT 1",
    )
    .first<{ version: number; config_json: string }>();
  return row
    ? { version: row.version, config: JSON.parse(row.config_json) }
    : { version: 0, config: structuredClone(DEFAULT_SOCIAL_CONFIG) };
}
export async function ensureIdentity(
  db: D1Database,
  identity: string,
  username?: string,
  avatar?: string | null,
): Promise<Member> {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO social_members(id,group_id,username,avatar,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM social_identities WHERE identity=?)",
      )
      .bind(
        id,
        id,
        username || `Explorer-${id.slice(0, 8)}`,
        avatar ?? null,
        Date.now(),
        identity,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO social_identities(identity,member_id,created_at) SELECT ?,id,? FROM social_members WHERE id=?",
      )
      .bind(identity, Date.now(), id),
  ]);
  const member = await db
    .prepare(
      "SELECT m.* FROM social_members m JOIN social_identities i ON i.member_id=m.id WHERE i.identity=?",
    )
    .bind(identity)
    .first<Member>();
  if (!member) throw new SocialError("Identity could not be created", 503);
  return member;
}
export async function socialMember(
  request: Request,
  env: SocialEnv,
): Promise<{ member: Member; session: AppSession }> {
  const session = await getAppSession(request, env);
  if (!session || (!session.farcasterFid && !session.walletAddress))
    throw new SocialError(
      "Connect Farcaster or verify your wallet to continue",
      401,
    );
  const identity = session.farcasterFid
    ? `fid:${session.farcasterFid}`
    : `wallet:${session.walletAddress!.toLowerCase()}`;
  let member = await ensureIdentity(env.WARPLETS, identity);
  if (session.farcasterFid && session.walletAddress) {
    const linked = await env.WARPLETS.prepare(
      "SELECT 1 FROM app_identity_links WHERE farcaster_fid=? AND lower(wallet_address)=?",
    )
      .bind(session.farcasterFid, session.walletAddress.toLowerCase())
      .first();
    if (linked) {
      const walletMember = await ensureIdentity(
        env.WARPLETS,
        `wallet:${session.walletAddress.toLowerCase()}`,
      );
      if (walletMember.group_id !== member.group_id) {
        // Both principals are independently verified by shared auth before linking.
        // Keep historical member IDs; all limits and rewards are queried by family.
        const root = [walletMember.group_id, member.group_id].sort()[0]!;
        await env.WARPLETS.batch([
          env.WARPLETS.prepare(
            "UPDATE social_members SET group_id=? WHERE group_id IN (?,?)",
          ).bind(root, walletMember.group_id, member.group_id),
          env.WARPLETS.prepare(
            "UPDATE social_members SET next_post_at=(SELECT MAX(next_post_at) FROM social_members WHERE group_id=?) WHERE group_id=?",
          ).bind(root, root),
          env.WARPLETS.prepare(
            "UPDATE social_members SET status='suspended' WHERE group_id=? AND EXISTS(SELECT 1 FROM social_members WHERE group_id=? AND status='suspended')",
          ).bind(root, root),
        ]);
        member.group_id = root;
      }
    }
  }
  const current = await env.WARPLETS.prepare(
    "SELECT * FROM social_members WHERE id=?",
  )
    .bind(member.id)
    .first<Member>();
  member = current!;
  if (member.status !== "active")
    throw new SocialError(
      "This member has been suspended. Contact 10X to appeal.",
      403,
    );
  return { member, session };
}
export async function streak(db: D1Database, group: string): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT day FROM social_checkins WHERE member_id IN (${FAMILY}) ORDER BY day DESC LIMIT 366`,
    )
    .bind(group)
    .all<{ day: string }>();
  const days = new Set(rows.results.map((r) => r.day));
  let cursor = days.has(utcDay()) ? Date.now() : Date.now() - DAY,
    count = 0;
  while (days.has(utcDay(cursor))) {
    count++;
    cursor -= DAY;
  }
  return count;
}
export async function evidence(
  env: SocialEnv,
  member: Member,
  session: AppSession,
): Promise<{ evidence: BoostEvidence; updatedAt: number | null }> {
  const row = await env.WARPLETS.prepare(
    "SELECT data_json,updated_at FROM social_evidence WHERE member_id=?",
  )
    .bind(member.id)
    .first<{ data_json: string; updated_at: number }>();
  const cached =
    row && Date.now() - row.updated_at < 15 * 60_000
      ? (JSON.parse(row.data_json) as Partial<BoostEvidence>)
      : {};
  // A browser context hint is not cryptographic evidence of the host. Context
  // rewards remain unavailable until a trusted host-attestation is integrated.
  const e: BoostEvidence = {
    connection: !!session.farcasterFid,
    context: false,
    notifications: false,
    signer: false,
    follow: false,
    email: false,
    warpletLevel: 0,
    stonklets: 0,
    ...cached,
    streak: await streak(env.WARPLETS, member.group_id),
  };
  return { evidence: e, updatedAt: row?.updated_at ?? null };
}
export async function award(
  env: SocialEnv,
  member: Member,
  session: AppSession,
  action: SocialAction,
  event: string,
  post: string | null = null,
  earnedDay = utcDay(),
): Promise<void> {
  const { version, config } = await socialConfig(env.WARPLETS);
  const { evidence: e } = await evidence(env, member, session);
  const boost = calculateBoost(config, e);
  const day = earnedDay;
  // Atomic INSERT SELECT protects retries and simultaneous reward requests.
  await env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO social_rewards(id,member_id,event_key,action,post_id,day,base,multiplier,points,config_version,evidence_json,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM social_rewards WHERE member_id IN (${FAMILY}) AND event_key=?)
    AND (SELECT COUNT(*) FROM social_rewards WHERE member_id IN (${FAMILY}) AND action=? AND day=?) < ?
    AND NOT EXISTS(SELECT 1 FROM social_members WHERE group_id=? AND status!='active')`,
  )
    .bind(
      crypto.randomUUID(),
      member.id,
      event,
      action,
      post,
      day,
      config.points[action],
      boost.multiplier,
      Math.round(config.points[action] * boost.multiplier * 100) / 100,
      version,
      JSON.stringify(e),
      Date.now(),
      member.group_id,
      event,
      member.group_id,
      action,
      day,
      config.limits[action],
      member.group_id,
    )
    .run();
}
// Merge-time duplicates are excluded from totals without rewriting historical awards.
export const REWARD_TOTALS = `WITH ranked_rewards AS (SELECT r.*,m.group_id,ROW_NUMBER() OVER(PARTITION BY m.group_id,r.event_key ORDER BY r.created_at,r.id) AS duplicate_rank FROM social_rewards r JOIN social_members m ON m.id=r.member_id), earned AS (SELECT * FROM ranked_rewards WHERE duplicate_rank=1)`;
