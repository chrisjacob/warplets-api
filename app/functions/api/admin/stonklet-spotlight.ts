import { activateNews, readNews } from "../../_lib/stonkletNews";
import { NEWS_FEEDS, NEWS_IDENTITIES } from "../../_lib/stonkletNewsResearch";
import { newsHistoryCutoff } from "../../../shared/stonkletsNewsDates";
import { readSpotlight, type SpotlightEnv } from "../../_lib/stonkletSpotlight.js";
import { jsonSecure, requireAdminScope, type SecurityEnv } from "../../_lib/security.js";

type Env = SpotlightEnv & SecurityEnv;
export const onRequestGet: PagesFunction<Env> = async context => {
  const auth = await requireAdminScope(context, { scope: "stats:stonklets" });
  if (!auth.ok) return auth.response;
  const db = context.env.WARPLETS;
  const [spotlight, control, runs] = await Promise.all([
    readSpotlight(db, new URL(context.request.url).searchParams.get("thesis"), true),
    db.prepare("SELECT * FROM stonklet_spotlight_control WHERE id=1").first(),
    db.prepare("SELECT * FROM stonklet_spotlight_runs ORDER BY hour DESC LIMIT 168").all(),
  ]);
  const news = await readNews(db, { preview: true });
  const newsRuns = await db.prepare("SELECT * FROM stonklet_news_runs ORDER BY hour DESC LIMIT 168").all();
  const sources = await db.prepare("SELECT * FROM stonklet_news_sources ORDER BY id").all();
  const failures = await db.prepare("SELECT * FROM stonklet_news_jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 100").all();
  const review = await db.prepare("SELECT source_id,reason,COUNT(*) count,MAX(published_at) newest FROM stonklet_news_review GROUP BY source_id,reason").all();
  const pendingReview = await db.prepare("SELECT source_id,canonical_url,headline,published_at,reason,associations_json FROM stonklet_news_review WHERE reason='needs-evidence-review' ORDER BY published_at DESC LIMIT 100").all();
  const marketauxUsage=await db.prepare("SELECT COUNT(*) requests, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM stonklet_marketaux_requests WHERE requested_at>=?").bind(new Date(Date.now()-86400000).toISOString()).first();
  const marketauxControl=await db.prepare("SELECT blocked_until,reason FROM stonklet_marketaux_control WHERE id=1").first();
  const cutoff=new Date(newsHistoryCutoff(Date.now())).toISOString();
  const monthly = await db.prepare(`SELECT l.pair_id,substr(a.published_at,1,7) month,COUNT(DISTINCT a.narrative_key) narratives,MAX(a.published_at) newest FROM stonklet_news_links l JOIN stonklet_news_articles a ON a.id=l.article_id WHERE l.withdrawn_at IS NULL AND a.published_at>=? AND a.published_at<=? GROUP BY l.pair_id,month`).bind(cutoff,new Date().toISOString()).all();
  const sourceCoverage=NEWS_IDENTITIES.map(identity=>({...identity,feeds:NEWS_FEEDS.filter(f=>f.pairIds.includes(identity.pairId)).map(f=>({id:f.id,enabled:f.enabled,owner:f.owner,method:f.method}))}));
  const sourceHealth=await db.prepare(`SELECT source_id,MAX(CASE WHEN status='done' THEN updated_at END) last_success,MAX(updated_at) last_attempt,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_jobs FROM stonklet_news_jobs WHERE hour>=? GROUP BY source_id`).bind(new Date(Date.now()-7*86400000).toISOString().slice(0,13)).all();
  return jsonSecure({ ...spotlight, marketaux:{rolling24h:marketauxUsage,limit:90,control:marketauxControl}, news, newsRuns: newsRuns.results, sources: sources.results,sourceHealth:sourceHealth.results, failures: failures.results, review:review.results,pendingReview:pendingReview.results,storedMonthlyCoverage:monthly.results,sourceCoverage, control, runs: runs.results }, { headers: { "cache-control": "private, no-store" } });
};
export const onRequestPost: PagesFunction<Env> = async context => {
  const auth = await requireAdminScope(context, { scope: "stats:stonklets" });
  if (!auth.ok) return auth.response;
  if (Number(context.request.headers.get("content-length")) > 4096) return jsonSecure({ error: "too_large" }, { status: 413 });
  let body: { mode?: string; withdraw?: string; reason?: string };
  try { body = await context.request.json(); } catch { return jsonSecure({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object") return jsonSecure({ error: "invalid_body" }, { status: 400 });
  const db = context.env.WARPLETS, now = new Date().toISOString();
  if (body.withdraw && typeof body.withdraw === "string" && typeof body.reason === "string" && body.reason.trim().length >= 3 && body.reason.length <= 300) {
    await db.batch([
      db.prepare("UPDATE stonklet_news_links SET withdrawn_at=?,withdrawal_reason=? WHERE id=? AND withdrawn_at IS NULL").bind(now,body.reason.trim(),body.withdraw),
      db.prepare("UPDATE stonklet_spotlight_theses SET withdrawn_at=?,withdrawal_reason=? WHERE id=? AND withdrawn_at IS NULL").bind(now, body.reason.trim(), body.withdraw),
      db.prepare("UPDATE stonklet_spotlight_control SET current_thesis_id=NULL,updated_at=? WHERE current_thesis_id=?").bind(now, body.withdraw),
    ]);
    return jsonSecure({ status: "withdrawn" });
  }
  if (!["off", "shadow", "live"].includes(body.mode ?? "")) return jsonSecure({ error: "invalid_action" }, { status: 400 });
  if (body.mode === "live") {
    if (!await activateNews(db,now)) return jsonSecure({ error: "news_pipeline_not_initialized" }, { status: 409 });
  } else {
    await db.prepare("UPDATE stonklet_spotlight_control SET mode=?,updated_at=? WHERE id=1").bind(body.mode!, now).run();
  }
  return jsonSecure({ mode: body.mode });
};
