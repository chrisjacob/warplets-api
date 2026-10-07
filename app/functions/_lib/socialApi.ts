import {
  calculateBoost,
  DAY,
  safeSocialUrl,
  trendScore,
  utcDay,
  type SocialPost,
  type SocialAction,
} from "../../shared/social.js";
import {
  award,
  evidence,
  FAMILY,
  REWARD_TOTALS,
  SocialError,
  socialConfig,
  socialMember,
  type Member,
  type SocialEnv,
} from "./socialStore.js";
import {
  fetchCast,
  neynar,
  refreshEvidence,
  requiredSigner,
  saveCast,
  startSigner,
  validateCast,
  verifyCheckin,
  type Cast,
} from "./socialProvider.js";
import { jsonSecure, rateLimit, readJsonBodyWithLimit } from "./security.js";
import { requireSameOrigin } from "./authValidation.js";
import type { AppSession } from "./appAuth.js";
import { resolveCastEmbed } from "./socialEmbed.js";

type Context = EventContext<SocialEnv, string, unknown>;
type Body = Record<string, unknown>;
interface PostRow extends Omit<SocialPost, "embeds"> {
  embeds_json: string;
  status: string;
  group_id: string;
  raw_json?: string;
}
function str(value: unknown, max = 4000): string {
  if (typeof value !== "string" || value.length > max)
    throw new SocialError("Invalid text");
  return value.trim();
}
function operationId(value: unknown): string {
  const id = str(value, 80);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(id))
    throw new SocialError("Invalid operation ID");
  return id;
}
export async function postRow(env: SocialEnv, id: string): Promise<PostRow> {
  const row = await env.WARPLETS.prepare(
    "SELECT p.*,m.username,m.avatar,m.group_id FROM social_posts p JOIN social_members m ON m.id=p.member_id WHERE p.id=? AND p.status='visible' AND m.status='active'",
  )
    .bind(id)
    .first<PostRow>();
  if (!row) throw new SocialError("Post not found", 404);
  return row;
}
async function hydrate(env: SocialEnv, rows: PostRow[]): Promise<SocialPost[]> {
  if (!rows.length) return [];
  // D1 allows at most 100 bound values per statement.
  if (rows.length > 90) {
    const result: SocialPost[] = [];
    for (let offset = 0; offset < rows.length; offset += 90)
      result.push(...(await hydrate(env, rows.slice(offset, offset + 90))));
    return result;
  }
  const ids = rows.map((r) => r.id),
    placeholders = ids.map(() => "?").join(",");
  const interactions = await env.WARPLETS.prepare(
    `SELECT post_id,kind,COUNT(DISTINCT m.group_id) AS n FROM social_interactions i JOIN social_members m ON m.id=i.member_id WHERE post_id IN (${placeholders}) AND i.active=1 AND m.status='active' AND delivery='local' GROUP BY post_id,kind`,
  )
    .bind(...ids)
    .all<{ post_id: string; kind: string; n: number }>();
  const points = await env.WARPLETS.prepare(
    `${REWARD_TOTALS} SELECT post_id,SUM(points) AS points FROM earned WHERE post_id IN (${placeholders}) GROUP BY post_id`,
  )
    .bind(...ids)
    .all<{ post_id: string; points: number }>();
  return rows.map((row) => {
    const local = interactions.results.filter((i) => i.post_id === row.id);
    const count = (kind: string) => local.find((i) => i.kind === kind)?.n ?? 0;
    return {
      id: row.id,
      member_id: row.member_id,
      username: row.username,
      avatar: row.avatar,
      fid: row.fid,
      text: row.text,
      embeds: JSON.parse(row.embeds_json),
      cast_hash: row.cast_hash,
      created_at: row.created_at,
      submitted_at: row.submitted_at,
      kind: row.kind,
      likes: row.likes + count("like"),
      comments: row.comments + count("comment"),
      recasts: row.recasts + count("recast") + count("quote"),
      points: points.results.find((p) => p.post_id === row.id)?.points ?? 0,
      rank: row.rank,
    };
  });
}
async function feed(context: Context, member?: Member) {
  const url = new URL(context.request.url),
    sort = url.searchParams.get("sort") || "trending";
  // Compatibility for older clients: the automatic holder feed is retired.
  if (url.searchParams.get("section") === "bonus")
    return { posts: [], next: null, section: "bonus" };
  const section = "manual";
  const offset = Math.min(
    10000,
    Math.max(0, Number(url.searchParams.get("offset")) || 0),
  );
  const search = (url.searchParams.get("q") || "").slice(0, 120).trim();
  const values: unknown[] = [Date.now() - DAY];
  let where = "p.submitted_at>=?";
  if (search) {
    where =
      "p.submitted_at IS NOT NULL AND p.id IN (SELECT post_id FROM social_search WHERE social_search MATCH ?)";
    values[0] = '"' + search.replaceAll('"', '""') + '"';
  }
  if (member) {
    where += ` AND m.group_id NOT IN (SELECT target_id FROM social_mutes WHERE member_id IN (${FAMILY}))`;
    values.push(member.group_id);
  }
  const rows = await context.env.WARPLETS.prepare(
    `SELECT p.*,m.username,m.avatar,m.group_id FROM social_posts p JOIN social_members m ON m.id=p.member_id WHERE ${where} AND p.status='visible' AND m.status='active' ORDER BY COALESCE(p.submitted_at,p.created_at) DESC LIMIT 500`,
  )
    .bind(...values)
    .all<PostRow>();
  const posts = await hydrate(context.env, rows.results);
  posts.sort((a, b) =>
    sort === "newest"
      ? (b.submitted_at ?? b.created_at) - (a.submitted_at ?? a.created_at)
      : sort === "points"
        ? b.points - a.points || b.created_at - a.created_at
        : trendScore(
            b.likes + 3 * b.comments + 3 * b.recasts,
            b.submitted_at ?? b.created_at,
            b.rank,
          ) -
            trendScore(
              a.likes + 3 * a.comments + 3 * a.recasts,
              a.submitted_at ?? a.created_at,
              a.rank,
            ) || b.created_at - a.created_at,
  );
  return {
    posts: posts.slice(offset, offset + 20),
    next: offset + 20 < posts.length ? offset + 20 : null,
    section,
  };
}
async function publish(
  env: SocialEnv,
  member: Member,
  session: AppSession,
  body: Body,
) {
  const id = operationId(body.operationId),
    source =
      body.source === "signer"
        ? "signer"
        : body.source === "cast"
          ? "cast"
          : "local";
  const payload = JSON.stringify({
    source,
    text: body.text ?? "",
    castHash: body.castHash ?? null,
    quoteId: body.quoteId ?? null,
  });
  const existing = await env.WARPLETS.prepare(
    "SELECT * FROM social_operations WHERE id=?",
  )
    .bind(id)
    .first<{
      member_id: string;
      payload_json: string;
      state: string;
      cast_hash: string | null;
    }>();
  if (
    existing &&
    (existing.member_id !== member.id || existing.payload_json !== payload)
  )
    throw new SocialError(
      "Operation ID belongs to a different submission",
      409,
    );
  if (existing?.state === "complete") {
    await award(
      env,
      member,
      session,
      "post",
      `post:${existing.cast_hash || id}`,
      existing.cast_hash || id,
    );
    return { id: existing.cast_hash || id };
  }
  if (!existing) {
    const inserted = await env.WARPLETS.prepare(
      `INSERT INTO social_operations(id,member_id,kind,payload_json,created_at,updated_at) SELECT ?,?,'post',?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM social_members WHERE group_id=? AND next_post_at>?)
      AND NOT EXISTS(SELECT 1 FROM social_operations WHERE member_id IN (${FAMILY}) AND kind='post' AND (state IN ('pending','publishing') OR (state='failed' AND json_extract(payload_json,'$.source')='signer')))`,
    )
      .bind(
        id,
        member.id,
        payload,
        Date.now(),
        Date.now(),
        member.group_id,
        Date.now(),
        member.group_id,
      )
      .run();
    if (!inserted.meta.changes)
      throw new SocialError(
        "Your post is not available yet, or another submission needs to finish",
        409,
      );
  }
  // Claim this operation; interrupted attempts can retry with the SAME id after the lease.
  const claim = await env.WARPLETS.prepare(
    "UPDATE social_operations SET state='publishing',updated_at=? WHERE id=? AND (state IN ('pending','failed') OR (state='publishing' AND updated_at<?)) RETURNING cast_hash",
  )
    .bind(Date.now(), id, Date.now() - 60_000)
    .first<{ cast_hash: string | null }>();
  if (!claim)
    throw new SocialError(
      "This submission is still processing. Retry shortly.",
      409,
    );
  let publishedHash = claim.cast_hash;
  try {
    let postId = id;
    if (source !== "local") {
      if (!session.farcasterFid)
        throw new SocialError("Sign in with Farcaster to submit a cast", 401);
      let hash =
        publishedHash || (source === "cast" ? str(body.castHash, 42) : null);
      if (!hash) {
        const signer = await requiredSigner(env, member, session);
        const text = str(body.text, 1024);
        if (!text) throw new SocialError("Write something first");
        const embeds: Array<
          { url: string } | { cast_id: { hash: string; fid: number } }
        > = [];
        if (body.quoteId) {
          const quoted = await postRow(env, str(body.quoteId, 80));
          embeds.push(
            quoted.cast_hash && quoted.fid
              ? { cast_id: { hash: quoted.cast_hash, fid: quoted.fid } }
              : { url: `https://social.10x.meme/post/${quoted.id}` },
          );
        }
        const result = await neynar<{ cast: Cast }>(env, "cast", {
          signer_uuid: signer,
          text,
          embeds,
          idem: id.replaceAll("-", "").slice(0, 16),
        });
        hash = result.cast.hash;
        publishedHash = hash;
        await env.WARPLETS.prepare(
          "UPDATE social_operations SET cast_hash=? WHERE id=?",
        )
          .bind(hash, id)
          .run();
      }
      const cast = await fetchCast(env, hash);
      validateCast(cast, session.farcasterFid);
      postId = await saveCast(env, cast, member);
    } else {
      const text = str(body.text, 2000);
      if (!text) throw new SocialError("Write something first");
      let embeds: string[] = [];
      if (body.quoteId) {
        const quoted = await postRow(env, str(body.quoteId, 80));
        embeds = [`https://social.10x.meme/post/${quoted.id}`];
      }
      await env.WARPLETS.prepare(
        "INSERT OR IGNORE INTO social_posts(id,member_id,text,embeds_json,kind,created_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          id,
          member.id,
          text,
          JSON.stringify(embeds),
          body.quoteId ? "quote" : "original",
          Date.now(),
        )
        .run();
    }
    const { config } = await socialConfig(env.WARPLETS),
      { evidence: e } = await evidence(env, member, session);
    const boost = calculateBoost(config, e);
    const prior = await env.WARPLETS.prepare(
      "SELECT 1 FROM social_submissions WHERE post_id=?",
    )
      .bind(postId)
      .first();
    if (!prior)
      await env.WARPLETS.batch([
        env.WARPLETS.prepare(
          "INSERT INTO social_submissions(post_id,member_id,created_at) VALUES(?,?,?)",
        ).bind(postId, member.id, Date.now()),
        env.WARPLETS.prepare(
          "UPDATE social_posts SET rank=?,context_bonus=? WHERE id=?",
        ).bind(boost.ranking, e.context ? config.boosts.context : 0, postId),
        env.WARPLETS.prepare(
          "UPDATE social_operations SET state='complete',cast_hash=?,error=NULL,updated_at=? WHERE id=?",
        ).bind(postId === id ? null : postId, Date.now(), id),
      ]);
    else
      await env.WARPLETS.prepare(
        "UPDATE social_operations SET state='complete',cast_hash=?,updated_at=? WHERE id=?",
      )
        .bind(postId === id ? null : postId, Date.now(), id)
        .run();
    await award(env, member, session, "post", `post:${postId}`, postId);
    return { id: postId };
  } catch (error) {
    // Unknown provider outcomes remain resumable with the same idempotency key.
    await env.WARPLETS.prepare(
      "UPDATE social_operations SET state='failed',error=?,updated_at=? WHERE id=?",
    )
      .bind(
        error instanceof Error ? error.message : "Publication failed",
        Date.now(),
        id,
      )
      .run();
    if (String(error).includes("social_cooldown"))
      throw new SocialError(
        "Your next post is available 24 hours after the previous submission",
        409,
      );
    throw error;
  }
}
async function interact(
  env: SocialEnv,
  member: Member,
  session: AppSession,
  body: Body,
) {
  const post = await postRow(env, str(body.postId, 80)),
    kind = str(body.kind, 12) as SocialAction;
  if (!["like", "comment", "quote", "recast"].includes(kind))
    throw new SocialError("Unknown interaction");
  const text =
    kind === "comment" || kind === "quote" ? str(body.text, 1024) : "";
  if ((kind === "comment" || kind === "quote") && text.length < 3)
    throw new SocialError("Add a meaningful comment or quote");
  async function rewardInteraction(createdAt: number) {
    const earnedDay = utcDay(createdAt);
    if (post.group_id !== member.group_id) {
      await award(
        env,
        member,
        session,
        kind,
        `${kind}:${post.id}`,
        post.id,
        earnedDay,
      );
      if (["comment", "quote", "recast"].includes(kind))
        for (let unit = 0; unit < 2; unit++)
          await award(
            env,
            member,
            session,
            "explore",
            `engage:${earnedDay}:${post.id}:${unit}`,
            post.id,
            earnedDay,
          );
    }
  }
  const old = await env.WARPLETS.prepare(
    `SELECT * FROM social_interactions WHERE member_id IN (${FAMILY}) AND post_id=? AND kind=? LIMIT 1`,
  )
    .bind(member.group_id, post.id, kind)
    .first<{
      id: string;
      text: string;
      delivery: string;
      cast_hash: string | null;
      native: number;
      created_at: number;
    }>();
  if (old && ["local", "confirmed"].includes(old.delivery)) {
    await rewardInteraction(old.created_at);
    return { delivery: old.delivery };
  }
  if (old && old.text !== text)
    throw new SocialError(
      "Retry with the original text to avoid a duplicate",
      409,
    );
  const native = old
    ? old.native === 1
    : body.native === true && !!post.cast_hash;
  let id = old?.id ?? crypto.randomUUID();
  await env.WARPLETS.prepare(
    "INSERT OR IGNORE INTO social_interactions(id,member_id,post_id,kind,text,delivery,native,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      member.id,
      post.id,
      kind,
      text,
      native ? "pending" : "local",
      native ? 1 : 0,
      Date.now(),
    )
    .run();
  const canonical = await env.WARPLETS.prepare(
    `SELECT id,delivery,native FROM social_interactions WHERE member_id IN (${FAMILY}) AND post_id=? AND kind=? ORDER BY created_at,id LIMIT 1`,
  )
    .bind(member.group_id, post.id, kind)
    .first<{ id: string; delivery: string; native: number }>();
  if (!canonical) throw new SocialError("Interaction could not be saved", 503);
  id = canonical.id;
  if (canonical.native !== Number(native))
    throw new SocialError(
      "This action already uses a different delivery method",
      409,
    );
  if (native) {
    if (canonical.delivery === "confirmed") {
      await rewardInteraction(Date.now());
      return { delivery: "confirmed" };
    }
    const signer = await requiredSigner(env, member, session);
    const claim = await env.WARPLETS.prepare(
      "UPDATE social_interactions SET delivery='publishing',attempted_at=? WHERE id=? AND (delivery IN ('pending','failed') OR (delivery='publishing' AND attempted_at<?)) RETURNING id",
    )
      .bind(Date.now(), id, Date.now() - 60_000)
      .first();
    if (!claim)
      throw new SocialError("Interaction is processing. Retry shortly.", 409);
    try {
      let hash: string | null = null;
      if (kind === "like" || kind === "recast")
        await neynar(env, "reaction", {
          signer_uuid: signer,
          reaction_type: kind,
          target: post.cast_hash,
          target_author_fid: post.fid,
          idem: id.replaceAll("-", "").slice(0, 16),
        });
      else {
        const result = await neynar<{ cast: Cast }>(env, "cast", {
          signer_uuid: signer,
          text,
          ...(kind === "comment"
            ? { parent: post.cast_hash }
            : {
                embeds: [{ cast_id: { hash: post.cast_hash, fid: post.fid } }],
              }),
          idem: id.replaceAll("-", "").slice(0, 16),
        });
        hash = result.cast.hash;
      }
      await env.WARPLETS.prepare(
        "UPDATE social_interactions SET delivery='confirmed',cast_hash=? WHERE id=?",
      )
        .bind(hash, id)
        .run();
      // Reconcile aggregate counts so the just-published action appears once.
      await fetchCast(env, post.cast_hash!)
        .then((c) => saveCast(env, c))
        .catch(() => undefined);
    } catch (error) {
      await env.WARPLETS.prepare(
        "UPDATE social_interactions SET delivery='failed' WHERE id=?",
      )
        .bind(id)
        .run();
      throw error;
    }
  }
  await rewardInteraction(Date.now());
  return { delivery: native ? "confirmed" : "local" };
}
export async function handleSocial(context: Context): Promise<Response> {
  try {
    const { request, env } = context,
      url = new URL(request.url),
      route = url.pathname.replace(/^\/api\/social\/?/, "").replace(/\/$/, "");
    const mutate = request.method !== "GET";
    if (mutate) {
      if (request.method !== "POST")
        throw new SocialError("Method not allowed", 405);
      const origin = requireSameOrigin(request);
      if (origin) return origin;
      if (request.headers.get("sec-fetch-site") === "cross-site")
        throw new SocialError("Cross-site request rejected", 403);
    }
    const { config, version } = await socialConfig(env.WARPLETS);
    if (route === "config" && !mutate)
      return jsonSecure({
        config,
        version,
        checkinAddress: env.SOCIAL_CHECKIN_ADDRESS ?? null,
        chainId: 8453,
        signerConfigured: !!(
          env.NEYNAR_API_KEY &&
          env.SOCIAL_APP_FID &&
          env.SOCIAL_SIGNER_SPONSOR_PRIVATE_KEY
        ),
        contextBonusAvailable: false,
      });
    if (route === "leaderboard" && !mutate) {
      const range = url.searchParams.get("range"),
        from =
          range === "today"
            ? utcDay()
            : range === "week"
              ? utcDay(Date.now() - 6 * DAY)
              : "0000";
      const rows = await env.WARPLETS.prepare(
        `${REWARD_TOTALS} SELECT e.group_id AS id,MIN(m.username) AS username,MAX(m.avatar) AS avatar,ROUND(SUM(e.points),2) AS points FROM earned e JOIN social_members m ON m.id=e.member_id WHERE e.day>=? AND m.status='active' GROUP BY e.group_id ORDER BY points DESC,e.group_id LIMIT 100`,
      )
        .bind(from)
        .all();
      return jsonSecure({ members: rows.results });
    }
    let auth: Awaited<ReturnType<typeof socialMember>> | null = null;
    try {
      auth = await socialMember(request, env);
    } catch (error) {
      if (!(error instanceof SocialError) || error.status !== 401) throw error;
    }
    if (route === "feed" && !mutate)
      return jsonSecure(await feed(context, auth?.member));
    if (route === "embed/cast" && !mutate) {
      const parent = await postRow(
        env,
        str(url.searchParams.get("postId"), 100),
      );
      return jsonSecure({
        cast: await resolveCastEmbed(
          env,
          parent,
          str(url.searchParams.get("url"), 2000),
          request.headers.get("CF-Connecting-IP") || "local",
        ),
      });
    }
    if (route.startsWith("post/") && !mutate) {
      const row = await postRow(env, route.slice(5));
      const comments = await env.WARPLETS.prepare(
        "SELECT i.id,i.text,i.delivery,i.created_at,m.username,m.avatar FROM social_interactions i JOIN social_members m ON m.id=i.member_id WHERE i.post_id=? AND i.kind='comment' AND i.delivery IN ('local','confirmed') AND i.active=1 AND m.status='active' ORDER BY i.created_at LIMIT 100",
      )
        .bind(row.id)
        .all();
      return jsonSecure({
        post: (await hydrate(env, [row]))[0],
        comments: comments.results,
      });
    }
    if (!auth)
      throw new SocialError(
        "Connect Farcaster or verify your wallet to continue",
        401,
      );
    const { member, session } = auth;
    if (mutate) {
      const limited = await rateLimit(
        env.WARPLETS_KV,
        "social-write",
        member.group_id,
        90,
        60,
      );
      if (!limited.allowed)
        throw new SocialError("Please slow down and try again shortly", 429);
    }
    let body: Body = {};
    if (mutate) {
      const parsed = await readJsonBodyWithLimit<Body>(request, 16_384);
      if (!parsed.ok) return parsed.response;
      if (
        !parsed.value ||
        typeof parsed.value !== "object" ||
        Array.isArray(parsed.value)
      )
        throw new SocialError("Invalid request");
      body = parsed.value;
    }
    if (route === "me" && !mutate) {
      const ev = await evidence(env, member, session),
        boost = calculateBoost(config, ev.evidence);
      const totals = await env.WARPLETS.prepare(
        `${REWARD_TOTALS} SELECT COALESCE(SUM(points),0) AS points,COALESCE(SUM(CASE WHEN day=? THEN points ELSE 0 END),0) AS today,COUNT(CASE WHEN day=? AND action='explore' THEN 1 END) AS explored FROM earned WHERE group_id=?`,
      )
        .bind(utcDay(), utcDay(), member.group_id)
        .first();
      const history = await env.WARPLETS.prepare(
        `${REWARD_TOTALS} SELECT action,points,multiplier,day,created_at FROM earned WHERE group_id=? ORDER BY created_at DESC LIMIT 30`,
      )
        .bind(member.group_id)
        .all();
      const operations = await env.WARPLETS.prepare(
        `SELECT id,payload_json,state,error,cast_hash FROM social_operations WHERE member_id IN (${FAMILY}) AND state!='complete' ORDER BY created_at DESC LIMIT 5`,
      )
        .bind(member.group_id)
        .all();
      return jsonSecure({
        member,
        evidence: ev.evidence,
        evidenceUpdatedAt: ev.updatedAt,
        boost,
        totals,
        history: history.results,
        operations: operations.results,
      });
    }
    if (route === "casts" && !mutate) {
      if (!session.farcasterFid)
        throw new SocialError("Connect Farcaster first");
      const result = await neynar<{ casts: Cast[] }>(
        env,
        `feed/user/casts?fid=${session.farcasterFid}&limit=50&include_replies=false`,
      );
      return jsonSecure({
        casts: result.casts
          .filter(
            (c) => !c.parent_hash && Date.parse(c.timestamp) > Date.now() - DAY,
          )
          .map((c) => ({ hash: c.hash, text: c.text, timestamp: c.timestamp })),
      });
    }
    if (!mutate) throw new SocialError("Not found", 404);
    if (route === "publish")
      return jsonSecure(await publish(env, member, session, body));
    if (route === "interact")
      return jsonSecure(await interact(env, member, session, body));
    if (route === "visit") {
      await award(env, member, session, "visit", `visit:${utcDay()}`);
      return jsonSecure({ ok: true });
    }
    if (route === "refresh-evidence")
      return jsonSecure(await refreshEvidence(env, member, session));
    if (route === "signer") {
      if (!session.farcasterFid)
        throw new SocialError("Connect Farcaster first");
      return jsonSecure(
        await startSigner(env, member, session.farcasterFid, url.origin),
      );
    }
    if (route === "checkin") {
      if (!session.walletAddress)
        throw new SocialError("Verify a wallet before checking in", 401);
      const tx = str(body.txHash, 66),
        verified = await verifyCheckin(env, tx, session.walletAddress);
      if (verified.day !== utcDay())
        throw new SocialError(
          "This transaction is not from today's UTC check-in period",
        );
      await env.WARPLETS.prepare(
        `INSERT OR IGNORE INTO social_checkins(tx_hash,member_id,wallet,day,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM social_checkins WHERE member_id IN (${FAMILY}) AND day=?)`,
      )
        .bind(
          tx.toLowerCase(),
          member.id,
          session.walletAddress,
          verified.day,
          verified.timestamp,
          member.group_id,
          verified.day,
        )
        .run();
      await award(
        env,
        member,
        session,
        "checkin",
        `checkin:${verified.day}`,
        null,
        verified.day,
      );
      return jsonSecure({ ok: true });
    }
    if (route === "view/start") {
      const post = await postRow(env, str(body.postId, 80));
      const id = crypto.randomUUID();
      if (post.group_id === member.group_id) return jsonSecure({ id: null });
      await env.WARPLETS.prepare(
        "INSERT INTO social_views(id,member_id,post_id,started_at) VALUES(?,?,?,?)",
      )
        .bind(id, member.id, post.id, Date.now())
        .run();
      return jsonSecure({ id });
    }
    if (route === "view/complete") {
      let row = await env.WARPLETS.prepare(
        "UPDATE social_views SET completed_at=? WHERE id=? AND member_id=? AND completed_at IS NULL AND started_at<=? AND started_at>? AND NOT EXISTS(SELECT 1 FROM social_views WHERE member_id=? AND completed_at>?) RETURNING post_id,completed_at",
      )
        .bind(
          Date.now(),
          str(body.id, 80),
          member.id,
          Date.now() - 5000,
          Date.now() - 60_000,
          member.id,
          Date.now() - 5000,
        )
        .first<{ post_id: string; completed_at: number }>();
      row ??= await env.WARPLETS.prepare(
        "SELECT post_id,completed_at FROM social_views WHERE id=? AND member_id=? AND completed_at IS NOT NULL",
      )
        .bind(str(body.id, 80), member.id)
        .first<{ post_id: string; completed_at: number }>();
      if (row) {
        await postRow(env, row.post_id);
        await award(
          env,
          member,
          session,
          "explore",
          `view:${utcDay(row.completed_at)}:${row.post_id}`,
          row.post_id,
          utcDay(row.completed_at),
        );
      }
      return jsonSecure({ ok: !!row });
    }
    if (route === "preferences") {
      await env.WARPLETS.prepare(
        "UPDATE social_members SET bonus_opt_out=? WHERE group_id=?",
      )
        .bind(body.bonusOptOut === true ? 1 : 0, member.group_id)
        .run();
      if (body.bonusOptOut === true)
        await env.WARPLETS.prepare(
          `DELETE FROM social_bonus WHERE post_id IN(SELECT id FROM social_posts WHERE member_id IN (${FAMILY}))`,
        )
          .bind(member.group_id)
          .run();
      return jsonSecure({ ok: true });
    }
    if (route === "report") {
      const post = await postRow(env, str(body.postId, 80)),
        reason = str(body.reason, 500);
      if (reason.length < 3) throw new SocialError("Provide a reason");
      await env.WARPLETS.prepare(
        "INSERT OR IGNORE INTO social_reports(id,member_id,post_id,reason,created_at) VALUES(?,?,?,?,?)",
      )
        .bind(crypto.randomUUID(), member.id, post.id, reason, Date.now())
        .run();
      return jsonSecure({ ok: true });
    }
    if (route === "mute") {
      const post = await postRow(env, str(body.postId, 80));
      await env.WARPLETS.prepare(
        "INSERT OR IGNORE INTO social_mutes(member_id,target_id) VALUES(?,?)",
      )
        .bind(member.id, post.group_id)
        .run();
      return jsonSecure({ ok: true });
    }
    if (route === "delete") {
      const post = await postRow(env, str(body.postId, 80));
      if (post.group_id !== member.group_id)
        throw new SocialError("You can only remove your own post", 403);
      await env.WARPLETS.prepare(
        "UPDATE social_posts SET status='deleted' WHERE id=?",
      )
        .bind(post.id)
        .run();
      return jsonSecure({ ok: true });
    }
    throw new SocialError("Not found", 404);
  } catch (error) {
    if (error instanceof SocialError)
      return jsonSecure({ error: error.message }, { status: error.status });
    console.error("social_api", error);
    return jsonSecure(
      { error: "Social is temporarily unavailable. Please retry shortly." },
      { status: 503 },
    );
  }
}
