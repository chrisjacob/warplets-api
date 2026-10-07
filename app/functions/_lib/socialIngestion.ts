import { DAY } from "../../shared/social.js";
import { socialConfig, type SocialEnv } from "./socialStore.js";
import { saveCast, fetchCast } from "./socialProvider.js";

export async function ingestSocial(env: SocialEnv, force = false) {
  const { config } = await socialConfig(env.WARPLETS);
  if (!env.NEYNAR_API_KEY || (!config.ingestionEnabled && !force))
    return { status: "disabled" };
  const db = env.WARPLETS,
    now = Date.now(),
    lease = now + 5 * 60_000;
  await db
    .prepare("INSERT OR IGNORE INTO social_jobs(id) VALUES('post-refresh')")
    .run();
  const claimed = await db
    .prepare(
      "UPDATE social_jobs SET lease_until=? WHERE id='post-refresh' AND lease_until<? AND (updated_at<? OR ?=1) RETURNING id",
    )
    .bind(lease, now, now - 15 * 60_000, force ? 1 : 0)
    .first<{ id: string }>();
  if (!claimed) return { status: "not_due" };
  let requests = 0,
    saved = 0;
  try {
    // Only refresh casts explicitly submitted to Social. Never scan holder timelines.
    const manual = await db
      .prepare(
        "SELECT cast_hash FROM social_posts WHERE submitted_at>? AND cast_hash IS NOT NULL AND status='visible' ORDER BY refreshed_at ASC LIMIT 2",
      )
      .bind(now - DAY)
      .all<{ cast_hash: string }>();
    for (const post of manual.results.slice(0, config.requestsPerRun)) {
      requests++;
      await saveCast(env, await fetchCast(env, post.cast_hash));
      saved++;
    }
    await db.batch([
      db.prepare("DELETE FROM social_views WHERE started_at<?").bind(now - DAY),
      db
        .prepare(
          "UPDATE social_jobs SET lease_until=0,updated_at=?,error=NULL WHERE id='post-refresh' AND lease_until=?",
        )
        .bind(now, lease),
    ]);
    return { status: "complete", requests, saved };
  } catch (error) {
    await db
      .prepare(
        "UPDATE social_jobs SET lease_until=0,error=?,updated_at=? WHERE id='post-refresh' AND lease_until=?",
      )
      .bind(
        error instanceof Error ? error.message : "Ingestion failed",
        now,
        lease,
      )
      .run();
    throw error;
  }
}
