import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { identityRoute } from "./identity";
import { toBase58 } from "./solana";
import worker, { type LocalEnv } from "./worker";

const instances: DatabaseSync[] = [];
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
const at = new Date("2026-10-20T12:00:00.000Z"), origin = "https://app-local.10x.meme";
// Isolated, ephemeral test keys only. Never used with live D1 or browser wallets.
function key() { const secret = crypto.getRandomValues(new Uint8Array(32)); return { secret, address: toBase58(ed25519.getPublicKey(secret)) }; }
function fixture() {
  const sqlite = new DatabaseSync(":memory:"); instances.push(sqlite); sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readFileSync(new URL("../migrations/0018_solana_identity.sql", import.meta.url), "utf8"));
  const base = sqliteD1(sqlite);
  // D1 serializes batches. Serialize the async SQLite adapter in concurrency tests too.
  let tail: Promise<unknown> = Promise.resolve();
  const db: D1Database = { ...base, batch(statements: D1PreparedStatement[]) { const result = tail.then(() => base.batch(statements)); tail = result.catch(() => {}); return result; } } as D1Database;
  function req(path: string, data?: unknown, cookie?: string, headers: Record<string, string> = {}) {
    return new Request(`http://127.0.0.1:8794/api/10x/identity/${path}`, { ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }), headers: { "x-10x-identity-origin": origin, ...(data === undefined ? {} : { origin, "content-type": "application/json", "x-tenx-identity": "1" }), ...(cookie ? { cookie } : {}), ...headers } });
  }
  const call = (path: string, data?: unknown, cookie?: string, time = at) => identityRoute(req(path, data, cookie), db, time);
  async function challenge(k: ReturnType<typeof key>, cookie?: string, intent = "login") {
    const response = await call("challenge", { address: k.address, intent }, cookie);
    expect(response.status).toBe(200);
    return { value: await response.json() as { challenge_id: string; message: string; expires_at: string }, cookie: cookie ?? response.headers.get("set-cookie")!.split(";")[0]! };
  }
  const proof = (k: ReturnType<typeof key>, challenge: { challenge_id: string; message: string }) => ({ challenge_id: challenge.challenge_id, signature: btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(challenge.message), k.secret))) });
  async function login(k = key()) {
    const c = await challenge(k); const response = await call("verify", proof(k, c.value), c.cookie); expect(response.status).toBe(200);
    return { k, c, value: await response.json() as { identity_id: string; wallets: { address: string }[] }, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
  }
  return { db, sqlite, req, call, challenge, proof, login };
}
describe("local signed Solana identity", () => {
  it("uses no provider requests, rotates an HttpOnly cookie and stores no raw tokens or signatures", async () => {
    const f = fixture(), provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no provider")), k = key();
    const c = await f.challenge(k);
    expect(c.value.message).toContain("app-local.10x.meme requests a Solana wallet ownership proof");
    expect(c.value.message).toContain(`URI: ${origin}/wallets`); expect(c.value.message).toContain(`\n${k.address}\n`);
    expect(c.value.message).toContain("Chain ID: solana:mainnet\nIntent: login");
    const signature = f.proof(k, c.value), result = await f.call("verify", signature, c.cookie);
    const value = await result.json() as { identity_id: string };
    expect(result.status).toBe(200); expect(result.headers.get("set-cookie")).toMatch(/^__Host-tenx_solana=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
    expect(result.headers.get("cache-control")).toBe("no-store"); expect(result.headers.get("set-cookie")).not.toContain(c.cookie);
    expect(value).toMatchObject({ authenticated: true, scope: "local_solana_identity", voting_enabled: false, human_verification: "unverified", wallets: [{ address: k.address }] });
    expect(await (await f.call("session", undefined, c.cookie)).json()).toMatchObject({ authenticated: false });
    const sessions = f.sqlite.prepare("SELECT * FROM tenx_identity_sessions").all();
    expect(JSON.stringify(sessions)).not.toContain(c.cookie.split("=")[1]);
    const audit = f.sqlite.prepare("SELECT * FROM tenx_identity_audit").get(); expect(audit).toMatchObject({ identity_id: value.identity_id, action: "login" });
    expect(JSON.stringify(audit)).not.toContain(signature.signature); expect(provider).not.toHaveBeenCalled();
  });
  it("rejects replay even with the rotated authenticated cookie", async () => {
    const f = fixture(), user = await f.login();
    expect((await f.call("verify", f.proof(user.k, user.c.value), user.c.cookie)).status).toBe(401);
    expect((await f.call("verify", f.proof(user.k, user.c.value), user.cookie)).status).toBe(409);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_audit").get()?.n).toBe(1);
  });
  it("admits a concurrent proof only once with one wallet/session/audit", async () => {
    const f = fixture(), k = key(), c = await f.challenge(k), p = f.proof(k, c.value);
    const results = await Promise.all([f.call("verify", p, c.cookie), f.call("verify", p, c.cookie)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_wallets").get()?.n).toBe(1);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_sessions WHERE revoked_at IS NULL AND identity_id IS NOT NULL").get()?.n).toBe(1);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_audit").get()?.n).toBe(1);
  });
  it("rolls back nonce, links, session rotation and audit together on a failed write", async () => {
    const f = fixture(), k = key(), c = await f.challenge(k);
    f.sqlite.exec("CREATE TRIGGER audit_fault BEFORE INSERT ON tenx_identity_audit BEGIN SELECT RAISE(ABORT,'test fault'); END");
    await expect(f.call("verify", f.proof(k, c.value), c.cookie)).rejects.toThrow("test fault");
    expect(f.sqlite.prepare("SELECT consumed_by FROM tenx_identity_challenges").get()?.consumed_by).toBeNull();
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_wallets").get()?.n).toBe(0);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_sessions WHERE revoked_at IS NOT NULL").get()?.n).toBe(0);
    f.sqlite.exec("DROP TRIGGER audit_fault"); expect((await f.call("verify", f.proof(k, c.value), c.cookie)).status).toBe(200);
  });
  it("binds proof to the exact account, message, browser session, domain and intent", async () => {
    const f = fixture(), k = key(), wrong = key(), c = await f.challenge(k), other = await f.challenge(k);
    expect((await f.call("verify", f.proof(wrong, c.value), c.cookie)).status).toBe(401);
    expect((await f.call("verify", f.proof(k, c.value), other.cookie)).status).toBe(409);
    for (const change of [c.value.message.replace("solana:mainnet", "solana:devnet"), c.value.message.replace(origin, "https://evil.example"), c.value.message.replace("Intent: login", "Intent: link")]) {
      expect((await f.call("verify", f.proof(k, { ...c.value, message: change }), c.cookie)).status).toBe(401);
    }
    expect((await f.call("verify", f.proof(k, c.value), c.cookie)).status).toBe(200);
  });
  it("fails closed on expired/future challenges, expired sessions and unknown cookies", async () => {
    const f = fixture(), k = key(), c = await f.challenge(k);
    expect((await f.call("verify", f.proof(k, c.value), c.cookie, new Date(at.getTime() - 1))).status).toBe(409);
    expect((await f.call("verify", f.proof(k, c.value), c.cookie, new Date(at.getTime() + 300000))).status).toBe(409);
    expect((await f.call("verify", f.proof(k, c.value), c.cookie, new Date(at.getTime() + 600000))).status).toBe(401);
    expect((await f.call("verify", f.proof(k, c.value), "__Host-tenx_solana=" + "a".repeat(64))).status).toBe(401);
    const user = await f.login();
    expect(await (await f.call("session", undefined, user.cookie, new Date(at.getTime() + 43200000))).json()).toMatchObject({ authenticated: false });
  });
  it("links multiple signed wallets, recovers the same identity and never merges other owners", async () => {
    const f = fixture(), user = await f.login(), second = key(), c = await f.challenge(second, user.cookie, "link");
    const linked = await f.call("verify", f.proof(second, c.value), c.cookie);
    expect(await linked.json()).toMatchObject({ identity_id: user.value.identity_id, wallets: expect.arrayContaining([{ address: second.address, linked_at: at.toISOString() }]) });
    const recovered = await f.login(second); expect(recovered.value.identity_id).toBe(user.value.identity_id);
    const outsider = await f.login(), conflict = await f.challenge(second, outsider.cookie, "link");
    expect((await f.call("verify", f.proof(second, conflict.value), conflict.cookie)).status).toBe(409);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_wallets").get()?.n).toBe(3);
  });
  it("serializes competing links from two identities without moving ownership", async () => {
    const f = fixture(), a = await f.login(), b = await f.login(), k = key();
    const ca = await f.challenge(k, a.cookie, "link"), cb = await f.challenge(k, b.cookie, "link");
    const results = await Promise.all([f.call("verify", f.proof(k, ca.value), ca.cookie), f.call("verify", f.proof(k, cb.value), cb.cookie)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_wallets WHERE address=?").get(k.address)?.n).toBe(1);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_audit WHERE action='link'").get()?.n).toBe(1);
  });
  it("requires a new signature to unlink, preserves the last wallet and revokes all sessions", async () => {
    const f = fixture(), a = await f.login(), last = await f.challenge(a.k, a.cookie, "unlink");
    expect((await f.call("verify", f.proof(a.k, last.value), last.cookie)).status).toBe(409);
    const k = key(), c = await f.challenge(k, a.cookie, "link"), linked = await f.call("verify", f.proof(k, c.value), c.cookie), cookie = linked.headers.get("set-cookie")!.split(";")[0]!;
    const another = await f.login(k), unlink = await f.challenge(a.k, cookie, "unlink");
    const result = await f.call("verify", f.proof(a.k, unlink.value), cookie); expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0; Secure");
    for (const oldCookie of [a.cookie, cookie, another.cookie]) expect(await (await f.call("session", undefined, oldCookie)).json()).toMatchObject({ authenticated: false });
    expect(f.sqlite.prepare("SELECT address FROM tenx_identity_wallets").all()).toEqual([{ address: k.address }]);
    expect((await f.login(k)).value.identity_id).toBe(a.value.identity_id);
    expect((await f.login(a.k)).value.identity_id).not.toBe(a.value.identity_id);
  });
  it("revokes a logged-out browser and all its outstanding challenges", async () => {
    const f = fixture(), a = await f.login(), k = key(), c = await f.challenge(k, a.cookie, "link");
    expect((await f.call("logout", {}, a.cookie)).status).toBe(200);
    expect((await f.call("verify", f.proof(k, c.value), c.cookie)).status).toBe(401);
    expect(await (await f.call("session", undefined, a.cookie)).json()).toMatchObject({ authenticated: false });
  });
  it("rejects invalid signers, anonymous link/unlink and logged-in login intent", async () => {
    const f = fixture();
    for (const address of ["11111111111111111111111111111111", toBase58(new Uint8Array(32).fill(255))]) expect((await f.call("challenge", { address, intent: "login" })).status).toBe(400);
    const k = key(); for (const intent of ["link", "unlink"]) expect((await f.call("challenge", { address: k.address, intent })).status).toBe(409);
    const a = await f.login(); expect((await f.call("challenge", { address: k.address, intent: "login" }, a.cookie)).status).toBe(409);
  });
  it("enforces the ten-wallet cap at signature admission", async () => {
    const f = fixture(), a = await f.login(), k = key(), c = await f.challenge(k, a.cookie, "link");
    for (let i = 0; i < 9; i++) f.sqlite.prepare("INSERT INTO tenx_identity_wallets VALUES(?,?,?)").run(key().address, a.value.identity_id, at.toISOString());
    expect((await f.call("verify", f.proof(k, c.value), c.cookie)).status).toBe(409);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_wallets").get()?.n).toBe(10);
  });
  it("bounds per-session and global challenge admission atomically", async () => {
    const f = fixture(), k = key(), c = await f.challenge(k);
    for (let i = 1; i < 10; i++) expect((await f.call("challenge", { address: k.address, intent: "login" }, c.cookie)).status).toBe(200);
    expect((await f.call("challenge", { address: k.address, intent: "login" }, c.cookie)).status).toBe(429);
    for (let i = 10; i < 499; i++) f.sqlite.prepare("INSERT INTO tenx_identity_challenges SELECT ?,session_hash,address,intent,origin,message,issued_at,expires_at,NULL,NULL FROM tenx_identity_challenges LIMIT 1").run(crypto.randomUUID());
    const results = await Promise.all([f.call("challenge", { address: k.address, intent: "login" }), f.call("challenge", { address: k.address, intent: "login" })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
    expect(f.sqlite.prepare("SELECT count(*) n FROM tenx_identity_challenges").get()?.n).toBe(500);
  });
  it("requires matching Origin, JSON and custom header; rejects cross-site writes and nonlocal runtime", async () => {
    const f = fixture(), k = key(), env = { TENX_DB: f.db, TENX_LOCAL_ONLY: "true" } as LocalEnv;
    const data = { address: k.address, intent: "login" };
    const forbidden: Record<string, string>[] = [{ origin: "" }, { origin: "https://evil.example" }, { "x-tenx-identity": "" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of forbidden) {
      expect((await identityRoute(f.req("challenge", data, undefined, headers), f.db, at)).status).toBe(403);
    }
    expect((await identityRoute(f.req("challenge", data, undefined, { "content-type": "text/plain" }), f.db, at)).status).toBe(415);
    expect((await worker.fetch(new Request("https://discovery.example/api/10x/identity/session"), env)).status).toBe(503);
    expect((await worker.fetch(f.req("challenge", { ...data, identity_id: crypto.randomUUID() }), env)).status).toBe(400);
    expect((await worker.fetch(f.req("challenge", { ...data, padding: "x".repeat(4096) }), env)).status).toBe(413);
    expect((await identityRoute(new Request(`http://127.0.0.1:8794/api/10x/identity/challenge`, { method: "DELETE" }), f.db, at)).status).toBe(405);
    expect((await f.call("session")).headers.get("access-control-allow-origin")).toBeNull();
  });
});
