import { CandidateExpirySchema, InventoryStatusSchema } from "./candidate-expiry-model";
import { hashJson } from "./solana";

export async function candidateExpiry(db: D1Database, address: string) {
  const row = await db.prepare("SELECT receipt,receipt_hash FROM tenx_candidate_expiry WHERE address=?1").bind(address).first<{receipt:string;receipt_hash:string}>();
  if (!row) return null;
  const receipt = CandidateExpirySchema.parse(JSON.parse(row.receipt));
  if (receipt.address !== address || receipt.creation.kind !== "creation" || Date.parse(receipt.expired_at)-Date.parse(receipt.creation.block_time)<=86_400_000 || await hashJson(receipt)!==row.receipt_hash) throw new Error("candidate_expiry_receipt_mismatch");
  return { ...receipt, receipt_hash: row.receipt_hash };
}

export async function inventoryStatus(db: D1Database) {
  const row = await db.prepare(`SELECT count(*) AS retained,count(*)-count(e.address) AS active,count(e.address) AS expired,max(e.expired_at) AS last_expired_at
    FROM tenx_candidates c LEFT JOIN tenx_candidate_expiry e ON e.address=c.address WHERE c.mode='live'`).first<{retained:number;active:number;expired:number;last_expired_at:string|null}>();
  return InventoryStatusSchema.parse({ policy:"verified-creation-expiry-v1", ...row, active_limit:500, active_over_limit:(row?.active ?? 0)>500 });
}

// Cached, idempotent maintenance: bounded writes, no provider work or quota
// changes. Unique receipts arbitrate concurrent ticks; each receipt and its
// audit commit together, conditional on the still-current immutable proof and
// pause state. Unknown creation dates never become age-based expiries.
export async function expireCandidates(db: D1Database, now = new Date()) {
  if ((await db.prepare("SELECT paused FROM tenx_control WHERE id=1").first<{paused:number}>())?.paused) return { state:"paused", expired:0, provider_requests:0 };
  const at = now.toISOString();
  const rows = await db.prepare(`SELECT c.address,p.payload AS creation FROM tenx_active_candidates c
    JOIN tenx_proofs p ON p.address=c.address AND p.kind='creation' AND p.payload=json_extract(c.payload,'$.creation')
    WHERE c.mode='live' AND json_extract(p.payload,'$.kind')='creation'
    AND length(CAST(p.payload AS BLOB))<=8192
    AND julianday(json_extract(p.payload,'$.block_time'))<julianday(?1)-1
    ORDER BY json_extract(p.payload,'$.block_time'),c.address LIMIT 20`).bind(at).all<{address:string;creation:string}>();
  const receipts = await Promise.all(rows.results.map(async row => {
    const receipt = CandidateExpirySchema.parse({ version:"verified-creation-expiry-v1", address:row.address, creation:JSON.parse(row.creation), expired_at:at });
    return { receipt, hash:await hashJson(receipt) };
  }));
  if (!receipts.length) return { state:"succeeded", expired:0, provider_requests:0 };
  const input = JSON.stringify(receipts);
  const writes = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_candidate_expiry(address,created_at,expired_at,proof_hash,receipt_hash,receipt)
      SELECT c.address,json_extract(j.value,'$.receipt.creation.block_time'),?1,p.payload_hash,json_extract(j.value,'$.hash'),json_extract(j.value,'$.receipt')
      FROM json_each(?2) j JOIN tenx_candidates c ON c.address=json_extract(j.value,'$.receipt.address') AND c.mode='live'
      JOIN tenx_proofs p ON p.address=c.address AND p.kind='creation' AND p.payload=json_extract(j.value,'$.receipt.creation')
      WHERE json_extract(c.payload,'$.creation')=p.payload AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`)
      .bind(at,input),
    db.prepare(`INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at)
      SELECT 'candidate-expiry:'||e.address,'candidate_expired','local-maintenance','Verified creation older than 24 hours; all history retained',e.receipt_hash,e.expired_at
      FROM json_each(?1) j JOIN tenx_candidate_expiry e ON e.address=json_extract(j.value,'$.receipt.address') AND e.receipt_hash=json_extract(j.value,'$.hash')`)
      .bind(input),
  ]);
  return { state:"succeeded", expired:writes[0]!.meta.changes, provider_requests:0 };
}
