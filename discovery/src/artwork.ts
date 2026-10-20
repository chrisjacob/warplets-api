import { z } from "zod";
import { creationProof } from "./pump";
import { hashJson } from "./solana";
import { boundedJson, SourceError, TransactionSchema } from "./rpc";
import { candidates, control, reserveQuota } from "./store";
import { comparePotential, createdWithinWindow } from "./priority";
import { DEFAULT_POLICY } from "./model";
import { safeMetadataUrl, safeTokenImage } from "./images";
import type { Settings } from "./ingest";
import type { Artwork } from "./artwork-model";

export async function artworkFor(db: D1Database, addresses: string[]): Promise<Record<string, Artwork>> {
  if (!addresses.length) return {};
  const rows = await db.prepare(`SELECT address,image_url,metadata_uri,creation_hash,metadata_hash,fetched_at,error FROM tenx_artwork WHERE address IN (${addresses.map(() => "?").join(",")})`).bind(...addresses).all<Artwork & { address: string }>();
  return Object.fromEntries(rows.results.map(({ address, ...art }) => [address, art]));
}

// Authenticated timer work only. Public list/artwork reads never contact providers.
export async function runArtworkCycle(settings: Settings, now = new Date()): Promise<Record<string, unknown>> {
  if (!settings.marketEnabled) return { state: "disabled" };
  const db = settings.db, at = now.toISOString();
  if ((await control(db)).paused) return { state: "paused" };
  const lease = await db.prepare(`UPDATE tenx_artwork_control SET lease_until=?1,next_refresh_at=?2 WHERE id=1 AND (lease_until IS NULL OR lease_until<?3) AND (next_refresh_at IS NULL OR next_refresh_at<=?3) RETURNING id`)
    .bind(new Date(now.getTime() + 60000).toISOString(), new Date(now.getTime() + 60000).toISOString(), at).first();
  if (!lease) return { state: "waiting" };
  let updated = 0, requested = 0;
  try {
    const all = await candidates(db), saved = await db.prepare("SELECT address,attempted_at,image_url FROM tenx_artwork").all<{ address: string; attempted_at: string; image_url: string | null }>();
    const previous = new Map(saved.results.map(r => [r.address, r]));
    const rows = all.filter(c => c.creation && (!previous.has(c.address) || (!previous.get(c.address)!.image_url && Date.parse(previous.get(c.address)!.attempted_at) + 6 * 3600000 <= now.getTime())))
      .sort((a, b) => Number(createdWithinWindow(b, now)) - Number(createdWithinWindow(a, now)) || comparePotential(a, b, DEFAULT_POLICY, now)).slice(0, 3);
    const reserve = reserveQuota(db, { rpc: settings.rpcDailyLimit, market: settings.marketDailyLimit }, now);
    for (const c of rows) {
      let uri: string | null = null, image: string | null = null, metadataHash: string | null = null, fetchedAt: string | null = null, error: string | null = null;
      try {
        const row = await db.prepare("SELECT payload FROM tenx_evidence WHERE signature=?1 AND payload_hash=?2").bind(c.creation!.signature, c.creation!.payload_hash).first<{ payload: string }>();
        if (!row) throw new Error("creation_evidence_unavailable");
        const tx = TransactionSchema.parse(JSON.parse(row.payload));
        if (await hashJson(tx) !== c.creation!.payload_hash) throw new Error("creation_evidence_mismatch");
        const creation = await creationProof(tx, c.address, c.creation!.fetched_at);
        if (!creation || creation.proof.instruction_index !== c.creation!.instruction_index || creation.proof.signature !== c.creation!.signature) throw new Error("creation_evidence_mismatch");
        uri = safeMetadataUrl(creation.uri); if (!uri) throw new Error("metadata_uri_unsupported");
        const cached = await db.prepare("SELECT image_url,metadata_hash,fetched_at FROM tenx_artwork WHERE metadata_uri=?1 AND image_url IS NOT NULL AND error IS NULL LIMIT 1").bind(uri).first<{ image_url: string; metadata_hash: string; fetched_at: string }>();
        if (cached && safeTokenImage(cached.image_url)) {
          image = cached.image_url; metadataHash = cached.metadata_hash; fetchedAt = cached.fetched_at; updated++;
        } else {
          // 120 metadata requests/day, also charged to the unchanged shared market cap.
          const allowance = await db.prepare(`INSERT INTO tenx_usage(provider,day,used) VALUES('artwork',?1,1) ON CONFLICT(provider,day) DO UPDATE SET used=used+1 WHERE used<120 RETURNING used`).bind(at.slice(0, 10)).first();
          if (!allowance) throw new SourceError("artwork_daily_budget_exhausted", 3600);
          await reserve("market"); requested++;
          const transport = settings.transport ?? fetch;
          const response = await transport(uri, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
          if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status === 429 ? "metadata_rate_limited" : "metadata_http_error", response.status === 429 ? 3600 : 300); }
          const metadata = await boundedJson(response, 64000);
          metadataHash = await hashJson(metadata); fetchedAt = at;
          image = safeTokenImage(z.object({ image: z.unknown().optional() }).parse(metadata).image);
          if (!image) error = "metadata_image_unavailable";
          else updated++;
        }
      } catch (e) {
        if (e instanceof SourceError && ["artwork_daily_budget_exhausted", "market_daily_budget_exhausted", "metadata_rate_limited"].includes(e.code)) throw e;
        error = e instanceof Error && ["creation_evidence_unavailable", "creation_evidence_mismatch", "metadata_uri_unsupported", "metadata_http_error"].includes(e.message) ? e.message : "metadata_unavailable";
      }
      await db.prepare(`INSERT INTO tenx_artwork(address,image_url,metadata_uri,creation_hash,metadata_hash,fetched_at,attempted_at,error) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(address) DO UPDATE SET image_url=excluded.image_url,metadata_uri=excluded.metadata_uri,creation_hash=excluded.creation_hash,metadata_hash=excluded.metadata_hash,fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,error=excluded.error`)
        .bind(c.address, image, uri, c.creation!.payload_hash, metadataHash, fetchedAt, at, error).run();
    }
    await db.prepare("UPDATE tenx_artwork_control SET lease_until=NULL,last_error=NULL WHERE id=1").run();
    return { state: "succeeded", requested, updated };
  } catch (e) {
    const error = e instanceof SourceError ? e.code : "artwork_unavailable";
    await db.prepare("UPDATE tenx_artwork_control SET lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1").bind(new Date(now.getTime() + (e instanceof SourceError ? e.retryAfterSeconds : 300) * 1000).toISOString(), error).run();
    return { state: "failed", error_code: error, requested, updated };
  }
}
