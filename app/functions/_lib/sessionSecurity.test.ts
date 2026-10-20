import { describe, expect, it, vi } from "vitest";
import { createActionSessionToken, createAdminSessionToken, verifyActionSessionToken, verifyAdminSessionToken, readJsonBodyWithLimit } from "./security";

const secret = "test-only-session-secret-with-more-than-32-bytes";
describe("signed session boundaries", () => {
  it("accepts signed sessions and rejects suffixes, padding, tampering and expired sessions", async () => {
    const action = (await createActionSessionToken(secret, 42))!;
    const admin = (await createAdminSessionToken(secret, "operator"))!;
    expect(await verifyActionSessionToken(secret, action)).toEqual({ valid: true, fid: 42 });
    expect(await verifyAdminSessionToken(secret, admin)).toEqual({ valid: true, keyId: "operator" });
    for (const suffix of [".ignored", "=", ".", "\n"]) {
      expect((await verifyActionSessionToken(secret, action + suffix)).valid).toBe(false);
      expect((await verifyAdminSessionToken(secret, admin + suffix)).valid).toBe(false);
    }
    // Non-canonical base64 can otherwise give one signature several token strings.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alias = action.slice(0, -1) + alphabet[alphabet.indexOf(action.at(-1)!) + 1];
    expect((await verifyActionSessionToken(secret, alias)).valid).toBe(false);
    expect((await verifyActionSessionToken(secret + "different", action)).valid).toBe(false);
    expect((await verifyActionSessionToken(secret, await createActionSessionToken(secret, 42, 0))).valid).toBe(false);
    expect((await verifyAdminSessionToken(secret, await createAdminSessionToken(secret, "operator", 0))).valid).toBe(false);
    expect((await verifyActionSessionToken(secret, await createActionSessionToken(secret, Number.MAX_SAFE_INTEGER + 1))).valid).toBe(false);
  });
});

describe("bounded request JSON", () => {
  it("cancels a chunked body as soon as its byte limit is crossed despite a false length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(5)); }, cancel });
    const request = new Request("https://example.test", { method: "POST", headers: { "content-length": "0" }, body, duplex: "half" } as RequestInit);
    const result = await readJsonBodyWithLimit(request, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("counts UTF-8 bytes and keeps valid/invalid JSON behavior", async () => {
    const make = (body: string) => new Request("https://example.test", { method: "POST", body });
    expect(await readJsonBodyWithLimit(make('{"x":"é"}'), 10)).toEqual({ ok: true, value: { x: "é" } });
    const tooLarge = await readJsonBodyWithLimit(make('{"x":"é"}'), 9);
    if (tooLarge.ok) throw new Error("Expected byte limit rejection");
    expect(tooLarge.response.status).toBe(413);
    const malformed = await readJsonBodyWithLimit(make("{"), 10);
    if (malformed.ok) throw new Error("Expected invalid JSON");
    expect(malformed.response.status).toBe(400);
  });
});
