import { describe, expect, it } from "vitest";
import { verifySvix } from "./resend.js";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signedRequest(body: string, timestampSeconds = Math.floor(Date.now() / 1_000)) {
  const id = "msg_test_webhook";
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `whsec_${base64(secretBytes)}`;
  const key = await crypto.subtle.importKey("raw", secretBytes.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestampSeconds}.${body}`),
  ));
  const request = new Request("https://app.10x.meme/api/webhooks/resend", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": String(timestampSeconds),
      "svix-signature": `v1,${base64(signature)}`,
    },
    body,
  });
  return { request, secret };
}

describe("Resend webhook signatures", () => {
  it("accepts a current valid signature and rejects body tampering", async () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const { request, secret } = await signedRequest(body);
    expect(await verifySvix(request, body, secret)).toBe(true);
    expect(await verifySvix(request, `${body} `, secret)).toBe(false);
  });

  it("rejects stale signatures", async () => {
    const body = "{}";
    const { request, secret } = await signedRequest(body, Math.floor(Date.now() / 1_000) - 301);
    expect(await verifySvix(request, body, secret)).toBe(false);
  });
});
