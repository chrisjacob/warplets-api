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
const instances: DatabaseSync[] = [], origin = "https://app-local.10x.meme", token = "a".repeat(64);
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
async function fixture() {
  const sqlite = new DatabaseSync(":memory:"); instances.push(sqlite); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of ["0018_solana_identity.sql", "0024_content_review.sql"]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
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
