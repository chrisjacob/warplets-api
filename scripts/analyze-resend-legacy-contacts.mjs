import { promises as dns } from "node:dns";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SEGMENTS = {
  tenx: "ae46cf43-d4cf-4bc6-bc42-8af13fbc0dd7",
  drop: "e52bdc31-4f3c-4ec6-a623-9bc3977042e2",
  discord: "be2dd809-e0bd-4b71-95ac-eb11f68270c4",
};
const BROADCAST_ID = "c82cbf96-a920-4a9a-b964-a0091f4cec1d";
const DISPOSABLE_LIST_URL = "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf";
const root = resolve(import.meta.dirname, "..");
const requestedEnvFile = process.argv.find((value) => value.startsWith("--env-file="))?.split("=")[1];
const requestedBackupFile = process.argv.find((value) => value.startsWith("--reuse-backup="))?.split("=")[1];
const envFile = requestedEnvFile || [resolve(root, "app", ".dev.vars")].find(existsSync);
const database = process.argv.find((value) => value.startsWith("--database="))?.split("=")[1] || "warplets";
const appDirectory = resolve(root, "app");
const outputDirectory = resolve(root, "tmp", "resend-legacy-audit");

if (process.argv.includes("--apply") || process.argv.includes("--delete")) {
  throw new Error("This audit is intentionally read-only and does not support mutation flags.");
}
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.RESEND_API_KEY?.trim()) throw new Error("RESEND_API_KEY is required");

const resendApiKey = process.env.RESEND_API_KEY.trim();
const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
let lastResendRequestAt = 0;

async function resend(path, attempt = 0) {
  const gap = 550 - (Date.now() - lastResendRequestAt);
  if (gap > 0) await wait(gap);
  lastResendRequestAt = Date.now();
  const response = await fetch(`https://api.resend.com${path}`, {
    headers: {
      authorization: `Bearer ${resendApiKey}`,
      "user-agent": "warplets-contact-audit/1.0",
    },
  });
  if (response.status === 429 && attempt < 8) {
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) ? Math.max(1_000, retryAfter * 1_000) : Math.min(60_000, 2 ** attempt * 1_000));
    return resend(path, attempt + 1);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Resend GET ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

async function paginated(path, { stopWhen } = {}) {
  const rows = [];
  let after = "";
  do {
    const separator = path.includes("?") ? "&" : "?";
    const page = await resend(`${path}${separator}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    const data = Array.isArray(page.data) ? page.data : [];
    rows.push(...data);
    if (stopWhen?.(data, rows)) break;
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

function normalizeDomain(email) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function generatedLocalPartReasons(email) {
  const local = email.slice(0, email.lastIndexOf("@")).toLowerCase();
  const reasons = [];
  if (/^user\d{7,}$/.test(local)) reasons.push("generated_user_plus_long_number");
  if (/^(?:test|fake|spam|nobody|noone|asdf|qwerty|temp|temporary|throwaway|burner)(?:[._+-]?\d*)?$/.test(local)) {
    reasons.push("placeholder_or_disposable_local_part");
  }
  if (/^\d{10,}$/.test(local)) reasons.push("long_numeric_local_part");
  if (/^(.)\1{6,}$/.test(local)) reasons.push("repeated_character_local_part");
  if (/^[a-z0-9]{24,}$/.test(local) && /\d/.test(local) && /[a-z]/.test(local)) reasons.push("high_entropy_local_part");
  return reasons;
}

function obviouslyInvalidAddressReasons(email) {
  const local = email.slice(0, email.lastIndexOf("@")).toLowerCase();
  const domain = normalizeDomain(email);
  const reasons = [];
  if (local === "a" && domain === "a.com") reasons.push("obvious_placeholder_address");
  if (/\.(?:cim|cmo|con|comm|vom)$/.test(domain)) reasons.push("obvious_domain_typo");
  return reasons;
}

async function mailDnsStatus(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length) return { status: "mx", mx: mx.map((entry) => entry.exchange).sort() };
  } catch (error) {
    if (!["ENODATA", "ENOTFOUND", "ESERVFAIL", "ETIMEOUT", "EREFUSED"].includes(error?.code)) {
      return { status: "unknown", error: error?.code || String(error) };
    }
  }
  try {
    const addresses = [...await dns.resolve4(domain).catch(() => []), ...await dns.resolve6(domain).catch(() => [])];
    return addresses.length ? { status: "address_fallback" } : { status: "no_mail_dns" };
  } catch (error) {
    return { status: "unknown", error: error?.code || String(error) };
  }
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function main() {
  mkdirSync(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  console.log("[legacy-audit] Loading canonical trusted identities from production D1.");
  const trustedRows = wranglerSql(`SELECT lower(trim(email)) AS email
    FROM email_identity_profiles
    WHERE email_verified_at IS NOT NULL
      AND (farcaster_fid IS NOT NULL OR discord_user_id IS NOT NULL);`);
  const trustedEmails = new Set(trustedRows.map((row) => normalizeEmail(row.email)).filter(Boolean));

  console.log("[legacy-audit] Loading all Resend segments and memberships.");
  const allSegments = await paginated("/segments");
  const memberships = new Map();
  const unionContacts = new Map();
  for (const segment of allSegments) {
    const contacts = await paginated(`/segments/${encodeURIComponent(segment.id)}/contacts`);
    for (const contact of contacts) {
      const email = normalizeEmail(contact.email);
      if (!email) continue;
      if (!memberships.has(email)) memberships.set(email, []);
      memberships.get(email).push({ id: segment.id, name: segment.name });
      if (Object.values(SEGMENTS).includes(segment.id)) unionContacts.set(email, contact);
    }
  }
  const legacyEmails = [...unionContacts.keys()].filter((email) => !trustedEmails.has(email)).sort();
  console.log(`[legacy-audit] Legacy-unverified contacts identified: ${legacyEmails.length}.`);

  const reusedBackup = requestedBackupFile && existsSync(requestedBackupFile)
    ? JSON.parse(readFileSync(requestedBackupFile, "utf8"))
    : null;
  const reusedContacts = new Map((reusedBackup?.contacts ?? []).map((row) => [normalizeEmail(row.contact?.email), row]));
  const detailedContacts = [];
  let fetchedContacts = 0;
  for (let index = 0; index < legacyEmails.length; index += 1) {
    const reused = reusedContacts.get(legacyEmails[index]);
    if (reused?.contact) detailedContacts.push(reused.contact);
    else {
      detailedContacts.push(await resend(`/contacts/${encodeURIComponent(legacyEmails[index])}`));
      fetchedContacts += 1;
    }
    if ((index + 1) % 50 === 0 || index + 1 === legacyEmails.length) {
      console.log(`[legacy-audit] Backed up ${index + 1}/${legacyEmails.length} detailed contacts (${fetchedContacts} fetched, ${index + 1 - fetchedContacts} reused).`);
    }
  }

  console.log("[legacy-audit] Loading Resend suppression evidence.");
  const suppressions = await paginated("/suppressions");
  const suppressionByEmail = new Map(suppressions.map((row) => [normalizeEmail(row.email), row]));
  const legacySuppressionSources = [...new Set(legacyEmails
    .map((email) => suppressionByEmail.get(email)?.source_id)
    .filter(Boolean))];
  const suppressionSourceById = new Map();
  for (let index = 0; index < legacySuppressionSources.length; index += 1) {
    const sourceId = legacySuppressionSources[index];
    try {
      suppressionSourceById.set(sourceId, await resend(`/emails/${encodeURIComponent(sourceId)}`));
    } catch (error) {
      suppressionSourceById.set(sourceId, { backup_error: error instanceof Error ? error.message : String(error) });
    }
    if ((index + 1) % 50 === 0 || index + 1 === legacySuppressionSources.length) {
      console.log(`[legacy-audit] Backed up ${index + 1}/${legacySuppressionSources.length} suppression source emails.`);
    }
  }

  console.log("[legacy-audit] Loading the referenced broadcast and its recipient events.");
  const broadcast = await resend(`/broadcasts/${BROADCAST_ID}`);
  const sentAt = Date.parse(broadcast.sent_at || broadcast.scheduled_at || broadcast.created_at);
  const cutoff = sentAt - 24 * 60 * 60 * 1_000;
  const sentEmails = await paginated("/emails", {
    stopWhen: (page) => page.some((email) => Date.parse(email.created_at) < cutoff),
  });
  const broadcastEvents = sentEmails.filter((email) =>
    email.subject === broadcast.subject
    && Math.abs(Date.parse(email.created_at) - sentAt) <= 24 * 60 * 60 * 1_000
  );
  const broadcastEventByEmail = new Map();
  for (const event of broadcastEvents) {
    for (const recipient of event.to ?? []) broadcastEventByEmail.set(normalizeEmail(recipient), event);
  }

  console.log("[legacy-audit] Loading the conservative disposable-domain blocklist.");
  const disposableResponse = await fetch(DISPOSABLE_LIST_URL, { headers: { "user-agent": "warplets-contact-audit/1.0" } });
  if (!disposableResponse.ok) throw new Error(`Disposable-domain list fetch failed (${disposableResponse.status})`);
  const disposableDomains = new Set((await disposableResponse.text()).split(/\r?\n/).map((value) => value.trim().toLowerCase()).filter((value) => value && !value.startsWith("#")));

  const domains = [...new Set(legacyEmails.map(normalizeDomain))].sort();
  const dnsByDomain = new Map();
  for (let index = 0; index < domains.length; index += 20) {
    const batch = domains.slice(index, index + 20);
    const results = await Promise.all(batch.map(async (domain) => [domain, await mailDnsStatus(domain)]));
    for (const [domain, result] of results) dnsByDomain.set(domain, result);
  }

  const analysis = detailedContacts.map((contact) => {
    const email = normalizeEmail(contact.email);
    const domain = normalizeDomain(email);
    const suppression = suppressionByEmail.get(email) || null;
    const suppressionSource = suppression?.source_id ? suppressionSourceById.get(suppression.source_id) || null : null;
    const broadcastEvent = broadcastEventByEmail.get(email) || null;
    const dnsStatus = dnsByDomain.get(domain) || { status: "unknown" };
    const generatedReasons = generatedLocalPartReasons(email);
    const invalidAddressReasons = obviouslyInvalidAddressReasons(email);
    const reasons = [];
    let recommendation = "retain";
    let confidence = "low";

    if (suppression?.origin === "bounce") reasons.push("account_suppression_bounce");
    if (suppression?.origin === "complaint") reasons.push("account_suppression_complaint");
    if (suppression?.origin === "manual") reasons.push("account_suppression_manual");
    if (broadcastEvent?.last_event === "bounced") reasons.push("referenced_broadcast_bounced");
    if (broadcastEvent?.last_event === "suppressed") reasons.push("referenced_broadcast_suppressed");
    if (disposableDomains.has(domain)) reasons.push("known_disposable_domain");
    if (dnsStatus.status === "no_mail_dns") reasons.push("domain_has_no_mail_dns");
    reasons.push(...generatedReasons);
    reasons.push(...invalidAddressReasons);
    if (contact.unsubscribed) reasons.push("globally_unsubscribed");

    if (reasons.some((reason) => [
      "account_suppression_bounce", "account_suppression_complaint", "referenced_broadcast_bounced",
      "known_disposable_domain", "obvious_placeholder_address", "obvious_domain_typo",
    ].includes(reason))) {
      recommendation = "delete_candidate";
      confidence = "high";
    } else if (generatedReasons.length || dnsStatus.status === "no_mail_dns" || suppression?.origin === "manual" || contact.unsubscribed) {
      recommendation = "manual_review";
      confidence = "medium";
    }

    return {
      email,
      contact_id: contact.id,
      recommendation,
      confidence,
      reasons,
      domain,
      dns_status: dnsStatus.status,
      disposable_domain: disposableDomains.has(domain),
      suppression_origin: suppression?.origin || null,
      suppression_created_at: suppression?.created_at || null,
      suppression_source_id: suppression?.source_id || null,
      suppression_source_subject: suppressionSource?.subject || null,
      suppression_source_last_event: suppressionSource?.last_event || null,
      suppression_source_created_at: suppressionSource?.created_at || null,
      suppression_source_broadcast_id: suppressionSource?.broadcast_id || null,
      broadcast_last_event: broadcastEvent?.last_event || null,
      broadcast_email_id: broadcastEvent?.id || null,
      globally_unsubscribed: Boolean(contact.unsubscribed),
      segments: memberships.get(email) ?? [],
    };
  }).sort((left, right) => {
    const rank = { delete_candidate: 0, manual_review: 1, retain: 2 };
    return rank[left.recommendation] - rank[right.recommendation] || left.email.localeCompare(right.email);
  });

  const candidates = analysis.filter((row) => row.recommendation !== "retain");
  console.log(`[legacy-audit] Loading topic subscriptions for ${candidates.length} recommended/review contacts.`);
  const topicsByEmail = new Map([...reusedContacts.entries()]
    .filter(([, row]) => row.topics != null)
    .map(([email, row]) => [email, row.topics]));
  let fetchedTopics = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!topicsByEmail.has(candidate.email)) {
      try {
        const topics = await paginated(`/contacts/${encodeURIComponent(candidate.contact_id)}/topics`);
        topicsByEmail.set(candidate.email, topics);
      } catch (error) {
        topicsByEmail.set(candidate.email, { backup_error: error instanceof Error ? error.message : String(error) });
      }
      fetchedTopics += 1;
    }
    if ((index + 1) % 50 === 0 || index + 1 === candidates.length) {
      console.log(`[legacy-audit] Backed up topics for ${index + 1}/${candidates.length} candidates (${fetchedTopics} fetched).`);
    }
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = resolve(outputDirectory, `legacy-unverified-backup-${timestamp}.json`);
  const analysisPath = resolve(outputDirectory, `legacy-unverified-analysis-${timestamp}.json`);
  const csvPath = resolve(outputDirectory, `legacy-unverified-recommendations-${timestamp}.csv`);
  const summaryPath = resolve(outputDirectory, `legacy-unverified-summary-${timestamp}.md`);
  const backup = {
    metadata: {
      created_at: new Date().toISOString(),
      mode: "read_only",
      database,
      union_segment_ids: SEGMENTS,
      trusted_identity_count: trustedEmails.size,
      legacy_unverified_count: legacyEmails.length,
      all_segments: allSegments,
    },
    contacts: detailedContacts.map((contact) => ({
      contact,
      segments: memberships.get(normalizeEmail(contact.email)) ?? [],
      topics: topicsByEmail.get(normalizeEmail(contact.email)) ?? null,
    })),
  };
  const counts = {
    total: analysis.length,
    delete_candidate: analysis.filter((row) => row.recommendation === "delete_candidate").length,
    manual_review: analysis.filter((row) => row.recommendation === "manual_review").length,
    retain: analysis.filter((row) => row.recommendation === "retain").length,
    suppression_bounce: analysis.filter((row) => row.suppression_origin === "bounce").length,
    suppression_complaint: analysis.filter((row) => row.suppression_origin === "complaint").length,
    suppression_manual: analysis.filter((row) => row.suppression_origin === "manual").length,
    broadcast_bounced: analysis.filter((row) => row.broadcast_last_event === "bounced").length,
    broadcast_suppressed: analysis.filter((row) => row.broadcast_last_event === "suppressed").length,
    suppression_source_matches_broadcast: analysis.filter((row) => row.suppression_source_subject === broadcast.subject).length,
    disposable_domain: analysis.filter((row) => row.disposable_domain).length,
    no_mail_dns: analysis.filter((row) => row.dns_status === "no_mail_dns").length,
    generated_local_part: analysis.filter((row) => row.reasons.some((reason) => reason.includes("local_part") || reason.startsWith("generated_"))).length,
    globally_unsubscribed: analysis.filter((row) => row.globally_unsubscribed).length,
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  writeFileSync(analysisPath, JSON.stringify({
    metadata: {
      created_at: new Date().toISOString(),
      started_at: startedAt,
      mode: "read_only",
      broadcast,
      broadcast_event_count: broadcastEvents.length,
      account_suppression_count: suppressions.length,
      suppression_source_email_count: suppressionSourceById.size,
      disposable_list_url: DISPOSABLE_LIST_URL,
      disposable_list_domain_count: disposableDomains.size,
    },
    counts,
    contacts: analysis,
  }, null, 2));
  const columns = [
    "email", "recommendation", "confidence", "reasons", "domain", "dns_status", "suppression_origin",
    "broadcast_last_event", "globally_unsubscribed", "segment_names", "contact_id",
  ];
  const csv = [columns.map(csvCell).join(","), ...candidates.map((row) => [
    row.email, row.recommendation, row.confidence, row.reasons, row.domain, row.dns_status,
    row.suppression_origin, row.broadcast_last_event, row.globally_unsubscribed,
    row.segments.map((segment) => segment.name), row.contact_id,
  ].map(csvCell).join(","))].join("\n");
  writeFileSync(csvPath, `${csv}\n`);
  const reasonCounts = new Map();
  for (const row of analysis) for (const reason of row.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  const summary = `# Resend legacy-unverified contact audit\n\n`
    + `Generated: ${new Date().toISOString()}\n\n`
    + `This was a read-only audit. No Resend contact, segment, topic, or suppression was changed.\n\n`
    + `## Recommendations\n\n`
    + `- High-confidence delete candidates: ${counts.delete_candidate}\n`
    + `- Medium-confidence manual review: ${counts.manual_review}\n`
    + `- Retain: ${counts.retain}\n`
    + `- Total legacy-unverified contacts: ${counts.total}\n\n`
    + `## Evidence counts\n\n`
    + [...reasonCounts.entries()].sort((left, right) => right[1] - left[1]).map(([reason, count]) => `- ${reason}: ${count}`).join("\n")
    + `\n\n## Referenced broadcast\n\n`
    + `- ID: ${BROADCAST_ID}\n- Name: ${broadcast.name}\n- Subject: ${broadcast.subject}\n- Matched recipient events: ${broadcastEvents.length}\n`;
  writeFileSync(summaryPath, summary);

  console.log(`[legacy-audit] Counts: ${JSON.stringify(counts)}`);
  console.log(`[legacy-audit] Backup: ${backupPath}`);
  console.log(`[legacy-audit] Analysis: ${analysisPath}`);
  console.log(`[legacy-audit] Recommendations: ${csvPath}`);
  console.log(`[legacy-audit] Summary: ${summaryPath}`);
  console.log("[legacy-audit] Complete. No Resend data was changed.");
}

await main();
