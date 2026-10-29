import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../_lib/sqliteTestDb";
import { createActionSessionToken } from "../_lib/security";
import { onRequestGet as actions } from "./actions";
import { onRequestPost as complete } from "./actions-complete";
import { onRequestPost as verify } from "./actions-verify";
import { onRequestPost as open } from "./notifications/open";

const instances: DatabaseSync[] = [];
afterEach(() => { for (const db of instances.splice(0)) db.close(); vi.unstubAllGlobals(); });
function setup() {
  const db = new DatabaseSync(":memory:"); instances.push(db);
  db.exec(`CREATE TABLE security_audit_events(event_type, outcome, actor_type, actor_id, ip_address, route, details, created_on);
    CREATE TABLE notification_opens(notification_id, fid, app_slug);
    CREATE TABLE warplets_users(id, fid);
    CREATE TABLE actions_completed(user_id, action_slug, verification);
    CREATE TABLE email_waitlist(fid, email, verified, unsubscribed_at, subscribed_at);
    INSERT INTO warplets_users VALUES(1,42),(2,999);
    INSERT INTO email_waitlist VALUES(42,'owner@example.test',1,NULL,'2026-01-01'),(999,'other@example.test',1,NULL,'2026-01-01');`);
  const cachedActions = [{ id: 1, slug: "drop-waitlist-email", name: "Email", appSlug: "drop" }];
  const env = { WARPLETS: sqliteD1(db), ASSETS: { fetch: async () => new Response() }, ACTION_SESSION_SECRET: "test-only-session-secret-more-than-32-bytes", ALLOW_INSECURE_ACTION_FID_FALLBACK: "1" };
  const context = (request: Request) => ({ request: request as Parameters<typeof complete>[0]["request"], env, params: {}, data: {}, functionPath: "", waitUntil() {}, passThroughOnException() {}, next: async () => new Response() });
  // Only the JSON catalog read is used; rate limits deliberately have no KV.
  const catalogKv = { get: async () => cachedActions, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true, cacheStatus: null }), getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }) } as unknown as KVNamespace;
  const catalogContext = (request: Request) => ({ ...context(request), env: { ...env, WARPLETS_KV: catalogKv } });
  return { db, env, context, catalogContext };
}
describe("identity comes only from a signed session", () => {
  it("never returns account completion/email for an unsigned caller FID, even with the legacy flag enabled", async () => {
    const { catalogContext, env } = setup();
    const unsigned = await actions(catalogContext(new Request("http://localhost:8790/api/actions?appSlug=drop&fid=999")));
    expect(await unsigned.text()).not.toContain("other@example.test");
    const token = (await createActionSessionToken(env.ACTION_SESSION_SECRET, 42))!;
    const signed = await actions(catalogContext(new Request(`http://localhost:8790/api/actions?appSlug=drop&fid=999&sessionToken=${token}`)));
    const text = await signed.text();
    expect(text).toContain("owner@example.test"); expect(text).not.toContain("other@example.test");
  });
  it("rejects unsigned action mutations on local, tunnel and preview hosts before provider calls", async () => {
    const { context, db, env } = setup();
    const outbound = vi.fn(() => { throw new Error("No provider request permitted"); }); vi.stubGlobal("fetch", outbound);
    for (const host of ["localhost:8790", "app-local.10x.meme", "10x-app-dev.pages.dev"]) {
      for (const handler of [complete, verify]) {
        const response = await handler(context(new Request(`http://${host}/api/actions-verify`, { method: "POST", body: JSON.stringify({ fid: 999, actionSlug: "drop-follow-fc-10xmeme" }) })));
        expect(response.status).toBe(401);
      }
    }
    const sessionToken = await createActionSessionToken(env.ACTION_SESSION_SECRET, 42);
    expect((await verify(context(new Request("http://localhost/api/actions-verify", { method: "POST", body: JSON.stringify({ sessionToken, actionSlug: "unsupported-security-probe" }) })))).status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM actions_completed").get()?.n).toBe(0);
    expect(outbound).not.toHaveBeenCalled();
  });
  it("records anonymous opens without trusting claimed FIDs and attributes signed opens to the session", async () => {
    const { context, db, env } = setup();
    const post = (body: object) => open(context(new Request("http://localhost/api/notifications/open", { method: "POST", body: JSON.stringify(body) })));
    expect((await post({ notificationId: "anonymous", fid: 999 })).status).toBe(200);
    const sessionToken = await createActionSessionToken(env.ACTION_SESSION_SECRET, 42);
    expect((await post({ notificationId: "signed", fid: 999, sessionToken })).status).toBe(200);
    expect(db.prepare("SELECT fid FROM notification_opens ORDER BY notification_id").all()).toEqual([{ fid: null }, { fid: 42 }]);
  });
});
