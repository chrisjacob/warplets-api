import { describe, expect, it } from "vitest";
import { buildPushPayload, type PushSubscription, type VapidKeys } from "./workerWebPush";

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function publicKeyBytes(jwk: JsonWebKey): Uint8Array {
  if (!jwk.x || !jwk.y) throw new Error("Missing P-256 coordinates");
  return new Uint8Array([4, ...Buffer.from(jwk.x, "base64url"), ...Buffer.from(jwk.y, "base64url")]);
}

async function hmac(keyData: BufferSource, input: BufferSource): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, input);
}

async function hkdf(salt: BufferSource, ikm: BufferSource, info: Uint8Array, length: number): Promise<ArrayBuffer> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, new Uint8Array([...info, 1]))).slice(0, length);
}

describe("RFC 8291 Web Push payloads", () => {
  it("builds an aes128gcm body that the subscription key can decrypt", async () => {
    const clientKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const clientPublicJwk = await crypto.subtle.exportKey("jwk", clientKeys.publicKey);
    const clientPublic = publicKeyBytes(clientPublicJwk);
    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    const subscription: PushSubscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-subscription",
      expirationTime: null,
      keys: { p256dh: base64Url(clientPublic), auth: base64Url(authSecret) },
    };

    const vapidPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const vapidPrivate = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);
    const vapidPublic = publicKeyBytes(await crypto.subtle.exportKey("jwk", vapidPair.publicKey));
    const vapid: VapidKeys = {
      publicKey: base64Url(vapidPublic),
      privateKey: vapidPrivate.d ?? "",
      subject: "mailto:test@example.com",
    };
    const message = JSON.stringify({ title: "Warplets test", body: "RFC 8291" });

    const payload = await buildPushPayload({ data: message }, subscription, vapid);

    expect(payload.headers["content-encoding"]).toBe("aes128gcm");
    expect(payload.headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(payload.headers).not.toHaveProperty("encryption");
    expect(payload.headers).not.toHaveProperty("crypto-key");

    const body = payload.body;
    const salt = body.slice(0, 16);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16, false)).toBe(4096);
    const keyLength = body[20];
    expect(keyLength).toBe(65);
    const serverPublic = body.slice(21, 21 + keyLength);
    const ciphertext = body.slice(21 + keyLength);
    const serverKey = await crypto.subtle.importKey(
      "raw",
      serverPublic,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: "ECDH", public: serverKey },
      clientKeys.privateKey,
      256,
    );
    const encoder = new TextEncoder();
    const keyInfo = new Uint8Array([
      ...encoder.encode("WebPush: info\0"),
      ...clientPublic,
      ...serverPublic,
    ]);
    const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
    const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
    const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
    const decrypted = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      ciphertext,
    ));

    expect(decrypted.at(-1)).toBe(2);
    expect(new TextDecoder().decode(decrypted.slice(0, -1))).toBe(message);
  });
});
