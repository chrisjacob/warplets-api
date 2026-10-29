import { sealVersion } from "./versionVerification";
export { sealVersion };
import {
  one,
  rows,
  run,
  requireThat,
  text,
  integer,
  sha,
  json,
  payload,
  type Database,
} from "./db";
import { canonical } from "../shared/canonical";
import { type LedgerEvent } from "../shared/holding";
import { campaigns } from "./holding";
import { requireIndependentQuote } from "./sources";
import { fetchFinalizedReceipt, verifyReceipt } from "./receipts";
import { decode58 } from "../shared/base58";
import { operator } from "./rounds";
export interface EvidenceVersion {
  id: string;
  campaign_id: string;
  parent_id: string | null;
  correction_id: string | null;
  effective_from: number;
  through_at: number;
  scope_wallets: string;
  mode: "observed" | "simulated";
  state: string;
  manifest_hash: string | null;
}
export async function chosenVersion(
  db: Database,
  campaign: string,
  cutoff: number,
  allowedIds?: string[],
) {
  return one<EvidenceVersion>(
    db,
    "SELECT * FROM meme_evidence_versions WHERE campaign_id=? AND effective_from<=? AND state='ready' AND (? IS NULL OR id IN(SELECT value FROM json_each(?))) ORDER BY effective_from DESC,created_at DESC,id DESC LIMIT 1",
    campaign,
    cutoff,
    allowedIds ? canonical(allowedIds) : null,
    canonical(allowedIds ?? []),
  );
}
export async function startVersion(db: Database, p: Record<string, unknown>) {
  const id = text(p.id, "version ID", 80),
    campaignId = text(p.campaignId, "campaign ID"),
    effective = integer(p.effectiveFrom, "effective cutoff"),
    through = integer(p.throughAt, "history cutoff");
  requireThat(
    through >= effective && through <= Date.now(),
    400,
    "Invalid version range",
  );
  const campaign = (await campaigns(db)).find((c) => c.id === campaignId);
  requireThat(
    campaign && p.mode === campaign.mode,
    409,
    "Version must match campaign source mode",
  );
  requireThat(
    Array.isArray(p.scopeWallets) &&
      p.scopeWallets.length > 0 &&
      p.scopeWallets.length <= 1000,
    400,
    "Version wallet scope required",
  );
  const scope = [...new Set(p.scopeWallets as string[])].sort();
  for (const w of scope) decode58(w, 32);
  const parent = p.parentId == null ? null : text(p.parentId, "parent version");
  if (parent)
    requireThat(
      await one(
        db,
        "SELECT id FROM meme_evidence_versions WHERE id=? AND campaign_id=? AND state='ready'",
        parent,
        campaignId,
      ),
      409,
      "Sealed parent version required",
    );
  const correction =
    p.correctionId == null ? null : text(p.correctionId, "correction ID");
  const active = await chosenVersion(db, campaignId, effective);
  requireThat(
    !active || active.id === id || (parent === active.id && correction),
    409,
    "Replacing accepted evidence requires its parent and a reviewed correction",
  );
  requireThat(
    !parent || correction,
    409,
    "A parent replacement requires correction provenance",
  );
  if (correction)
    requireThat(
      await one(
        db,
        "SELECT id FROM meme_source_corrections WHERE id=? AND campaign_id=? AND effective_from=? AND state='proposed'",
        correction,
        campaignId,
        effective,
      ),
      409,
      "Matching proposed correction required",
    );
  const existing = await one<EvidenceVersion>(
    db,
    "SELECT * FROM meme_evidence_versions WHERE id=?",
    id,
  );
  if (existing) {
    requireThat(
      existing.campaign_id === campaignId &&
        existing.effective_from === effective &&
        existing.through_at === through &&
        existing.scope_wallets === canonical(scope) &&
        existing.parent_id === parent &&
        existing.correction_id === correction,
      409,
      "Version identity changed",
    );
    return { id, state: existing.state };
  }
  await run(
    db,
    "INSERT INTO meme_evidence_versions VALUES(?,?,?,?,?,?,?,?,'building',NULL,?)",
    id,
    campaignId,
    parent,
    correction,
    effective,
    through,
    canonical(scope),
    p.mode,
    Date.now(),
  );
  return { id, state: "building" };
}
export async function appendVersion(
  db: Database,
  id: string,
  events: LedgerEvent[],
) {
  const v = await one<EvidenceVersion>(
    db,
    "SELECT * FROM meme_evidence_versions WHERE id=?",
    id,
  );
  requireThat(v?.state === "building", 409, "Open evidence version required");
  requireThat(
    Array.isArray(events) &&
      events.length <= (v.mode === "observed" ? 20 : 1000),
    400,
    "Version page too large",
  );
  const campaign = (await campaigns(db)).find((c) => c.id === v.campaign_id)!;
  const scope = new Set<string>(JSON.parse(v.scope_wallets)),
    statements: D1PreparedStatement[] = [];
  for (const e of events) {
    decode58(e.signature, 64);
    integer(e.index, "event index", 0);
    integer(e.slot, "slot");
    integer(e.at, "event time");
    requireThat(
      e.at >= campaign.launchedAt &&
        e.at <= v.through_at &&
        /^[1-9][0-9]{0,77}$/.test(e.quantity) &&
        ["purchase", "airdrop", "sell", "transfer"].includes(e.kind),
      400,
      "Invalid version event",
    );
    const addresses = e.kind === "transfer" ? [e.from!, e.to!] : [e.wallet!];
    for (const w of addresses) decode58(w, 32);
    requireThat(
      addresses.some((w) => scope.has(w)),
      400,
      "Event outside version scope",
    );
    const key = e.signature + ":" + e.index,
      bytes = canonical(e),
      hash = await sha(bytes);
    const old = await one<{ payload_hash: string }>(
      db,
      "SELECT payload_hash FROM meme_version_events WHERE version_id=? AND event_key=?",
      id,
      key,
    );
    if (old) {
      requireThat(old.payload_hash === hash, 409, "Version event changed");
      continue;
    }
    if (v.mode === "observed") {
      await requireIndependentQuote(db, e);
      verifyReceipt(e, campaign, await fetchFinalizedReceipt(db, e.signature));
    }
    statements.push(
      db
        .prepare("INSERT INTO meme_version_events VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, key, bytes, hash, e.signature, e.index, e.slot, e.at),
    );
    for (const w of new Set(addresses))
      statements.push(
        db
          .prepare("INSERT INTO meme_version_wallets VALUES(?,?,?,?)")
          .bind(id, key, w, e.signature),
      );
  }
  if (statements.length) await db.batch(statements);
  return { id, appended: events.length };
}
export async function versionRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/meme/operator/versions/")) return null;
  await operator(db, request);
  requireThat(request.method === "POST", 405, "Method not allowed");
  if (path.endsWith("/start"))
    return json(
      await startVersion(
        db,
        await payload(request, [
          "id",
          "campaignId",
          "parentId",
          "correctionId",
          "effectiveFrom",
          "throughAt",
          "scopeWallets",
          "mode",
        ]),
      ),
    );
  const p = await payload(request, ["id", "events"]),
    id = text(p.id, "version ID");
  requireThat(
    ["/seal", "/preview", "/append"].some((s) => path.endsWith(s)),
    404,
    "Unknown version route",
  );
  return json(
    path.endsWith("/seal")
      ? await sealVersion(db, id)
      : path.endsWith("/preview")
        ? await sealVersion(db, id, true)
        : await appendVersion(db, id, p.events as LedgerEvent[]),
  );
}
