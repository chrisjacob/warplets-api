import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { toBase58 } from "../discovery/src/solana";
import { ContentCampaign, ContentCampaignDetail, ContentChangeResponse, ContentPage, ContentRecord } from "../discovery/src/content-model";
import {HoldReviewPage,HoldReviewRecord} from "../discovery/src/content-hold-model";
import {ContentOperations} from "../discovery/src/content-operations-model";
import { IdentityChallengeResponse, IdentitySessionResponse } from "../discovery/src/identity-model";
import {ContentReportPage,ContentReportRecord} from "../discovery/src/content-report-model";
import {verifyContentCaseExport} from "../discovery/src/content-export";

// Disposable keys and a separate database: never signs with user wallets or
// writes synthetic submissions into the live local application database.
const execute = promisify(execFile), root = fileURLToPath(new URL("../", import.meta.url));
const folder = fileURLToPath(new URL(`../.tmp/content-runtime-${crypto.randomUUID()}/`, import.meta.url)); mkdirSync(folder, { recursive: true });
const config = `${folder}/wrangler.jsonc`, persistence = `${folder}/state`, token = randomBytes(32).toString("hex"), origin = "https://app-local.10x.meme";
const port = await new Promise<number>((resolve, reject) => { const server = createServer(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return reject(Error("missing_isolated_port")); server.close(() => resolve(address.port)); }); });
writeFileSync(config, JSON.stringify({ name: "tenx-content-isolated-check", main: fileURLToPath(new URL("../discovery/src/worker.ts", import.meta.url)), compatibility_date: "2026-09-01", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false, vars: { TENX_LOCAL_ONLY: "true", TENX_ADMIN_TOKEN: token }, d1_databases: [{ binding: "TENX_DB", database_name: "tenx-content-isolated-check", database_id: "00000000-0000-0000-0000-000000000024", migrations_dir: fileURLToPath(new URL("../discovery/migrations/", import.meta.url)), remote: false }] }));
const wrangler = fileURLToPath(new URL("../discovery/node_modules/wrangler/bin/wrangler.js", import.meta.url));
const options = { cwd: root, windowsHide: true, env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, maxBuffer: 2_000_000 };
await execute(process.execPath, [wrangler, "d1", "migrations", "apply", "TENX_DB", "--local", "--config", config, "--persist-to", persistence], options);
const child = spawn(process.execPath, [wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--config", config, "--persist-to", persistence], { ...options, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", () => {}); child.stderr.on("data", () => {});
const base = `http://127.0.0.1:${port}/api/10x`;
async function call(path: string, data?: unknown, cookie?: string, admin = false, extra: Record<string, string> = {}) {
  return fetch(`${base}/${path}`, { signal: AbortSignal.timeout(20000), headers: { "x-10x-identity-origin": origin, ...(data === undefined ? {} : { origin, "content-type": "application/json", "x-tenx-identity": "1" }), ...(cookie ? { cookie } : {}), ...(admin ? { authorization: `Bearer ${token}` } : {}), ...extra }, ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }) });
}
async function login() {
  const keys = generateKeyPairSync("ed25519"), der = keys.publicKey.export({ format: "der", type: "spki" }), address = toBase58(new Uint8Array(der.subarray(-32)));
  const start = await call("identity/challenge", { address, intent: "login" }); assert.equal(start.status, 200);
  const c = IdentityChallengeResponse.parse(await start.json());
  const response = await call("identity/verify", { challenge_id: c.challenge_id, signature: sign(null, Buffer.from(c.message), keys.privateKey).toString("base64") }, start.headers.get("set-cookie")!.split(";")[0]); assert.equal(response.status, 200);
  const identity = IdentitySessionResponse.parse(await response.json()); return { address, identity: identity.identity_id!, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error("isolated_content_runtime_stopped");
    try { if ((await call("health")).ok) { ready = true; break; } } catch { /* Owned runtime starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, "isolated_content_runtime_not_ready");
  const users = [await login(), await login(), await login()];
  const campaignInput = { request_id: crypto.randomUUID(), title: "Disposable content review fixture", og_address: users[0]!.address, reason: "Isolated runtime exercise; no real campaign or author" };
  const created = await call("admin/attention/campaigns", campaignInput, undefined, true); assert.equal(created.status, 200);
  const campaign = ContentCampaign.parse(await created.json());
  assert.deepEqual(await (await call("admin/attention/campaigns", campaignInput, undefined, true)).json(), campaign);
  const input = { request_id: crypto.randomUUID(), campaign_id: campaign.id, url: "https://example.com/first?utm_source=test", category: "meme", author_claim: "Synthetic contributor", comment: "Fixture only; no real content", permission_to_feature: true, rights_confirmed: true };
  assert.equal((await call("attention/submissions", input)).status, 401);
  assert.equal((await call("attention/submissions", input, users[0]!.cookie, false, { origin: "https://evil.example" })).status, 403);
  const submitted = await call("attention/submissions", input, users[0]!.cookie); assert.equal(submitted.status, 200); const initial = ContentRecord.parse(await submitted.json());
  assert.deepEqual(ContentRecord.parse(await (await call("attention/submissions", input, users[0]!.cookie)).json()), initial);
  assert.equal((await call("attention/submissions", { ...input, request_id: crypto.randomUUID(), url: "https://example.com/first" }, users[1]!.cookie)).status, 409);
  assert.equal((await call(`attention/mine/${input.request_id}`, undefined, users[1]!.cookie)).status, 404);
  const publicDetail = () => call(`attention/campaigns/${campaign.id}`);
  assert.equal(ContentCampaignDetail.parse(await (await publicDetail()).json()).feed.submissions.length, 0);
  const review = { request_id: crypto.randomUUID(), submission_id: input.request_id, expected_revision: 0, decision: "REJECTED", reason: "Synthetic rejection for the appeal exercise" };
  assert.equal((await call("admin/attention/review", review)).status, 401);
  assert.equal((await call("admin/attention/review", review, undefined, true)).status, 200);
  assert.equal((await call("attention/appeals", { request_id: crypto.randomUUID(), submission_id: input.request_id, expected_revision: 1, reason: "Synthetic owner appeal" }, users[0]!.cookie)).status, 200);
  const approve = { ...review, request_id: crypto.randomUUID(), expected_revision: 2, decision: "VISIBLE", reason: "Manual visibility only; no authorship or reward verification" };
  const competing = await Promise.all([call("admin/attention/review", approve, undefined, true), call("admin/attention/review", { ...approve, request_id: crypto.randomUUID(), decision: "REJECTED" }, undefined, true)]);
  assert.equal(competing.filter(r => r.status === 200).length, 1); assert.equal(competing.filter(r => r.status === 409).length, 1);
  const accepted = ContentChangeResponse.parse(await competing.find(r => r.status === 200)!.json());
  const retained = ContentRecord.parse(await (await call(`admin/attention/submissions/${input.request_id}`, undefined, undefined, true)).json());
  assert.equal(retained.events.length, 4); assert.equal(retained.snapshot.status, accepted.event.snapshot.status);
  const publicText = await (await publicDetail()).text(); for (const u of users) assert(!publicText.includes(u.identity)); assert(!publicText.includes("Synthetic rejection"));
  // Exercise a second public page with actual signed writes/reviews, within caps.
  for (let i = 0; i < 21; i++) {
    const body = { ...input, request_id: crypto.randomUUID(), url: `https://example.com/pagination/${i}` };
    const response = await call("attention/submissions", body, users[Math.floor(i / 8)]!.cookie); assert.equal(response.status, 200);
    assert.equal((await call("admin/attention/review", { ...review, request_id: crypto.randomUUID(), submission_id: body.request_id, decision: "VISIBLE" }, undefined, true)).status, 200);
  }
  const first = ContentCampaignDetail.parse(await (await publicDetail()).json()); assert.equal(first.feed.submissions.length, 20); assert(first.feed.next_cursor);
  const second = ContentCampaignDetail.parse(await (await call(`attention/campaigns/${campaign.id}?cursor=${encodeURIComponent(first.feed.next_cursor)}`)).json()); assert(second.feed.submissions.length >= 1);
  assert.equal(new Set([...first.feed.submissions, ...second.feed.submissions].map(s => s.id)).size, first.feed.submissions.length + second.feed.submissions.length);
  const queue = ContentPage.parse(await (await call("admin/attention/queue", undefined, undefined, true)).json()); assert.equal(queue.submissions.length, 20);
  const target=first.feed.submissions[0]!,claim={request_id:crypto.randomUUID(),submission_id:target.id,category:"impersonation",reason:"Synthetic private report for isolated runtime review",evidence_url:"https://example.com/evidence",good_faith:true};
  assert.equal((await call("attention/reports",claim)).status,401);
  const reportResponse=await call("attention/reports",claim,users[1]!.cookie);assert.equal(reportResponse.status,200);
  const report=ContentReportRecord.parse(await reportResponse.json());assert.equal(report.snapshot.status,"OPEN");
  assert.equal((await call(`attention/reports/${claim.request_id}`,undefined,users[0]!.cookie)).status,404);
  const textWithReport=await (await publicDetail()).text();assert(!textWithReport.includes(claim.reason));assert(!textWithReport.includes(claim.request_id));
  const reportDecision={request_id:crypto.randomUUID(),report_id:claim.request_id,expected_revision:0,decision:"UPHELD",reason:"Synthetic operator reviewed the private concern"};
  assert.equal((await call("admin/attention/reports/review",reportDecision,undefined,true)).status,200);
  const held=ContentRecord.parse(await (await call(`admin/attention/submissions/${target.id}`,undefined,undefined,true)).json());assert.equal(held.visibility_held,true);assert.equal(held.snapshot.status,"VISIBLE");assert.equal(held.snapshot.reward_eligible,false);
  assert(!ContentCampaignDetail.parse(await (await publicDetail()).json()).feed.submissions.some(s=>s.id===target.id));
  const contributor=users.find(u=>u.identity===held.snapshot.identity_id)!;
  const outsider=users.find(u=>u.identity!==held.snapshot.identity_id)!;
  const holdRequest={request_id:crypto.randomUUID(),submission_id:target.id,note:"Synthetic contributor asks for a featuring hold review",reference_url:"https://example.com/public-permission"};
  assert.equal((await call("attention/hold-reviews",holdRequest)).status,401);
  assert.equal((await call("attention/hold-reviews",holdRequest,outsider.cookie)).status,404);
  const requested=await call("attention/hold-reviews",holdRequest,contributor.cookie);assert.equal(requested.status,200);
  const caseRecord=HoldReviewRecord.parse(await requested.json());assert.equal(caseRecord.snapshot.status,"OPEN");
  for(const secret of [claim.request_id,claim.reason,claim.evidence_url,reportDecision.reason])assert(!JSON.stringify(caseRecord).includes(secret));
  assert.equal((await call(`attention/hold-reviews/${holdRequest.request_id}`,undefined,outsider.cookie)).status,404);
  const caseReply={request_id:crypto.randomUUID(),review_id:holdRequest.request_id,expected_revision:0,decision:"NEEDS_INFO",note:"Synthetic moderator requests a public permission reference",reference_url:null};
  assert.equal((await call("admin/attention/hold-reviews/review",caseReply,undefined,true)).status,200);
  assert.equal((await call("attention/hold-reviews/respond",{...caseReply,request_id:crypto.randomUUID(),expected_revision:1,decision:"RESUBMITTED",note:"Synthetic contributor supplies the requested public reference"},contributor.cookie)).status,200);
  assert.equal((await call("admin/attention/hold-reviews/review",{...caseReply,request_id:crypto.randomUUID(),expected_revision:2,decision:"CLOSED",note:"Conversation closed; original hold requires separate review"},undefined,true)).status,200);
  const conversation=HoldReviewRecord.parse(await (await call(`attention/hold-reviews/${holdRequest.request_id}`,undefined,contributor.cookie)).json());
  assert.deepEqual(conversation.events.map(e=>e.snapshot.status),["OPEN","NEEDS_INFO","RESUBMITTED","CLOSED"]);assert.equal(conversation.visibility_held,true);
  const exportPath=`admin/attention/submissions/${target.id}/export`;
  assert.equal((await call(exportPath,undefined,contributor.cookie)).status,401);
  assert.equal((await call(exportPath,undefined,undefined,true,{origin:"https://evil.example"})).status,403);
  const exportedResponse=await call(exportPath,undefined,undefined,true);assert.equal(exportedResponse.status,200);assert.equal(exportedResponse.headers.get("cache-control"),"no-store");
  const exported=await verifyContentCaseExport(await exportedResponse.json());assert.equal(exported.visibility_held,true);assert.equal(exported.manifest.reports,1);assert.equal(exported.manifest.hold_reviews,1);assert.equal(exported.hold_reviews[0]!.events.length,4);
  const artifactFile=`${folder}/private-case.json`;writeFileSync(artifactFile,JSON.stringify(exported));
  const verifier=fileURLToPath(new URL("../scripts/verify-content-case-export.ts",import.meta.url)),tsx=fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs",import.meta.url));
  const offline=await execute(process.execPath,[tsx,verifier,artifactFile,exported.export_hash],options);assert.equal(JSON.parse(offline.stdout).verified,true);
  const wrongHash=exported.export_hash==="0".repeat(64)?"1".repeat(64):"0".repeat(64);
  await assert.rejects(execute(process.execPath,[tsx,verifier,artifactFile,wrongHash],options));
  assert.deepEqual(ContentRecord.parse(await (await call(`admin/attention/submissions/${target.id}`,undefined,undefined,true)).json()),held);
  assert.equal(HoldReviewPage.parse(await (await call("attention/hold-reviews/mine",undefined,contributor.cookie)).json()).reviews.length,1);
  assert.equal((await call("admin/attention/operations",undefined,contributor.cookie)).status,401);
  const operationsResponse=await call("admin/attention/operations",undefined,undefined,true);assert.equal(operationsResponse.status,200);assert.equal(operationsResponse.headers.get("cache-control"),"no-store");
  const operations=ContentOperations.parse(await operationsResponse.json());assert.equal(operations.integrity,"projection_counts_only");assert.equal(operations.source_requests,0);
  assert.deepEqual(operations.holds,{upheld_reports:1,held_submissions:1,visible_but_held:1});
  assert.equal(operations.quotas.find(q=>q.id==="hold_events")!.used,4);assert.equal(operations.storage.tables.find(t=>t.id==="hold_events")!.sampled_rows,4);
  assert.equal(operations.queues.find(q=>q.id==="resubmitted_hold_reviews")!.count,0);
  for(const secret of [claim.reason,claim.request_id,holdRequest.note,contributor.identity,target.content.canonical_url])assert(!JSON.stringify(operations).includes(secret));
  assert.equal((await call("admin/attention/reports/review",{...reportDecision,request_id:crypto.randomUUID(),expected_revision:1,decision:"RELEASED"},undefined,true)).status,200);
  assert(ContentCampaignDetail.parse(await (await publicDetail()).json()).feed.submissions.some(s=>s.id===target.id));
  const releasedOperations=ContentOperations.parse(await (await call("admin/attention/operations",undefined,undefined,true)).json());assert.equal(releasedOperations.holds.held_submissions,0);
  const releasedExport=await verifyContentCaseExport(await (await call(exportPath,undefined,undefined,true)).json());assert.equal(releasedExport.visibility_held,false);assert.deepEqual(releasedExport.hold_reviews,exported.hold_reviews);assert.deepEqual(releasedExport.content,exported.content);
  console.log(JSON.stringify({content_case_export:"private transactional snapshot and offline CLI verified",held_at_capture:exported.visibility_held,held_after_separate_release:releasedExport.visibility_held,history_events:exported.manifest.events,independent_checksum_mismatch:"rejected",artifact:artifactFile,provider_requests:0}));
  const reportHistory=ContentReportRecord.parse(await (await call(`attention/reports/${claim.request_id}`,undefined,users[1]!.cookie)).json());assert.deepEqual(reportHistory.events.map(e=>e.snapshot.status),["OPEN","UPHELD","RELEASED"]);
  assert.equal(ContentReportPage.parse(await (await call("attention/reports/mine",undefined,users[1]!.cookie)).json()).reports.length,1);
  assert.equal((await call("identity/logout", {}, users[0]!.cookie)).status, 200);
  assert.equal((await call("attention/mine", undefined, users[0]!.cookie)).status, 401);
  assert.equal((await call("attention/hold-reviews/mine",undefined,users[0]!.cookie)).status,401);
  console.log(JSON.stringify({contributor_hold_review:"owner-only request, one response, moderator closure, four verified events",original_hold:"retained after conversation closure",reporter_details:"not disclosed to contributor",content_operations:"private aggregate quotas, holds and bounded storage verified",provider_requests:0}));
  console.log(JSON.stringify({ isolated_workerd_d1: "passed", signed_submissions: true, canonical_duplicate: "rejected", private_inputs: "protected", competing_reviews: "one admission", owner_appeal: "verified", hash_history: "verified", public_pagination: "verified", private_reports:"verified",upheld_hold:"hidden without changing original status",released_hold:"ordinary visibility restored",report_history:"hash replay verified", revoked_session: "rejected", provider_requests: 0, user_wallets: "unused", live_application_database_writes: 0, rewards: false, deploy: false }, null, 2));
} finally {
  if (child.pid && child.exitCode === null) {
    if (process.platform === "win32") await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
    else child.kill("SIGTERM");
  }
}
