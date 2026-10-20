import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { identityRoute, requireContentIdentity } from "./identity";
import { canonicalContentUrl } from "./content-url";
import { changeContent, contentCampaign, contentCampaigns, contentPage, contentRecord, createContentCampaign, submitContent } from "./content";
import worker, { type LocalEnv } from "./worker";
import { toBase58 } from "./solana";
import {contentReportRecord,contentReports,reviewContentReport,submitContentReport} from "./content-reports";
import {holdReviewRecord,holdReviews,replyHoldReview,requestHoldReview} from "./content-holds";
import {contentOperations} from "./content-operations";
import {CONTENT_LIMITS} from "./content-limits";
const instances: DatabaseSync[] = [], origin = "https://app-local.10x.meme", token = "a".repeat(64);
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
async function fixture() {
  const sqlite = new DatabaseSync(":memory:"); instances.push(sqlite); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0018_solana_identity.sql", "0024_content_review.sql", "0026_content_reports.sql", "0027_content_hold_reviews.sql"]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const base = sqliteD1(sqlite); let tail: Promise<unknown> = Promise.resolve();
  const db = { ...base, batch(statements: D1PreparedStatement[]) { const result = tail.then(() => base.batch(statements)); tail = result.catch(() => {}); return result; } } as D1Database;
  const at = new Date();
  const env: LocalEnv = { TENX_DB: db, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: token, TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "5000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_PROVIDER: "dexscreener", TENX_QUALITY_ENABLED: "true", TENX_QUALITY_RPC_DAILY_LIMIT: "1800", TENX_MARKET_ENABLED: "false", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
  const request = (path: string, data?: unknown, cookie?: string, headers: Record<string, string> = {}) => new Request(`http://127.0.0.1:8794/api/10x/${path}`, { ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }), headers: { "x-10x-identity-origin": origin, ...(data === undefined ? {} : { origin, "content-type": "application/json", "x-tenx-identity": "1" }), ...(cookie ? { cookie } : {}), ...headers } });
  const call = (path: string, data?: unknown, cookie?: string, headers: Record<string, string> = {}) => worker.fetch(request(path, data, cookie, headers), env);
  async function login() {
    const secret = crypto.getRandomValues(new Uint8Array(32)), address = toBase58(ed25519.getPublicKey(secret));
    const challenge = await identityRoute(request("identity/challenge", { address, intent: "login" }), db, at), c = await challenge.json() as { challenge_id: string; message: string };
    const proof = { challenge_id: c.challenge_id, signature: btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(c.message), secret))) };
    const response = await identityRoute(request("identity/verify", proof, challenge.headers.get("set-cookie")!.split(";")[0]!), db, at);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const principal = await requireContentIdentity(request("attention/mine", undefined, cookie), db, at, false);
    return { cookie, principal, address };
  }
  const owner = await login(), other = await login();
  const campaignInput = { request_id: crypto.randomUUID(), title: "Local OG review", og_address: owner.address, reason: "Offline local content review test" };
  const campaign = await createContentCampaign(db, campaignInput, at);
  const input = (url = "https://example.com/posts/one") => ({ request_id: crypto.randomUUID(), campaign_id: campaign.id, url, category: "meme", author_claim: "Claimed contributor", comment: "OG content; authorship has not been verified", permission_to_feature: true, rights_confirmed: true });
  const review = (id: string, revision = 0, decision = "VISIBLE") => ({ request_id: crypto.randomUUID(), submission_id: id, expected_revision: revision, decision, reason: "Manual local review; authorship and metrics remain unverified" });
  return { sqlite, db, at, env, call, request, owner, other, login, campaign, campaignInput, input, review };
}
describe("private content operations",()=>{
  it("requires operator authorization, exposes only aggregate counters and performs no writes or provider calls",async()=>{
    const f=await fixture(),before=f.sqlite.prepare("SELECT total_changes() AS n").get(),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No provider requests"));
    expect((await f.call("admin/attention/operations")).status).toBe(401);
    expect((await f.call("admin/attention/operations",undefined,f.owner.cookie)).status).toBe(401);
    expect((await f.call("admin/attention/operations",undefined,undefined,{authorization:`Bearer ${token}`,origin:"https://evil.example"})).status).toBe(403);
    const response=await f.call("admin/attention/operations",undefined,undefined,{authorization:`Bearer ${token}`});expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("vary")).toBe("Cookie");
    const value=await response.json() as {queues:{count:number;oldest_wait_seconds:number|null}[];source_requests:number;integrity:string};
    expect(value.queues.every(q=>q.count===0&&q.oldest_wait_seconds===null)).toBe(true);expect(value.source_requests).toBe(0);expect(value.integrity).toBe("projection_counts_only");
    const text=JSON.stringify(value);for(const secret of [f.owner.principal.identity_id,f.owner.address,f.campaign.id,f.campaign.title,f.campaign.reason])expect(text).not.toContain(secret);
    expect(f.sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(before);expect(outside).not.toHaveBeenCalled();
  });
  it("counts pending/flagged/appealed content, independent holds and who owes a conversation response",async()=>{
    const f=await fixture();
    for(const state of ["PENDING","FLAGGED","APPEALED"]){const input=f.input(`https://example.com/ops/${state}`);await submitContent(f.db,input,f.owner.principal,f.at);if(state!=="PENDING")await changeContent(f.db,f.review(input.request_id,0,"FLAGGED"),null,f.at);if(state==="APPEALED")await changeContent(f.db,{request_id:crypto.randomUUID(),submission_id:input.request_id,expected_revision:1,reason:"Owner requests an additional editorial review"},f.owner.principal,f.at);}
    const input=f.input("https://example.com/ops/held");await submitContent(f.db,input,f.owner.principal,f.at);await changeContent(f.db,f.review(input.request_id),null,f.at);
    const claims=[];for(const user of [f.owner,f.other]){const claim={request_id:crypto.randomUUID(),submission_id:input.request_id,category:"impersonation",reason:"Private claimant text must never appear in aggregate output",evidence_url:"https://example.com/secret-reference",good_faith:true};await submitContentReport(f.db,claim,user.principal,f.at);claims.push(claim);}
    const reviewReport=(id:string)=>({request_id:crypto.randomUUID(),report_id:id,expected_revision:0,decision:"UPHELD",reason:"Operator has reviewed this concern independently"});
    await reviewContentReport(f.db,reviewReport(claims[0]!.request_id),f.at);
    const request={request_id:crypto.randomUUID(),submission_id:input.request_id,note:"Contributor privately requests a featuring hold review",reference_url:null};await requestHoldReview(f.db,request,f.owner.principal,f.at);
    const read=()=>contentOperations(f.db,f.at),getQueue=(data:Awaited<ReturnType<typeof read>>,id:string)=>data.queues.find(q=>q.id===id)!;
    let data=await read();for(const id of ["pending","flagged","appealed","open_reports","open_hold_reviews"])expect(getQueue(data,id).count).toBe(1);expect(data.holds).toEqual({upheld_reports:1,held_submissions:1,visible_but_held:1});
    const reply={request_id:crypto.randomUUID(),review_id:request.request_id,expected_revision:0,decision:"NEEDS_INFO",note:"Please supply the public permission reference",reference_url:null};
    await replyHoldReview(f.db,reply,null,f.at);data=await read();expect(getQueue(data,"open_hold_reviews").count).toBe(0);expect(getQueue(data,"contributor_response")).toMatchObject({count:1,waiting_on:"contributor"});
    await replyHoldReview(f.db,{...reply,request_id:crypto.randomUUID(),expected_revision:1,decision:"RESUBMITTED"},f.owner.principal,f.at);data=await read();expect(getQueue(data,"contributor_response").count).toBe(0);expect(getQueue(data,"resubmitted_hold_reviews")).toMatchObject({count:1,waiting_on:"moderator"});
    await replyHoldReview(f.db,{...reply,request_id:crypto.randomUUID(),expected_revision:2,decision:"CLOSED"},null,f.at);
    await reviewContentReport(f.db,reviewReport(claims[1]!.request_id),f.at);data=await read();expect(data.holds).toEqual({upheld_reports:2,held_submissions:1,visible_but_held:1});expect(getQueue(data,"resubmitted_hold_reviews").count).toBe(0);
    const text=JSON.stringify(data);for(const secret of [request.note,input.url,claims[0]!.reason,claims[0]!.evidence_url,claims[0]!.request_id,f.owner.principal.identity_id])expect(text).not.toContain(secret);
  });
  it("uses UTC admission windows and reports waiting age independently of the daily reset",async()=>{
    const f=await fixture(),input=f.input();await submitContent(f.db,input,f.owner.principal,f.at);
    const boundary=new Date(f.at.toISOString().slice(0,10)+"T00:00:00.000Z"),after=new Date(boundary.getTime()+86400000);
    let data=await contentOperations(f.db,f.at);expect(data.day_start).toBe(boundary.toISOString());expect(data.day_end).toBe(after.toISOString());expect(data.quotas.find(q=>q.id==="submissions")).toMatchObject({used:1,limit:CONTENT_LIMITS.submissions_per_day,remaining:99,resets_at:after.toISOString()});
    data=await contentOperations(f.db,new Date(f.at.getTime()+86400000));expect(data.queues.find(q=>q.id==="pending")).toMatchObject({count:1,waiting_24h:1,oldest_wait_seconds:86400});expect(data.quotas.find(q=>q.id==="submissions")!.used).toBe(0);expect(data.quotas.find(q=>q.id==="open_campaigns")).toMatchObject({used:1,remaining:9,resets_at:null});
    const expired=await contentOperations(f.db,new Date(f.campaign.ends_at));expect(expired.quotas.find(q=>q.id==="open_campaigns")!.used).toBe(0);
  });
  it("measures UTF-8 payload bytes, keeps samples bounded and never returns raw payloads",async()=>{
    const f=await fixture(),input={...f.input(),author_claim:"Meme creator 🐸",comment:"é語 🐸"};await submitContent(f.db,input,f.owner.principal,f.at);
    const snapshot=String(f.sqlite.prepare("SELECT snapshot FROM tenx_content_submissions WHERE id=?").get(input.request_id)!.snapshot);
    let data=await contentOperations(f.db,f.at);expect(data.storage.tables.find(t=>t.id==="submissions")).toMatchObject({total_rows:1,sampled_rows:1,sampled_bytes:Buffer.byteLength(snapshot,"utf8"),complete:true});
    // Isolated SQL fixture tests an oversized inventory without bypassing real API limits.
    const add=f.sqlite.prepare("INSERT INTO tenx_content_campaigns(id,created_at,ends_at,request_hash,record) VALUES(?,?,?,?,?)");
    for(let i=0;i<205;i++)add.run(crypto.randomUUID(),f.at.toISOString(),f.campaign.ends_at,"fixture",JSON.stringify({sample:"🐸"}));
    data=await contentOperations(f.db,f.at);const table=data.storage.tables.find(t=>t.id==="campaigns")!;expect(table.total_rows).toBe(206);expect(table.sampled_rows).toBe(200);expect(table.complete).toBe(false);expect(data.quotas.find(q=>q.id==="open_campaigns")).toMatchObject({used:206,remaining:0});
    expect(data.retention).toEqual({automatic_deletion:false,archive_policy:"not_configured",remote_capacity:"uncertified"});expect(JSON.stringify(data)).not.toContain("🐸");
  });
});

describe("private contributor hold reviews",()=>{
  async function held(f:Awaited<ReturnType<typeof fixture>>){
    const input=f.input(`https://example.com/held/${crypto.randomUUID()}`);
    await submitContent(f.db,input,f.owner.principal,f.at);await changeContent(f.db,f.review(input.request_id),null,f.at);
    const claim={request_id:crypto.randomUUID(),submission_id:input.request_id,category:"impersonation",reason:"Secret claimant explanation for moderators only",evidence_url:"https://example.com/private-claim-reference",good_faith:true};
    await submitContentReport(f.db,claim,f.other.principal,f.at);
    await reviewContentReport(f.db,{request_id:crypto.randomUUID(),report_id:claim.request_id,expected_revision:0,decision:"UPHELD",reason:"Private original moderator reasoning"},f.at);
    return {id:input.request_id,claim};
  }
  const request=(id:string)=>({request_id:crypto.randomUUID(),submission_id:id,note:"Contributor asks to review the featuring hold",reference_url:"https://example.com/permission?utm_source=test"});
  const reply=(id:string,revision=0,decision="NEEDS_INFO")=>({request_id:crypto.randomUUID(),review_id:id,expected_revision:revision,decision,note:"Public permission reference would help this review",reference_url:null});
  it("requires signed owner admission and keeps original complaints and conversations private",async()=>{
    const f=await fixture(),target=await held(f),input=request(target.id),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No source requests"));
    expect((await f.call("attention/hold-reviews",input)).status).toBe(401);
    expect((await f.call("attention/hold-reviews",input,f.other.cookie)).status).toBe(404);
    expect((await f.call("attention/hold-reviews",input,f.owner.cookie,{origin:"https://evil.example"})).status).toBe(403);
    expect((await f.call("attention/hold-reviews",input,f.owner.cookie,{"x-tenx-identity":""})).status).toBe(403);
    expect((await f.call("attention/hold-reviews",{...input,note:"x".repeat(4500)},f.owner.cookie)).status).toBe(413);
    expect((await f.call("attention/hold-reviews",{...input,owner_identity_id:f.owner.principal.identity_id},f.owner.cookie)).status).toBe(400);
    const response=await f.call("attention/hold-reviews",input,f.owner.cookie);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("vary")).toBe("Cookie");
    const text=await response.text();for(const secret of [target.claim.request_id,target.claim.reason,target.claim.evidence_url,f.other.principal.identity_id,"Private original moderator reasoning"])expect(text).not.toContain(secret);
    expect(text).toContain("https://example.com/permission");
    expect((await f.call(`attention/hold-reviews/${input.request_id}`,undefined,f.other.cookie)).status).toBe(404);
    expect((await f.call(`admin/attention/hold-reviews/${input.request_id}`)).status).toBe(401);
    expect((await holdReviews(f.db,{owner:f.other.principal.identity_id,cursor:null})).reviews).toEqual([]);
    expect((await holdReviews(f.db,{owner:f.owner.principal.identity_id,cursor:null})).reviews).toHaveLength(1);
    expect(outside).not.toHaveBeenCalled();
  });
  it("bounds the information round, replays all messages and never releases a hold or rewrites source content",async()=>{
    const f=await fixture(),target=await held(f),before=(await contentRecord(f.db,target.id))!,claimBefore=await contentReportRecord(f.db,target.claim.request_id),input=request(target.id);
    const initial=await requestHoldReview(f.db,input,f.owner.principal,f.at);
    await expect(replyHoldReview(f.db,reply(input.request_id),f.owner.principal,f.at)).rejects.toThrow("hold_review_invalid_transition");
    await expect(replyHoldReview(f.db,reply(input.request_id,0,"RESUBMITTED"),null,f.at)).rejects.toThrow("hold_review_invalid_transition");
    await replyHoldReview(f.db,reply(input.request_id),null,f.at);
    await replyHoldReview(f.db,reply(input.request_id,1,"RESUBMITTED"),f.owner.principal,f.at);
    await expect(replyHoldReview(f.db,reply(input.request_id,2),null,f.at)).rejects.toThrow("hold_review_invalid_transition");
    const close=reply(input.request_id,2,"CLOSED"),closed=await replyHoldReview(f.db,close,null,f.at);
    expect(closed.events.map(e=>e.snapshot.status)).toEqual(["OPEN","NEEDS_INFO","RESUBMITTED","CLOSED"]);expect(closed.replay).toBe("verified");expect(closed.visibility_held).toBe(true);
    expect(await contentRecord(f.db,target.id)).toEqual(before);expect(await contentReportRecord(f.db,target.claim.request_id)).toEqual(claimBefore);
    expect((await contentPage(f.db,{campaign:f.campaign.id,public:true,cursor:null},f.at)).submissions).toEqual([]);
    expect(await replyHoldReview(f.db,close,null,f.at)).toEqual(closed);
    expect((await requestHoldReview(f.db,input,f.owner.principal,f.at)).events).toHaveLength(4);
    await expect(requestHoldReview(f.db,request(target.id),f.owner.principal,f.at)).rejects.toThrow("hold_review_already_requested");
    expect(initial.events).toHaveLength(1);
    await reviewContentReport(f.db,{request_id:crypto.randomUUID(),report_id:target.claim.request_id,expected_revision:1,decision:"RELEASED",reason:"Original report reviewed separately and hold released"},f.at);
    const released=(await holdReviewRecord(f.db,input.request_id))!;expect(released.events).toEqual(closed.events);expect(released.visibility_held).toBe(false);
  });
  it("rejects unheld targets and unsafe references, with idempotent and concurrent admission",async()=>{
    const f=await fixture(),unheld=f.input();await submitContent(f.db,unheld,f.owner.principal,f.at);
    await expect(requestHoldReview(f.db,request(unheld.request_id),f.owner.principal,f.at)).rejects.toThrow("held_content_not_found");
    const target=await held(f),input=request(target.id);
    await expect(requestHoldReview(f.db,{...input,reference_url:"https://127.0.0.1/private"},f.owner.principal,f.at)).rejects.toThrow();
    const inputs=[input,request(target.id)],concurrent=await Promise.allSettled(inputs.map(value=>requestHoldReview(f.db,value,f.owner.principal,f.at)));
    expect(concurrent.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const admitted=inputs[concurrent.findIndex(r=>r.status==="fulfilled")]!;
    await expect(requestHoldReview(f.db,{...admitted,note:"Different message under a reused request ID"},f.owner.principal,f.at)).rejects.toThrow("hold_review_request_conflict");
    const replies=[reply(admitted.request_id),reply(admitted.request_id,0,"CLOSED")],competing=await Promise.allSettled(replies.map(value=>replyHoldReview(f.db,value,null,f.at)));
    expect(competing.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect((await holdReviewRecord(f.db,admitted.request_id))!.events).toHaveLength(2);
    const acceptedReply=replies[competing.findIndex(r=>r.status==="fulfilled")]!;
    await expect(replyHoldReview(f.db,{...acceptedReply,note:"Reusing an event ID with different content"},null,f.at)).rejects.toThrow("hold_review_request_conflict");
  });
  it("enforces session revocation inside atomic writes and rolls back failed event insertion",async()=>{
    const f=await fixture(),target=await held(f),another=await held(f),input=request(target.id);
    f.sqlite.exec("CREATE TRIGGER fail_hold_event BEFORE INSERT ON tenx_content_hold_events BEGIN SELECT RAISE(ABORT,'test_hold_failure'); END");
    await expect(requestHoldReview(f.db,input,f.owner.principal,f.at)).rejects.toThrow("test_hold_failure");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_content_hold_reviews").get()).toEqual({n:0});f.sqlite.exec("DROP TRIGGER fail_hold_event");
    await requestHoldReview(f.db,input,f.owner.principal,f.at);await replyHoldReview(f.db,reply(input.request_id),null,f.at);
    f.sqlite.prepare("UPDATE tenx_identity_sessions SET revoked_at=? WHERE identity_id=?").run(f.at.toISOString(),f.owner.principal.identity_id);
    await expect(replyHoldReview(f.db,reply(input.request_id,1,"RESUBMITTED"),f.owner.principal,f.at)).rejects.toThrow("hold_review_revision_session_or_daily_limit");
    expect((await holdReviewRecord(f.db,input.request_id))!.snapshot.status).toBe("NEEDS_INFO");
    await expect(requestHoldReview(f.db,request(another.id),f.owner.principal,f.at)).rejects.toThrow("hold_review_limit_session_or_hold_changed");
  });
  it("refuses a new conversation if the verified hold set changes before its atomic insert",async()=>{
    const f=await fixture(),target=await held(f),input=request(target.id);let intercepted=false;
    const racing={...f.db,async batch(statements:D1PreparedStatement[]){
      if(!intercepted){intercepted=true;await reviewContentReport(f.db,{request_id:crypto.randomUUID(),report_id:target.claim.request_id,expected_revision:1,decision:"RELEASED",reason:"Separate release during contributor request admission"},f.at);}
      return f.db.batch(statements);
    }} as D1Database;
    await expect(requestHoldReview(racing,input,f.owner.principal,f.at)).rejects.toThrow("hold_review_limit_session_or_hold_changed");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_content_hold_reviews").get()).toEqual({n:0});
    expect((await contentRecord(f.db,target.id))!.visibility_held).toBe(false);
  });
  it("rejects reused reply IDs as new cases without leaving an unauditable projection",async()=>{
    const f=await fixture(),target=await held(f),input=request(target.id);await requestHoldReview(f.db,input,f.owner.principal,f.at);
    const response=reply(input.request_id);await replyHoldReview(f.db,response,null,f.at);
    const another=await held(f);
    await expect(requestHoldReview(f.db,{...request(another.id),request_id:response.request_id},f.owner.principal,f.at)).rejects.toThrow("hold_review_request_conflict");
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_content_hold_reviews").get()).toEqual({n:1});
  });
  it("rechecks the session after a slowly streamed hold request body",async()=>{
    const f=await fixture(),target=await held(f),input=request(target.id);
    const body=new ReadableStream<Uint8Array>({pull(controller){
      f.sqlite.prepare("UPDATE tenx_identity_sessions SET revoked_at=? WHERE identity_id=?").run(f.at.toISOString(),f.owner.principal.identity_id);
      controller.enqueue(new TextEncoder().encode(JSON.stringify(input)));controller.close();
    }},{highWaterMark:0});
    const headers=f.request("attention/hold-reviews",{},f.owner.cookie).headers;
    const delayed=new Request("http://127.0.0.1:8794/api/10x/attention/hold-reviews",{method:"POST",headers,body,duplex:"half"} as RequestInit);
    expect((await worker.fetch(delayed,f.env)).status).toBe(401);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_content_hold_reviews").get()).toEqual({n:0});
  });
  it("fails closed on changed audit history or mismatched source content and preserves immutable records",async()=>{
    const f=await fixture(),target=await held(f),input=request(target.id);await requestHoldReview(f.db,input,f.owner.principal,f.at);
    expect(()=>f.sqlite.exec("DELETE FROM tenx_content_hold_events")).toThrow("immutable_hold_event");
    expect(()=>f.sqlite.exec("DELETE FROM tenx_content_hold_reviews")).toThrow("immutable_hold_identity");
    expect(()=>f.sqlite.exec("UPDATE tenx_content_hold_reviews SET hold_set_hash='bad'")).toThrow("immutable_hold_identity");
    f.sqlite.exec("DROP TRIGGER tenx_hold_event_no_update");
    const row=f.sqlite.prepare("SELECT event FROM tenx_content_hold_events WHERE id=?").get(input.request_id) as {event:string},event=JSON.parse(row.event);event.note="A tampered contributor message";
    f.sqlite.prepare("UPDATE tenx_content_hold_events SET event=? WHERE id=?").run(JSON.stringify(event),input.request_id);
    await expect(holdReviewRecord(f.db,input.request_id)).rejects.toThrow("hold_review_history_integrity_failed");
    await expect(holdReviews(f.db,{owner:f.owner.principal.identity_id,cursor:null})).rejects.toThrow("hold_review_history_integrity_failed");
  });
  it("enforces per-owner daily admission without suppressing existing conversations",async()=>{
    const f=await fixture();
    for(let i=0;i<3;i++){const target=await held(f);await requestHoldReview(f.db,request(target.id),f.owner.principal,f.at);}
    // Reporting also has its own three/day bound; use a different claimant for the fourth target.
    const claimant=await f.login(),input=f.input("https://example.com/fourth");await submitContent(f.db,input,f.owner.principal,f.at);await changeContent(f.db,f.review(input.request_id),null,f.at);
    const claim={request_id:crypto.randomUUID(),submission_id:input.request_id,category:"impersonation",reason:"Another private concern requiring review",evidence_url:null,good_faith:true};await submitContentReport(f.db,claim,claimant.principal,f.at);await reviewContentReport(f.db,{request_id:crypto.randomUUID(),report_id:claim.request_id,expected_revision:0,decision:"UPHELD",reason:"An additional held target for the daily bound"},f.at);
    await expect(requestHoldReview(f.db,request(input.request_id),f.owner.principal,f.at)).rejects.toThrow("hold_review_limit_session_or_hold_changed");
    const page=await holdReviews(f.db,{owner:f.owner.principal.identity_id,cursor:null},f.at);expect(page.reviews).toHaveLength(3);expect(page.next_cursor).toBeNull();
    expect((await holdReviews(f.db,{owner:f.owner.principal.identity_id,cursor:`${page.reviews[0]!.updated_at}|${page.reviews[0]!.id}`},f.at)).reviews).toHaveLength(2);
    await expect(holdReviews(f.db,{status:"UPHELD",cursor:null})).rejects.toThrow();
  });
});

describe("safe URL identity without network access", () => {
  it("deduplicates platform aliases and tracking while preserving meaningful web query/path distinctions", () => {
    expect(canonicalContentUrl("https://twitter.com/Alice/status/12345?utm_source=x#text")).toEqual(canonicalContentUrl("https://x.com/i/status/12345"));
    expect(canonicalContentUrl("https://x.com/Alice/status/12345/photo/1")).toEqual(canonicalContentUrl("https://x.com/i/status/12345"));
    expect(canonicalContentUrl("https://youtu.be/dQw4w9WgXcQ?si=tracking")).toEqual(canonicalContentUrl("https://youtube.com/watch?v=dQw4w9WgXcQ&feature=shared"));
    expect(canonicalContentUrl("https://warpcast.com/alice/0x12345678").platform).toBe("farcaster");
    expect(canonicalContentUrl("https://example.com/a?b=2&a=1&utm_campaign=x#part").canonical_url).toBe("https://example.com/a?a=1&b=2");
    expect(canonicalContentUrl("https://example.com/a/")).not.toEqual(canonicalContentUrl("https://example.com/a"));
    expect(canonicalContentUrl("https://example.com/a?feature=1")).not.toEqual(canonicalContentUrl("https://example.com/a?feature=2"));
  });
  it("rejects executable, credential-bearing and local/private literal URLs", () => {
    for (const value of ["javascript:alert(1)", "http://example.com/", "https://user:pass@example.com/", "https://127.0.0.1/x", "https://2130706433/x", "https://[::1]/", "https://localhost/x", "https://a.local/x", "https://example.com:8443/", "https://example.com/?api_key=private", "https://example.com/\n"]) expect(() => canonicalContentUrl(value)).toThrow();
  });
});

describe("private content reports and independent visibility holds",()=>{
  async function published(f:Awaited<ReturnType<typeof fixture>>,suffix=crypto.randomUUID()){
    const input=f.input(`https://example.com/reportable/${suffix}`);await submitContent(f.db,input,f.owner.principal,f.at);await changeContent(f.db,f.review(input.request_id),null,f.at);return input.request_id;
  }
  const report=(id:string)=>({request_id:crypto.randomUUID(),submission_id:id,category:"rights_or_permission",reason:"Private evidence of missing permission",evidence_url:"https://example.com/public-reference?utm_source=test",good_faith:true});
  const review=(id:string,revision=0,decision="UPHELD")=>({request_id:crypto.randomUUID(),report_id:id,expected_revision:revision,decision,reason:"Local moderator reviewed the evidence carefully"});
  it("requires a signed session and keeps allegations, references and reporter identity private",async()=>{
    const f=await fixture(),id=await published(f),input=report(id),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No external requests"));
    expect((await f.call("attention/reports",input)).status).toBe(401);
    expect((await f.call("attention/reports",input,f.other.cookie,{origin:"https://evil.example"})).status).toBe(403);
    expect((await f.call("attention/reports",input,f.other.cookie,{"x-tenx-identity":""})).status).toBe(403);
    expect((await f.call("attention/reports",{...input,reason:"x".repeat(4500)},f.other.cookie)).status).toBe(413);
    expect((await f.call("attention/reports",{...input,good_faith:false},f.other.cookie)).status).toBe(400);
    const response=await f.call("attention/reports",input,f.other.cookie);expect(response.status).toBe(200);expect(response.headers.get("vary")).toBe("Cookie");expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await contentRecord(f.db,id))!.visibility_held).toBe(false);
    const publicResponse=await f.call(`attention/campaigns/${f.campaign.id}`),text=await publicResponse.text();expect(text).toContain(id);
    for(const secret of [input.reason,"public-reference",f.other.principal.identity_id,input.request_id])expect(text).not.toContain(secret);
    expect((await f.call(`attention/reports/${input.request_id}`,undefined,f.owner.cookie)).status).toBe(404);
    expect((await f.call(`admin/attention/reports/${input.request_id}`)).status).toBe(401);
    expect((await f.call("admin/attention/reports/review",review(input.request_id),f.other.cookie)).status).toBe(401);
    expect((await contentReports(f.db,{owner:f.owner.principal.identity_id,cursor:null})).reports).toEqual([]);
    expect((await contentReports(f.db,{owner:f.other.principal.identity_id,cursor:null})).reports).toHaveLength(1);expect(outside).not.toHaveBeenCalled();
  });
  it("holds upheld reports independently of content appeals and never rewrites original hashes or grants rewards",async()=>{
    const f=await fixture(),id=await published(f),before=(await contentRecord(f.db,id))!,input=report(id);
    await submitContentReport(f.db,input,f.other.principal,f.at);await reviewContentReport(f.db,review(input.request_id),f.at);
    const held=(await contentRecord(f.db,id))!;expect(held.snapshot).toEqual(before.snapshot);expect(held.events).toEqual(before.events);expect(held.visibility_held).toBe(true);expect(held.snapshot.reward_eligible).toBe(false);
    expect((await contentPage(f.db,{campaign:f.campaign.id,public:true,cursor:null},f.at)).submissions).toEqual([]);
    const own=await contentPage(f.db,{owner:f.owner.principal.identity_id,cursor:null},f.at);expect(own.held_submission_ids).toEqual([id]);expect(JSON.stringify(own)).not.toContain(input.reason);
    await changeContent(f.db,f.review(id,1,"FLAGGED"),null,f.at);
    await changeContent(f.db,{request_id:crypto.randomUUID(),submission_id:id,expected_revision:2,reason:"Owner requests another ordinary content review"},f.owner.principal,f.at);
    await changeContent(f.db,f.review(id,3,"VISIBLE"),null,f.at);
    expect((await contentPage(f.db,{campaign:f.campaign.id,public:true,cursor:null},f.at)).submissions).toEqual([]);
    await reviewContentReport(f.db,review(input.request_id,1,"RELEASED"),f.at);
    expect((await contentPage(f.db,{campaign:f.campaign.id,public:true,cursor:null},f.at)).submissions).toHaveLength(1);
    expect((await contentReportRecord(f.db,input.request_id))!.events.map(e=>e.snapshot.status)).toEqual(["OPEN","UPHELD","RELEASED"]);
  });
  it("requires all independent holds to release and keeps ordinary rejected content hidden afterward",async()=>{
    const f=await fixture(),third=await f.login(),id=await published(f),a=report(id),b=report(id);
    await submitContentReport(f.db,a,f.other.principal,f.at);await submitContentReport(f.db,b,third.principal,f.at);
    await reviewContentReport(f.db,review(a.request_id),f.at);await reviewContentReport(f.db,review(b.request_id),f.at);
    await reviewContentReport(f.db,review(a.request_id,1,"RELEASED"),f.at);expect((await contentRecord(f.db,id))!.visibility_held).toBe(true);
    await changeContent(f.db,f.review(id,1,"REJECTED"),null,f.at);await reviewContentReport(f.db,review(b.request_id,1,"RELEASED"),f.at);
    expect((await contentRecord(f.db,id))!.visibility_held).toBe(false);expect((await contentPage(f.db,{campaign:f.campaign.id,public:true,cursor:null},f.at)).submissions).toEqual([]);
  });
  it("deduplicates report races and retries without appending a second claim or changed review",async()=>{
    const f=await fixture(),id=await published(f),input=report(id);
    const records=await Promise.all([submitContentReport(f.db,input,f.other.principal,f.at),submitContentReport(f.db,input,f.other.principal,f.at)]);expect(records[0]).toEqual(records[1]);
    await expect(submitContentReport(f.db,{...input,request_id:crypto.randomUUID()},f.other.principal,f.at)).rejects.toMatchObject({message:"content_already_reported"});
    await expect(submitContentReport(f.db,{...input,reason:"A changed private allegation"},f.other.principal,f.at)).rejects.toMatchObject({message:"content_report_request_conflict"});
    const decision=review(input.request_id);await reviewContentReport(f.db,decision,f.at);await reviewContentReport(f.db,review(input.request_id,1,"RELEASED"),f.at);
    expect((await reviewContentReport(f.db,decision,f.at)).snapshot.status).toBe("RELEASED");
    expect((await contentReportRecord(f.db,input.request_id))!.events).toHaveLength(3);
    await expect(reviewContentReport(f.db,{...decision,reason:"Changed reuse of the same review request"},f.at)).rejects.toMatchObject({message:"content_report_request_conflict"});
  });
  it("atomically rolls back create/review faults and admits one competing moderator decision",async()=>{
    const f=await fixture(),id=await published(f),input=report(id);
    f.sqlite.exec("CREATE TRIGGER report_fault BEFORE INSERT ON tenx_content_report_events BEGIN SELECT RAISE(ABORT,'report fault'); END");
    await expect(submitContentReport(f.db,input,f.other.principal,f.at)).rejects.toThrow("report fault");expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_content_reports").get()?.n).toBe(0);f.sqlite.exec("DROP TRIGGER report_fault");
    await submitContentReport(f.db,input,f.other.principal,f.at);
    f.sqlite.exec("CREATE TRIGGER report_fault BEFORE UPDATE ON tenx_content_reports BEGIN SELECT RAISE(ABORT,'report fault'); END");
    await expect(reviewContentReport(f.db,review(input.request_id),f.at)).rejects.toThrow("report fault");expect((await contentReportRecord(f.db,input.request_id))!.events).toHaveLength(1);f.sqlite.exec("DROP TRIGGER report_fault");
    const results=await Promise.allSettled([reviewContentReport(f.db,review(input.request_id),f.at),reviewContentReport(f.db,review(input.request_id,0,"DISMISSED"),f.at)]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect((await contentReportRecord(f.db,input.request_id))!.events).toHaveLength(2);
  });
  it("bounds concurrent reporter, global and per-submission admissions without hiding unreviewed claims",async()=>{
    const f=await fixture(),targets:string[]=[];for(let n=0;n<4;n++)targets.push(await published(f));
    const attempts=await Promise.allSettled(targets.map(id=>submitContentReport(f.db,report(id),f.other.principal,f.at)));expect(attempts.filter(r=>r.status==="fulfilled")).toHaveLength(3);
    const users:Awaited<ReturnType<typeof f.login>>[]=[];for(let n=0;n<10;n++)users.push(await f.login());
    const global=await Promise.allSettled(Array.from({length:30},(_,n)=>submitContentReport(f.db,report(targets[n%4]!),users[Math.floor(n/3)]!.principal,f.at)));expect(global.filter(r=>r.status==="fulfilled")).toHaveLength(27);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_content_reports").get()?.n).toBe(30);expect((await contentPage(f.db,{campaign:f.campaign.id,public:true,cursor:null},f.at)).submissions).toHaveLength(4);
    const first=await contentReports(f.db,{status:"OPEN",cursor:null},f.at);expect(first.reports).toHaveLength(20);expect(first.next_cursor).not.toBeNull();
    const second=await contentReports(f.db,{status:"OPEN",cursor:first.next_cursor},f.at);expect(second.reports).toHaveLength(10);expect(new Set([...first.reports,...second.reports].map(r=>r.id)).size).toBe(30);
  });
  it("caps one target at ten reports and refuses hidden targets, unsafe reference URLs and revoked sessions",async()=>{
    const f=await fixture(),id=await published(f),users=[f.other];for(let n=0;n<10;n++)users.push(await f.login());
    const results=await Promise.allSettled(users.map(u=>submitContentReport(f.db,report(id),u.principal,f.at)));expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(10);
    const hidden=f.input();await submitContent(f.db,hidden,f.owner.principal,f.at);await expect(submitContentReport(f.db,report(hidden.request_id),f.other.principal,f.at)).rejects.toMatchObject({status:404});
    await expect(submitContentReport(f.db,{...report(id),evidence_url:"https://127.0.0.1/private"},f.owner.principal,f.at)).rejects.toThrow();
    const another=await published(f);f.sqlite.prepare("UPDATE tenx_identity_sessions SET revoked_at=? WHERE token_hash=?").run(f.at.toISOString(),f.other.principal.token_hash);
    await expect(submitContentReport(f.db,report(another),f.other.principal,f.at)).rejects.toMatchObject({message:"content_report_limit_or_session_changed"});
  });
  it("detects report history/projection corruption before exposing a public link and preserves immutable events",async()=>{
    const f=await fixture(),id=await published(f),input=report(id);await submitContentReport(f.db,input,f.other.principal,f.at);
    expect(()=>f.sqlite.exec("UPDATE tenx_content_report_events SET request_hash='bad'")).toThrow("immutable_report_event");expect(()=>f.sqlite.exec("DELETE FROM tenx_content_reports")).toThrow("immutable_report_identity");
    f.sqlite.exec("DROP TRIGGER tenx_report_event_no_update");const row=f.sqlite.prepare("SELECT id,event FROM tenx_content_report_events").get()!,event=JSON.parse(String(row.event));event.reason="Changed historical private explanation";f.sqlite.prepare("UPDATE tenx_content_report_events SET event=? WHERE id=?").run(JSON.stringify(event),String(row.id));
    await expect(contentReportRecord(f.db,input.request_id)).rejects.toMatchObject({message:"content_report_history_integrity_failed"});
    await expect(contentPage(f.db,{campaign:f.campaign.id,public:true,cursor:null},f.at)).rejects.toMatchObject({message:"content_report_history_integrity_failed"});
  });
  it("preserves references without fetching them and enforces strict revision/time transitions",async()=>{
    const f=await fixture(),id=await published(f),input=report(id),saved=await submitContentReport(f.db,input,f.other.principal,f.at);
    expect(saved.snapshot.evidence_url).toBe("https://example.com/public-reference");
    await expect(reviewContentReport(f.db,review(input.request_id,0,"RELEASED"),f.at)).rejects.toMatchObject({message:"content_report_invalid_transition"});
    await expect(reviewContentReport(f.db,review(input.request_id),new Date(f.at.getTime()-1))).rejects.toMatchObject({message:"content_report_time_conflict"});
    await reviewContentReport(f.db,review(input.request_id,0,"DISMISSED"),f.at);
    await expect(reviewContentReport(f.db,review(input.request_id,1,"UPHELD"),f.at)).rejects.toMatchObject({message:"content_report_invalid_transition"});
    await expect(contentReports(f.db,{cursor:"not-a-cursor"},f.at)).rejects.toThrow();
  });
});
describe("signed content submission and moderation", () => {
  it("keeps pending inputs private, makes only manually visible content public, and never asserts authorship or rewards", async () => {
    const f = await fixture(), outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No outbound services"));
    const input = f.input(), response = await f.call("attention/submissions", input, f.owner.cookie); expect(response.status).toBe(200);
    const saved = await response.json() as { snapshot: { id: string } };
    expect((await contentPage(f.db, { campaign: f.campaign.id, public: true, cursor: null })).submissions).toHaveLength(0);
    expect((await f.call(`attention/mine/${saved.snapshot.id}`, undefined, f.other.cookie)).status).toBe(404);
    expect((await f.call(`admin/attention/submissions/${saved.snapshot.id}`)).status).toBe(401);
    expect((await f.call("admin/attention/review", f.review(input.request_id), undefined, { authorization: `Bearer ${token}` })).status).toBe(200);
    const publicResult = await f.call(`attention/campaigns/${f.campaign.id}`), text = await publicResult.text();
    expect(text).toContain('"VISIBLE"'); expect(text).toContain('"authorship":"unverified"'); expect(text).toContain('"reward_eligible":false');
    for (const value of [f.owner.principal.identity_id, f.owner.address, "local_operator", "Manual local review", "Offline local content review test"]) {
      // The campaign intentionally publishes the OG mint, but never the contributor identity.
      if (value !== f.owner.address) expect(text).not.toContain(value);
    }
    expect(publicResult.headers.get("cache-control")).toBe("no-store"); expect(publicResult.headers.get("vary")).toBe("Cookie");
    expect((await contentRecord(f.db, input.request_id))!.events).toHaveLength(2); expect(outbound).not.toHaveBeenCalled();
  });
  it("deduplicates canonical URLs atomically and returns idempotent retries without another audit event", async () => {
    const f = await fixture(), input = f.input("https://twitter.com/alice/status/12345?utm_source=test");
    const results = await Promise.all([submitContent(f.db, input, f.owner.principal, f.at), submitContent(f.db, input, f.owner.principal, f.at)]);
    expect(results[0]).toEqual(results[1]);
    await expect(submitContent(f.db, { ...input, request_id: crypto.randomUUID(), url: "https://x.com/i/status/12345" }, f.other.principal, f.at)).rejects.toMatchObject({ message: "content_url_already_submitted" });
    await expect(submitContent(f.db, { ...input, comment: "changed" }, f.owner.principal, f.at)).rejects.toMatchObject({ message: "content_request_conflict" });
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_content_events").get()?.n).toBe(1);
    const second = await createContentCampaign(f.db, { ...f.campaignInput, request_id: crypto.randomUUID() }, f.at);
    expect((await submitContent(f.db, { ...input, request_id: crypto.randomUUID(), campaign_id: second.id }, f.owner.principal, f.at)).snapshot.status).toBe("FLAGGED");
  });
  it("rejects stale reviews, supports owner appeals and hides takedowns immediately", async () => {
    const f = await fixture(), input = f.input(); await submitContent(f.db, input, f.owner.principal, f.at);
    const r = f.review(input.request_id, 0, "REJECTED"); await changeContent(f.db, r, null, f.at);
    const appeal = { request_id: crypto.randomUUID(), submission_id: input.request_id, expected_revision: 1, reason: "Please reconsider the attribution" };
    await expect(changeContent(f.db, appeal, f.other.principal, f.at)).rejects.toMatchObject({ status: 404 });
    await changeContent(f.db, appeal, f.owner.principal, f.at);
    await expect(changeContent(f.db, f.review(input.request_id, 1), null, f.at)).rejects.toMatchObject({ message: "content_revision_conflict" });
    const visible = f.review(input.request_id, 2); const accepted = await changeContent(f.db, visible, null, f.at);
    await changeContent(f.db, f.review(input.request_id, 3, "FLAGGED"), null, f.at);
    expect((await contentPage(f.db, { campaign: f.campaign.id, public: true, cursor: null })).submissions).toHaveLength(0);
    expect(await changeContent(f.db, visible, null, f.at)).toEqual(accepted);
    expect((await contentRecord(f.db, input.request_id))!.events.map(e => e.action)).toEqual(["submit", "review", "appeal", "review", "review"]);
  });
  it("admits only one competing review and rolls back both projection and event on a write fault", async () => {
    const f = await fixture(), input = f.input(); await submitContent(f.db, input, f.owner.principal, f.at);
    f.sqlite.exec("CREATE TRIGGER content_fault BEFORE UPDATE ON tenx_content_submissions BEGIN SELECT RAISE(ABORT,'test content fault'); END");
    await expect(changeContent(f.db, f.review(input.request_id), null, f.at)).rejects.toThrow("test content fault");
    expect((await contentRecord(f.db, input.request_id))!.events).toHaveLength(1);
    f.sqlite.exec("DROP TRIGGER content_fault");
    const results = await Promise.allSettled([changeContent(f.db, f.review(input.request_id), null, f.at), changeContent(f.db, f.review(input.request_id, 0, "REJECTED"), null, f.at)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await contentRecord(f.db, input.request_id))!.events).toHaveLength(2);
  });
  it("enforces campaign end, identity quota and database session rechecks without relaxing gates", async () => {
    const f = await fixture();
    for (let i = 0; i < 12; i++) {
      const result = await f.call("attention/submissions", f.input(`https://example.com/${i}`), f.owner.cookie);
      expect(result.status).toBe(i < 10 ? 200 : 429);
    }
    await expect(submitContent(f.db, f.input(), f.other.principal, new Date(f.campaign.ends_at))).rejects.toMatchObject({ message: "content_campaign_not_open" });
    f.sqlite.prepare("UPDATE tenx_identity_sessions SET revoked_at=? WHERE token_hash=?").run(f.at.toISOString(), f.other.principal.token_hash);
    await expect(submitContent(f.db, f.input(), f.other.principal, f.at)).rejects.toMatchObject({ status: 429 });
    expect((await f.call("attention/mine", undefined, f.other.cookie)).status).toBe(401);
  });
  it("requires consent, CSRF headers and operator authorization; supports bounded cursors", async () => {
    const f = await fixture(), input = f.input();
    expect((await f.call("attention/submissions", input)).status).toBe(401);
    expect((await f.call("attention/submissions", input, f.owner.cookie, { origin: "https://evil.example" })).status).toBe(403);
    expect((await f.call("attention/submissions", input, f.owner.cookie, { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await f.call("attention/submissions", input, f.owner.cookie, { "x-tenx-identity": "0" })).status).toBe(403);
    expect((await f.call("attention/submissions", { ...input, permission_to_feature: false }, f.owner.cookie)).status).toBe(400);
    expect((await f.call("admin/attention/queue", undefined, undefined, { authorization: token })).status).toBe(401);
    expect((await f.call("attention/campaigns?cursor=bad")).status).toBe(400);
    expect((await f.call("attention/submissions", { ...input, url: "https://example.com/" + "x".repeat(4500) }, f.owner.cookie)).status).toBe(413);
    expect((await contentCampaigns(f.db, null)).campaigns).toHaveLength(1);
  });
  it("enforces immutable campaign/event records and detects projection tampering", async () => {
    const f = await fixture(), input = f.input(); await submitContent(f.db, input, f.owner.principal, f.at);
    expect(() => f.sqlite.exec("DELETE FROM tenx_content_events")).toThrow("immutable");
    expect(() => f.sqlite.exec("UPDATE tenx_content_campaigns SET ends_at='2099-01-01'")).toThrow("immutable");
    f.sqlite.prepare("UPDATE tenx_content_submissions SET status='VISIBLE' WHERE id=?").run(input.request_id);
    await expect(contentRecord(f.db, input.request_id)).rejects.toMatchObject({ status: 503 });
    expect((await f.call(`attention/campaigns/${f.campaign.id}`)).status).toBe(503);
    expect((await contentCampaign(f.db, f.campaign.id))!.rewards_enabled).toBe(false);
  });
  it("enforces global admission and open-campaign limits under concurrent requests", async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => createContentCampaign(f.db, { ...f.campaignInput, request_id: crypto.randomUUID() }, f.at)));
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(9);
    expect(await createContentCampaign(f.db, f.campaignInput, f.at)).toEqual(f.campaign);
    const owners = [f.owner, f.other]; for (let i = 0; i < 9; i++) owners.push(await f.login());
    const submissions = await Promise.allSettled(Array.from({ length: 101 }, (_, i) => submitContent(f.db, f.input(`https://example.com/global/${i}`), owners[Math.floor(i / 10)]!.principal, f.at)));
    expect(submissions.filter(r => r.status === "fulfilled")).toHaveLength(100);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_content_submissions").get()?.n).toBe(100);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_content_events").get()?.n).toBe(100);
  });
  it("preserves a takedown revision and verifies past event hashes", async () => {
    const f = await fixture(), input = f.input(); await submitContent(f.db, input, f.owner.principal, f.at);
    for (let revision = 0; revision < 18; revision++) await changeContent(f.db, f.review(input.request_id, revision, revision % 2 === 0 ? "VISIBLE" : "FLAGGED"), null, f.at);
    await expect(changeContent(f.db, f.review(input.request_id, 18), null, f.at)).rejects.toMatchObject({ message: "content_final_revision_must_remain_hidden" });
    await changeContent(f.db, f.review(input.request_id, 18, "REJECTED"), null, f.at);
    expect((await contentRecord(f.db, input.request_id))!.snapshot.status).toBe("REJECTED");
    f.sqlite.exec("DROP TRIGGER tenx_content_events_no_update");
    const first = f.sqlite.prepare("SELECT id,event FROM tenx_content_events WHERE submission_id=? AND revision=0").get(input.request_id)!;
    const event = JSON.parse(String(first.event)); event.reason = "tampered historical reason";
    f.sqlite.prepare("UPDATE tenx_content_events SET event=? WHERE id=?").run(JSON.stringify(event), String(first.id));
    await expect(contentRecord(f.db, input.request_id)).rejects.toMatchObject({ message: "content_history_integrity_failed" });
  });
  it("rechecks time and session after a slowly streamed body instead of backdating admission", async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(f.at);
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      vi.setSystemTime(new Date(f.campaign.ends_at));
      controller.enqueue(new TextEncoder().encode(JSON.stringify(f.input()))); controller.close();
    } }, { highWaterMark: 0 });
    const headers = f.request("attention/submissions", {}, f.owner.cookie).headers;
    const request = new Request("http://127.0.0.1:8794/api/10x/attention/submissions", { method: "POST", headers, body, duplex: "half" } as RequestInit);
    expect((await worker.fetch(request, f.env)).status).toBe(401);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_content_submissions").get()?.n).toBe(0);
    vi.setSystemTime(f.at);
    const ending = await createContentCampaign(f.db, { ...f.campaignInput, request_id: crypto.randomUUID() }, new Date(f.at.getTime() - 10 * 86400000 + 1000));
    const lateBody = new ReadableStream<Uint8Array>({ pull(controller) {
      vi.setSystemTime(new Date(f.at.getTime() + 2000));
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...f.input(), campaign_id: ending.id }))); controller.close();
    } }, { highWaterMark: 0 });
    const late = await worker.fetch(new Request(request.url, { method: "POST", headers, body: lateBody, duplex: "half" } as RequestInit), f.env);
    expect(late.status).toBe(409); expect(await late.json()).toMatchObject({ error: "content_campaign_not_open" });
  });
});
