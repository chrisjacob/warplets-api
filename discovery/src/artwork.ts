import { creationProof } from "./pump";
import { hashJson } from "./solana";
import { boundedJson, SourceError, TransactionSchema } from "./rpc";
import { candidates, control } from "./store";
import { comparePotential, createdWithinWindow } from "./priority";
import { DEFAULT_POLICY } from "./model";
import { safeMetadataUrl, safeTokenImage } from "./images";
import type { Settings } from "./ingest";
import type { Artwork } from "./artwork-model";

export const ARTWORK_READER_VERSION = 2;
const guard = "EXISTS(SELECT 1 FROM tenx_artwork_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2) AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)";
export async function artworkFor(db: D1Database, addresses: string[]): Promise<Record<string, Artwork>> {
  if (!addresses.length) return {};
  const rows = await db.prepare(`SELECT address,image_url,metadata_uri,creation_hash,metadata_hash,fetched_at,error FROM tenx_artwork WHERE address IN (${addresses.map(() => "?").join(",")})`).bind(...addresses).all<Artwork & { address: string }>();
  return Object.fromEntries(rows.results.map(({ address, ...art }) => [address, art]));
}
async function reserveArtwork(db: D1Database, owner: string, now: Date, marketLimit: number) {
  const at = now.toISOString(), day = at.slice(0, 10);
  const result = await db.batch([
    db.prepare(`INSERT INTO tenx_usage(provider,day,used) SELECT 'artwork',?3,1 WHERE ${guard}
      AND COALESCE((SELECT used FROM tenx_usage WHERE provider='artwork' AND day=?3),0)<120
      AND COALESCE((SELECT used FROM tenx_usage WHERE provider='market' AND day=?3),0)<?4
      ON CONFLICT(provider,day) DO UPDATE SET used=used+1`).bind(owner, at, day, marketLimit),
    db.prepare(`INSERT INTO tenx_usage(provider,day,used) SELECT 'market',?1,1 WHERE changes()=1
      ON CONFLICT(provider,day) DO UPDATE SET used=used+1`).bind(day),
  ]).catch(() => { throw new SourceError("artwork_admission_unavailable", 300); });
  if (result[0]!.meta.changes === 1) return;
  const market = await db.prepare("SELECT used FROM tenx_usage WHERE provider='market' AND day=?1").bind(day).first<{used:number}>();
  const art = await db.prepare("SELECT used FROM tenx_usage WHERE provider='artwork' AND day=?1").bind(day).first<{used:number}>();
  throw new SourceError((market?.used ?? 0) >= marketLimit ? "market_daily_budget_exhausted" : (art?.used ?? 0) >= 120 ? "artwork_daily_budget_exhausted" : "artwork_lease_lost", 3600);
}
// Public artwork reads remain cache-only. Only authenticated paced work fetches JSON.
export async function runArtworkCycle(settings: Settings, observedAt?: Date): Promise<Record<string, unknown>> {
  if (!settings.marketEnabled) return { state: "disabled" };
  const now = observedAt ?? new Date(), clock = () => observedAt ?? new Date(), db = settings.db, at = now.toISOString(), owner = crypto.randomUUID();
  if ((await control(db)).paused) return { state: "paused" };
  const lease = await db.prepare(`UPDATE tenx_artwork_control SET lease_owner=?4,lease_until=?1,next_refresh_at=?2 WHERE id=1
    AND (lease_until IS NULL OR lease_until<?3) AND (next_refresh_at IS NULL OR next_refresh_at<=?3)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0) RETURNING id`)
    .bind(new Date(now.getTime() + 60000).toISOString(), new Date(now.getTime() + 60000).toISOString(), at, owner).first();
  if (!lease) return { state: "waiting" };
  let updated = 0, requested = 0;
  try {
    const all = await candidates(db), saved = await db.prepare("SELECT address,attempted_at,image_url,image_candidate,metadata_hash,fetched_at,creation_hash,reader_version FROM tenx_artwork").all<Artwork & {address:string;attempted_at:string;image_candidate:string|null;reader_version:number}>();
    const previous = new Map(saved.results.map(r => [r.address, r]));
    const rows = all.filter(c => {
      if (!c.creation) return false;
      const old = previous.get(c.address);
      const recoverable = old?.creation_hash === c.creation.payload_hash && old.metadata_hash && old.fetched_at &&
        Date.parse(old.fetched_at) <= now.getTime() && safeTokenImage(old.image_candidate);
      return !old || !old.image_url && (old.reader_version < ARTWORK_READER_VERSION || recoverable || Date.parse(old.attempted_at) + 6 * 3600000 <= now.getTime());
    })
      .sort((a, b) => Number(createdWithinWindow(b, now)) - Number(createdWithinWindow(a, now)) ||
        Number(Boolean(safeTokenImage(a.market?.image_url))) - Number(Boolean(safeTokenImage(b.market?.image_url))) || comparePotential(a, b, DEFAULT_POLICY, now)).slice(0, 3);
    for (const c of rows) {
      let uri: string | null = null, image: string | null = null, imageCandidate: string | null = null, metadataHash: string | null = null, fetchedAt: string | null = null, error: string | null = null;
      try {
        const row = await db.prepare("SELECT payload FROM tenx_evidence WHERE signature=?1 AND payload_hash=?2").bind(c.creation!.signature, c.creation!.payload_hash).first<{ payload: string }>();
        if (!row) throw new Error("creation_evidence_unavailable");
        const tx = TransactionSchema.parse(JSON.parse(row.payload));
        if (await hashJson(tx) !== c.creation!.payload_hash) throw new Error("creation_evidence_mismatch");
        const creation = await creationProof(tx, c.address, c.creation!.fetched_at);
        if (!creation || creation.proof.instruction_index !== c.creation!.instruction_index || creation.proof.signature !== c.creation!.signature) throw new Error("creation_evidence_mismatch");
        uri = safeMetadataUrl(creation.uri); if (!uri) throw new Error("metadata_uri_unsupported");
        const old = previous.get(c.address);
        if (old?.creation_hash === c.creation!.payload_hash && old.metadata_hash && old.fetched_at && Date.parse(old.fetched_at) <= clock().getTime() && safeTokenImage(old.image_candidate)) {
          image = safeTokenImage(old.image_candidate); imageCandidate = old.image_candidate; metadataHash = old.metadata_hash; fetchedAt = old.fetched_at;
        } else {
          const cached = await db.prepare("SELECT image_url,image_candidate,metadata_hash,fetched_at FROM tenx_artwork WHERE metadata_uri=?1 AND image_url IS NOT NULL AND error IS NULL LIMIT 1").bind(uri)
            .first<{image_url:string;image_candidate:string|null;metadata_hash:string;fetched_at:string}>();
          if (cached && Date.parse(cached.fetched_at) <= clock().getTime() && safeTokenImage(cached.image_url)) {
            image = safeTokenImage(cached.image_url); imageCandidate = cached.image_candidate ?? cached.image_url; metadataHash = cached.metadata_hash; fetchedAt = cached.fetched_at;
          } else {
            await reserveArtwork(db, owner, clock(), settings.marketDailyLimit); requested++;
            const response = await (settings.transport ?? fetch)(uri, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
            if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status === 429 ? "metadata_rate_limited" : "metadata_http_error", response.status === 429 ? 3600 : 300); }
            const metadata = await boundedJson(response, 64000);
            metadataHash = await hashJson(metadata); fetchedAt = clock().toISOString();
            const raw = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).image : null;
            imageCandidate = typeof raw === "string" && raw.length <= 2048 ? raw : null;
            image = safeTokenImage(imageCandidate); if (!image) error = "metadata_image_unavailable";
          }
        }
      } catch (e) {
        if (e instanceof SourceError && ["artwork_daily_budget_exhausted", "market_daily_budget_exhausted", "metadata_rate_limited", "artwork_lease_lost", "artwork_admission_unavailable"].includes(e.code)) throw e;
        error = e instanceof Error && ["creation_evidence_unavailable", "creation_evidence_mismatch", "metadata_uri_unsupported", "metadata_http_error"].includes(e.message) ? e.message : "metadata_unavailable";
      }
      const write = await db.prepare(`INSERT INTO tenx_artwork(address,image_url,metadata_uri,creation_hash,metadata_hash,fetched_at,attempted_at,error,image_candidate,reader_version)
        SELECT ?3,?4,?5,?6,?7,?8,?2,?9,?10,?11 WHERE ${guard}
        ON CONFLICT(address) DO UPDATE SET image_url=excluded.image_url,metadata_uri=excluded.metadata_uri,creation_hash=excluded.creation_hash,metadata_hash=excluded.metadata_hash,fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,error=excluded.error,image_candidate=excluded.image_candidate,reader_version=excluded.reader_version`)
        .bind(owner, clock().toISOString(), c.address, image, uri, c.creation!.payload_hash, metadataHash, fetchedAt, error, imageCandidate, ARTWORK_READER_VERSION).run();
      if (write.meta.changes !== 1) return { state: "held", requested, updated };
      if (image) updated++;
    }
    const finished = await db.prepare(`UPDATE tenx_artwork_control SET lease_owner=NULL,lease_until=NULL,last_error=NULL WHERE id=1 AND ${guard}`).bind(owner, clock().toISOString()).run();
    return { state: finished.meta.changes === 1 ? "succeeded" : "held", requested, updated };
  } catch (e) {
    const error = e instanceof SourceError ? e.code : "artwork_unavailable";
    await db.prepare("UPDATE tenx_artwork_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1 AND lease_owner=?3")
      .bind(new Date(clock().getTime() + (e instanceof SourceError ? e.retryAfterSeconds : 300) * 1000).toISOString(), error, owner).run();
    return { state: "failed", error_code: error, requested, updated };
  }
}
