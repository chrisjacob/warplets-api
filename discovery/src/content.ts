import { z } from "zod";
import { ContentAppealRequest, ContentCampaign, ContentCampaignList, ContentCampaignRequest, ContentEvent, ContentPage, ContentRecord, ContentReviewRequest, ContentSnapshot, ContentStatus, ContentSubmissionRequest, PublicContentCampaign, PublicContentPage } from "./content-model";
import { canonicalContentUrl, ContentError } from "./content-url";
import { hashJson } from "./solana";
import type { requireContentIdentity } from "./identity";
import { contentVisibilityHeld } from "./content-reports";
type Principal = Awaited<ReturnType<typeof requireContentIdentity>>;
type Snapshot = z.infer<typeof ContentSnapshot>;
type Event = z.infer<typeof ContentEvent>;
type Row = { id: string; campaign_id: string; identity_id: string; canonical_url: string; created_at: string; updated_at: string; status: string; revision: number; request_hash: string; snapshot: string; event_hash: string };
const day = (at: Date) => [at.toISOString().slice(0, 10) + "T00:00:00.000Z", new Date(at.getTime() + 86400000).toISOString().slice(0, 10) + "T00:00:00.000Z"];
function fail(message: string, status = 409): never { throw new ContentError(message, status); }
const eventHash = ({ hash: _hash, ...event }: Event) => hashJson(event);
const stable = ({ status: _s, revision: _r, updated_at: _u, ...snapshot }: Snapshot) => snapshot;
const sessionSql = "EXISTS(SELECT 1 FROM tenx_identity_sessions WHERE token_hash=? AND identity_id=? AND origin=? AND expires_at>? AND revoked_at IS NULL)";
const sessionArgs = (p: Principal, now: string) => [p.token_hash, p.identity_id, p.origin, now];
function transition(status: string, action: Event["action"], next: string) {
  if (action === "appeal") return ["FLAGGED", "REJECTED"].includes(status) && next === "APPEALED";
  return action === "review" && (["PENDING", "FLAGGED", "APPEALED"].includes(status) ? ["VISIBLE", "FLAGGED", "REJECTED"].includes(next) && next !== status : status === "VISIBLE" && ["FLAGGED", "REJECTED"].includes(next));
}
export async function contentCampaign(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM tenx_content_campaigns WHERE id=?").bind(z.uuid().parse(id)).first<{ id: string; created_at: string; ends_at: string; request_hash: string; record: string }>();
  if (!row) return null;
  const record = ContentCampaign.parse(JSON.parse(row.record)), { record_hash, ...value } = record;
  if (await hashJson(value) !== record_hash || row.id !== record.id || row.created_at !== record.starts_at || row.ends_at !== record.ends_at || row.request_hash !== record.request_hash || Date.parse(record.ends_at) - Date.parse(record.starts_at) !== 10 * 86400000) fail("content_campaign_integrity_failed", 503);
  return record;
}
export async function createContentCampaign(db: D1Database, raw: unknown, at = new Date()) {
  const input = ContentCampaignRequest.parse(raw), request_hash = await hashJson(input), previous = await contentCampaign(db, input.request_id);
  if (previous) { if (previous.request_hash !== request_hash) fail("content_request_conflict"); return previous; }
  const value = { id: input.request_id, title: input.title, og_address: input.og_address, chain: "solana" as const, starts_at: at.toISOString(), ends_at: new Date(at.getTime() + 10 * 86400000).toISOString(), kind: "local_review_only" as const, rewards_enabled: false as const, reason: input.reason, request_hash };
  const record = ContentCampaign.parse({ ...value, record_hash: await hashJson(value) });
  await db.prepare(`INSERT OR IGNORE INTO tenx_content_campaigns(id,created_at,ends_at,request_hash,record)
    SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM tenx_content_campaigns WHERE ends_at>?)<10
    AND (SELECT count(*) FROM tenx_content_campaigns WHERE created_at>=? AND created_at<?)<20`)
    .bind(record.id, record.starts_at, record.ends_at, request_hash, JSON.stringify(record), record.starts_at, ...day(at)).run();
  const saved = await contentCampaign(db, input.request_id);
  if (!saved) fail("content_campaign_limit", 429);
  if (saved.request_hash !== request_hash) fail("content_request_conflict");
  return saved;
}
async function rowFor(db: D1Database, id: string) { return db.prepare("SELECT * FROM tenx_content_submissions WHERE id=?").bind(z.uuid().parse(id)).first<Row>(); }
async function checkSnapshot(row: Row) {
  const snapshot = ContentSnapshot.parse(JSON.parse(row.snapshot));
  if (snapshot.id !== row.id || snapshot.identity_id !== row.identity_id || snapshot.campaign_id !== row.campaign_id || snapshot.content.canonical_url !== row.canonical_url || snapshot.status !== row.status || snapshot.revision !== row.revision || snapshot.created_at !== row.created_at || snapshot.updated_at !== row.updated_at) fail("content_snapshot_integrity_failed", 503);
  return snapshot;
}
export async function contentRecord(db: D1Database, id: string, owner?: string) {
  // One SQLite statement reads the projection and ordered history at the same
  // snapshot, so a concurrent review cannot produce a false integrity failure.
  const row = await db.prepare(`SELECT s.*,(SELECT json_group_array(json_object('id',id,'submission_id',submission_id,'revision',revision,'created_at',created_at,'request_hash',request_hash,'event',event))
    FROM (SELECT * FROM tenx_content_events WHERE submission_id=s.id ORDER BY revision LIMIT 21)) AS history
    FROM tenx_content_submissions s WHERE s.id=?`).bind(z.uuid().parse(id)).first<Row & { history: string }>();
  if (!row || (owner !== undefined && owner !== row.identity_id)) return null;
  const snapshot = await checkSnapshot(row);
  const rows = JSON.parse(row.history) as { id: string; submission_id: string; revision: number; created_at: string; request_hash: string; event: string }[];
  if (rows.length !== snapshot.revision + 1) fail("content_history_integrity_failed", 503);
  const events: Event[] = [];
  for (const item of rows) {
    const event = ContentEvent.parse(JSON.parse(item.event)), previous = events.at(-1);
    const metadataMatches = event.id === item.id && event.submission_id === id && event.revision === item.revision && event.created_at === item.created_at && event.request_hash === item.request_hash;
    const snapshotMatches = event.revision === events.length && event.snapshot.revision === event.revision && event.snapshot.id === id && event.snapshot.updated_at === event.created_at;
    if (!metadataMatches || !snapshotMatches || event.hash !== await eventHash(event) || event.previous_hash !== (previous?.hash ?? null)) fail("content_history_integrity_failed", 503);
    if (previous && (event.created_at < previous.created_at || !transition(previous.snapshot.status, event.action, event.snapshot.status) || await hashJson(stable(event.snapshot)) !== await hashJson(stable(previous.snapshot)))) fail("content_history_integrity_failed", 503);
    if (!previous && (event.action !== "submit" || !["PENDING", "FLAGGED"].includes(event.snapshot.status))) fail("content_history_integrity_failed", 503);
    if (event.actor !== (event.action === "review" ? "local_operator" : snapshot.identity_id)) fail("content_history_integrity_failed", 503);
    events.push(event);
  }
  if (events.at(-1)?.hash !== row.event_hash || await hashJson(events.at(-1)!.snapshot) !== await hashJson(snapshot) || events[0]!.request_hash !== row.request_hash) fail("content_history_integrity_failed", 503);
  return ContentRecord.parse({ snapshot, events, visibility_held:await contentVisibilityHeld(db,id), replay: "verified", source_requests: 0 });
}
export async function submitContent(db: D1Database, raw: unknown, p: Principal, at = new Date()) {
  const input = ContentSubmissionRequest.parse(raw), url = canonicalContentUrl(input.url);
  const request_hash = await hashJson({ ...input, url: url.canonical_url, identity_id: p.identity_id });
  const old = await rowFor(db, input.request_id);
  if (old) { if (old.identity_id !== p.identity_id || old.request_hash !== request_hash) fail("content_request_conflict"); return (await contentRecord(db, old.id, p.identity_id))!; }
  const campaign = await contentCampaign(db, input.campaign_id), now = at.toISOString();
  if (!campaign || campaign.starts_at > now || campaign.ends_at <= now) fail("content_campaign_not_open");
  const repeated = Boolean(await db.prepare("SELECT id FROM tenx_content_submissions WHERE canonical_url=? LIMIT 1").bind(url.canonical_url).first());
  const snapshot = ContentSnapshot.parse({ id: input.request_id, campaign_id: input.campaign_id, identity_id: p.identity_id, created_at: now, updated_at: now, revision: 0, status: repeated ? "FLAGGED" : "PENDING", content: { ...url, category: input.category, author_claim: input.author_claim, comment: input.comment, permission_to_feature: true, rights_confirmed: true }, authorship: "unverified", engagement: "unavailable", reward_eligible: false });
  const event = await makeEvent(input.request_id, snapshot, p.identity_id, "submit", repeated ? "Cross-campaign URL reuse requires review" : "Contributor submitted a URL for review", request_hash, null);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_content_submissions(id,campaign_id,identity_id,canonical_url,created_at,updated_at,status,revision,request_hash,snapshot,event_hash)
      SELECT ?,?,?,?,?,?,?,0,?,?,? WHERE ${sessionSql}
      AND EXISTS(SELECT 1 FROM tenx_content_campaigns WHERE id=? AND created_at<=? AND ends_at>?)
      AND (SELECT count(*) FROM tenx_content_submissions WHERE created_at>=? AND created_at<?)<100
      AND (SELECT count(*) FROM tenx_content_submissions WHERE identity_id=? AND created_at>=? AND created_at<?)<10
      AND (SELECT count(*) FROM tenx_content_events WHERE created_at>=? AND created_at<?)<300
      AND EXISTS(SELECT 1 FROM tenx_content_submissions WHERE canonical_url=?)=?`)
      .bind(snapshot.id, snapshot.campaign_id, p.identity_id, url.canonical_url, now, now, snapshot.status, request_hash, JSON.stringify(snapshot), event.hash, ...sessionArgs(p, now), snapshot.campaign_id, now, now, ...day(at), p.identity_id, ...day(at), ...day(at), url.canonical_url, repeated ? 1 : 0),
    db.prepare(`INSERT OR IGNORE INTO tenx_content_events(id,submission_id,revision,created_at,request_hash,event)
      SELECT ?,?,0,?,?,? WHERE EXISTS(SELECT 1 FROM tenx_content_submissions WHERE id=? AND request_hash=? AND event_hash=? AND revision=0)`)
      .bind(event.id, snapshot.id, now, request_hash, JSON.stringify(event), snapshot.id, request_hash, event.hash),
  ]);
  const saved = await rowFor(db, snapshot.id);
  if (!saved) {
    const duplicate = await db.prepare("SELECT id FROM tenx_content_submissions WHERE campaign_id=? AND canonical_url=?").bind(snapshot.campaign_id, url.canonical_url).first();
    if (duplicate) fail("content_url_already_submitted");
    fail("content_admission_limit_or_session_changed", 429);
  }
  if (saved.identity_id !== p.identity_id || saved.request_hash !== request_hash) fail("content_request_conflict");
  return (await contentRecord(db, snapshot.id, p.identity_id))!;
}
async function makeEvent(id: string, snapshot: Snapshot, actor: string, action: Event["action"], reason: string, request_hash: string, previous_hash: string | null) {
  const base = ContentEvent.omit({ hash: true }).parse({ id, submission_id: snapshot.id, revision: snapshot.revision, created_at: snapshot.updated_at, actor, action, reason, request_hash, previous_hash, snapshot });
  return ContentEvent.parse({ ...base, hash: await hashJson(base) });
}
export async function changeContent(db: D1Database, raw: unknown, p: Principal | null, at = new Date()) {
  const input = p ? ContentAppealRequest.parse(raw) : ContentReviewRequest.parse(raw), actor = p?.identity_id ?? "local_operator", action = p ? "appeal" : "review";
  const request_hash = await hashJson({ input, actor, action });
  const existing = await db.prepare("SELECT request_hash,event FROM tenx_content_events WHERE id=?").bind(input.request_id).first<{ request_hash: string; event: string }>();
  if (existing) {
    const event = ContentEvent.parse(JSON.parse(existing.event));
    if (existing.request_hash !== request_hash || event.actor !== actor || event.submission_id !== input.submission_id) fail("content_request_conflict");
    const record = await contentRecord(db, event.submission_id, p?.identity_id);
    if (!record) fail("content_not_found", 404);
    return { event, replay: record.replay };
  }
  const record = await contentRecord(db, input.submission_id, p?.identity_id);
  if (!record) fail("content_not_found", 404);
  const previous = record.snapshot, next = p ? "APPEALED" : ContentReviewRequest.parse(input).decision;
  if (previous.revision !== input.expected_revision) fail("content_revision_conflict");
  if (!transition(previous.status, action, next)) fail("content_invalid_transition");
  const now = at.toISOString(); if (now < previous.updated_at) fail("content_time_conflict");
  const snapshot = ContentSnapshot.parse({ ...previous, status: next, revision: previous.revision + 1, updated_at: now });
  // Reserve the final bounded revision for a hidden state: a publication must
  // never consume the ability to take it down.
  if (snapshot.revision === 19 && next === "VISIBLE") fail("content_final_revision_must_remain_hidden");
  const event = await makeEvent(input.request_id, snapshot, actor, action, input.reason, request_hash, record.events.at(-1)!.hash);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_content_events(id,submission_id,revision,created_at,request_hash,event)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tenx_content_submissions WHERE id=? AND revision=? AND event_hash=?)
      AND (SELECT count(*) FROM tenx_content_events WHERE created_at>=? AND created_at<?)<300
      ${p ? `AND ${sessionSql}` : ""}`)
      .bind(event.id, snapshot.id, snapshot.revision, now, request_hash, JSON.stringify(event), snapshot.id, previous.revision, event.previous_hash, ...day(at), ...(p ? sessionArgs(p, now) : [])),
    db.prepare(`UPDATE tenx_content_submissions SET snapshot=?,revision=?,status=?,updated_at=?,event_hash=?
      WHERE id=? AND revision=? AND event_hash=? AND EXISTS(SELECT 1 FROM tenx_content_events WHERE id=? AND request_hash=? AND event=?)`)
      .bind(JSON.stringify(snapshot), snapshot.revision, next, now, event.hash, snapshot.id, previous.revision, event.previous_hash, event.id, request_hash, JSON.stringify(event)),
  ]);
  const saved = await contentRecord(db, snapshot.id, p?.identity_id);
  const retained = saved?.events.find(e => e.id === event.id);
  if (!retained) fail("content_revision_limit_or_session_changed");
  if (retained.request_hash !== request_hash) fail("content_request_conflict");
  return { event: retained, replay: "verified" as const };
}
function pagination(cursor: string | null) {
  if (!cursor) return ["9999-12-31T23:59:59.999Z", "ffffffff-ffff-ffff-ffff-ffffffffffff"];
  if (cursor.length > 100) fail("content_invalid_cursor", 400);
  const parts = cursor.split("|"); if (parts.length !== 2) fail("content_invalid_cursor", 400);
  return [z.iso.datetime().parse(parts[0]), z.uuid().parse(parts[1])];
}
export async function contentCampaigns(db: D1Database, cursor: string | null, at = new Date()) {
  const [time, id] = pagination(cursor);
  const rows = await db.prepare("SELECT id,created_at FROM tenx_content_campaigns WHERE created_at<? OR (created_at=? AND id<?) ORDER BY created_at DESC,id DESC LIMIT 21").bind(time, time, id).all<{ id: string; created_at: string }>();
  const campaigns = [];
  for (const row of rows.results.slice(0, 20)) {
    const record = (await contentCampaign(db, row.id))!;
    const { reason: _reason, request_hash: _request, record_hash: _hash, ...publicRecord } = record;
    campaigns.push(PublicContentCampaign.parse(publicRecord));
  }
  const last = rows.results[19];
  return ContentCampaignList.parse({ scope: "local_content_review", as_of: at.toISOString(), campaigns, next_cursor: rows.results.length > 20 ? `${last!.created_at}|${last!.id}` : null });
}
export async function contentPage(db: D1Database, filter: { owner?: string; campaign?: string; status?: string; public?: boolean; cursor: string | null }, at = new Date()) {
  const [time, id] = pagination(filter.cursor), clauses = ["(updated_at<? OR (updated_at=? AND id<?))"], values: string[] = [time!, time!, id!];
  if (filter.owner) { clauses.push("identity_id=?"); values.push(z.uuid().parse(filter.owner)); }
  if (filter.campaign) { clauses.push("campaign_id=?"); values.push(z.uuid().parse(filter.campaign)); }
  if (filter.public || filter.status) { clauses.push("status=?"); values.push(filter.public ? "VISIBLE" : ContentStatus.parse(filter.status)); }
  if(filter.public)clauses.push("NOT EXISTS(SELECT 1 FROM tenx_content_reports r WHERE r.submission_id=tenx_content_submissions.id AND r.status='UPHELD')");
  const rows = await db.prepare(`SELECT * FROM tenx_content_submissions WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC,id DESC LIMIT 21`).bind(...values).all<Row>();
  const submissions = [],held_submission_ids:string[]=[];
  for (const row of rows.results.slice(0, 20)) {
    // Public projection checks the complete retained review history too.
    const record = await contentRecord(db, row.id, filter.owner);
    if (!record || (filter.public && (record.snapshot.status !== "VISIBLE"||record.visibility_held))) fail("content_projection_changed_retry", 409);
    if(record.visibility_held)held_submission_ids.push(record.snapshot.id);
    submissions.push(record.snapshot);
  }
  const last = rows.results[19], page = { scope: "local_content_review", as_of: at.toISOString(), submissions, held_submission_ids, next_cursor: rows.results.length > 20 ? `${last!.updated_at}|${last!.id}` : null, rewards_enabled: false };
  return filter.public ? PublicContentPage.parse({ ...page, submissions: submissions.map(({ identity_id: _owner, ...s }) => s) }) : ContentPage.parse(page);
}
