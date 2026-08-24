import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_BACKUP_SHA256 = "629bb04c3d7db6d1edc890170e19581886cca3556a4a0aabb6186e4838e46131";
const EXPECTED_DELETE_CANDIDATES = 133;
const EXPECTED_MANUAL_REVIEW = 6;
const EXPECTED_TOTAL = EXPECTED_DELETE_CANDIDATES + EXPECTED_MANUAL_REVIEW;
const root = resolve(import.meta.dirname, "..");
const appDirectory = resolve(root, "app");
const defaultBackup = resolve(root, "tmp", "resend-legacy-audit", "legacy-unverified-backup-2026-08-21T05-01-46.536Z.json");
const defaultAnalysis = resolve(root, "tmp", "resend-legacy-audit", "legacy-unverified-analysis-2026-08-21T05-01-46.536Z.json");
const requestedEnvFile = process.argv.find((value) => value.startsWith("--env-file="))?.split("=")[1];
const backupPath = resolve(process.argv.find((value) => value.startsWith("--backup="))?.split("=")[1] || defaultBackup);
const analysisPath = resolve(process.argv.find((value) => value.startsWith("--analysis="))?.split("=")[1] || defaultAnalysis);
const database = process.argv.find((value) => value.startsWith("--database="))?.split("=")[1] || "warplets";
const envFile = requestedEnvFile || resolve(appDirectory, ".dev.vars");
const apply = process.argv.includes("--apply");
const outputDirectory = resolve(root, "tmp", "resend-legacy-audit");

for (const path of [envFile, backupPath, analysisPath]) {
  if (!existsSync(path)) throw new Error(`Required file not found: ${path}`);
}
process.loadEnvFile(envFile);
const resendApiKey = process.env.RESEND_API_KEY?.trim();
if (!resendApiKey) throw new Error("RESEND_API_KEY is required");

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
let lastResendRequestAt = 0;

async function resend(path, init = {}, attempt = 0) {
  const gap = 550 - (Date.now() - lastResendRequestAt);
  if (gap > 0) await wait(gap);
  lastResendRequestAt = Date.now();
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${resendApiKey}`,
      "user-agent": "warplets-contact-prune/1.0",
      ...init.headers,
    },
  });
  if (response.status === 429 && attempt < 8) {
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) ? Math.max(1_000, retryAfter * 1_000) : Math.min(60_000, 2 ** attempt * 1_000));
    return resend(path, init, attempt + 1);
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`Resend ${init.method || "GET"} ${path} failed (${response.status})${body ? `: ${body.slice(0, 500)}` : ""}`);
  return body ? JSON.parse(body) : null;
}

async function paginated(path) {
  const rows = [];
  let after = "";
  do {
    const separator = path.includes("?") ? "&" : "?";
    const page = await resend(`${path}${separator}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    const data = Array.isArray(page.data) ? page.data : [];
    rows.push(...data);
    after = page.has_more && data.length ? String(data.at(-1).id || "") : "";
  } while (after);
  return rows;
}

function wranglerSql(sql) {
  const wranglerEntry = resolve(appDirectory, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [
    wranglerEntry, "d1", "execute", database, "--remote", "--json", "--command", sql,
  ], { cwd: appDirectory, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.error?.message || result.stderr || result.stdout || "Remote D1 query failed").trim());
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed?.results ?? []);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function persistManifest(path, manifest) {
  writeFileSync(path, JSON.stringify({ ...manifest, updated_at: new Date().toISOString() }, null, 2));
}

async function main() {
  mkdirSync(outputDirectory, { recursive: true });
  const backupBytes = readFileSync(backupPath);
  const backupHash = createHash("sha256").update(backupBytes).digest("hex");
  if (backupHash !== EXPECTED_BACKUP_SHA256) {
    throw new Error(`Backup checksum mismatch: expected ${EXPECTED_BACKUP_SHA256}, got ${backupHash}`);
  }
  const backup = JSON.parse(backupBytes.toString("utf8"));
  const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
  const selected = analysis.contacts.filter((row) => ["delete_candidate", "manual_review"].includes(row.recommendation));
  const highCount = selected.filter((row) => row.recommendation === "delete_candidate").length;
  const reviewCount = selected.filter((row) => row.recommendation === "manual_review").length;
  const selectedEmails = new Set(selected.map((row) => normalizeEmail(row.email)));
  const selectedIds = new Set(selected.map((row) => String(row.contact_id)));
  if (highCount !== EXPECTED_DELETE_CANDIDATES || reviewCount !== EXPECTED_MANUAL_REVIEW || selected.length !== EXPECTED_TOTAL) {
    throw new Error(`Candidate count mismatch: high=${highCount}, review=${reviewCount}, total=${selected.length}`);
  }
  if (selectedEmails.size !== EXPECTED_TOTAL || selectedIds.size !== EXPECTED_TOTAL) throw new Error("Candidate emails or contact IDs are not unique");
  if (backup.contacts?.length !== 612) throw new Error(`Backup contact count mismatch: ${backup.contacts?.length}`);
  const backupByEmail = new Map(backup.contacts.map((row) => [normalizeEmail(row.contact?.email), row]));
  for (const row of selected) {
    const backedUp = backupByEmail.get(normalizeEmail(row.email));
    if (!backedUp || backedUp.contact?.id !== row.contact_id) throw new Error(`Backup does not match candidate ${row.contact_id}`);
  }

  console.log(`[contact-prune] Validated backup checksum and exact candidate set: ${highCount} high-confidence + ${reviewCount} review = ${selected.length}.`);
  const currentContacts = await paginated("/contacts");
  const currentById = new Map(currentContacts.map((contact) => [String(contact.id), contact]));
  const mismatches = selected.filter((row) => normalizeEmail(currentById.get(String(row.contact_id))?.email) !== normalizeEmail(row.email));
  if (mismatches.length) throw new Error(`${mismatches.length} candidates are missing or no longer match their backed-up contact IDs; aborting`);
  console.log(`[contact-prune] Confirmed all ${selected.length} targets currently exist in Resend.`);

  let canonicalProfilesRetained = [];
  let d1AuditCheck = "completed";
  try {
    const canonicalEmails = new Set(wranglerSql("SELECT lower(trim(email)) AS email FROM email_identity_profiles;")
      .map((row) => normalizeEmail(row.email)));
    canonicalProfilesRetained = selected.filter((row) => canonicalEmails.has(normalizeEmail(row.email))).map((row) => row.email);
  } catch (error) {
    d1AuditCheck = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
    console.warn("[contact-prune] D1 read-only audit lookup unavailable; D1 remains untouched and is not required for Resend deletion.");
  }
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const manifestPath = resolve(outputDirectory, `legacy-contact-deletion-${timestamp}.json`);
  const manifest = {
    created_at: new Date().toISOString(),
    mode: apply ? "apply" : "dry_run",
    backup_path: backupPath,
    backup_sha256: backupHash,
    analysis_path: analysisPath,
    expected: { high_confidence: highCount, manual_review: reviewCount, total: selected.length },
    suppression_entries_preserved: true,
    d1_identity_and_audit_records_preserved: true,
    d1_audit_check: d1AuditCheck,
    canonical_profiles_retained: canonicalProfilesRetained,
    results: selected.map((row) => ({
      contact_id: row.contact_id,
      email: row.email,
      recommendation: row.recommendation,
      confidence: row.confidence,
      reasons: row.reasons,
      status: apply ? "pending" : "dry_run_validated",
    })),
  };
  persistManifest(manifestPath, manifest);

  if (!apply) {
    console.log(`[contact-prune] DRY RUN complete. Manifest: ${manifestPath}`);
    console.log(`[contact-prune] ${canonicalProfilesRetained.length} selected contacts have D1 identity/audit profiles that will be retained.`);
    console.log("[contact-prune] No Resend data was changed. Re-run with --apply to execute the authorized deletion.");
    return;
  }

  let deleted = 0;
  for (let index = 0; index < manifest.results.length; index += 1) {
    const row = manifest.results[index];
    try {
      const result = await resend(`/contacts/${encodeURIComponent(row.contact_id)}`, { method: "DELETE" });
      if (result?.deleted !== true) throw new Error("Resend did not confirm deleted=true");
      row.status = "deleted";
      row.deleted_at = new Date().toISOString();
      deleted += 1;
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
    }
    persistManifest(manifestPath, manifest);
    if ((index + 1) % 25 === 0 || index + 1 === manifest.results.length) {
      console.log(`[contact-prune] Processed ${index + 1}/${manifest.results.length}; deleted=${deleted}, failed=${index + 1 - deleted}.`);
    }
  }

  const failed = manifest.results.filter((row) => row.status !== "deleted");
  if (failed.length) {
    manifest.final = { deleted, failed: failed.length, verified_absent: 0 };
    persistManifest(manifestPath, manifest);
    throw new Error(`${failed.length} contact deletions failed; see ${manifestPath}`);
  }

  const remainingContacts = await paginated("/contacts");
  const remainingIds = new Set(remainingContacts.map((contact) => String(contact.id)));
  const stillPresent = manifest.results.filter((row) => remainingIds.has(String(row.contact_id)));
  manifest.final = {
    deleted,
    failed: 0,
    verified_absent: manifest.results.length - stillPresent.length,
    still_present: stillPresent.map((row) => row.contact_id),
    remaining_resend_contacts: remainingContacts.length,
    completed_at: new Date().toISOString(),
  };
  persistManifest(manifestPath, manifest);
  if (stillPresent.length) throw new Error(`${stillPresent.length} deleted contacts still appear in the global Resend contact list`);
  console.log(`[contact-prune] Complete: deleted=${deleted}, verified_absent=${manifest.final.verified_absent}, failed=0.`);
  console.log(`[contact-prune] Remaining global Resend contacts: ${remainingContacts.length}.`);
  console.log(`[contact-prune] Deletion manifest: ${manifestPath}`);
}

await main();
