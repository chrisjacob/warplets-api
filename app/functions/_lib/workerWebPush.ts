/*
 * Worker-safe RFC 8291 Web Push payload builder. Cloudflare Workers expose
 * Web Crypto directly, so this intentionally has no Node crypto fallback.
 */

export interface PushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

interface PushMessage {
  data: string | number | Record<string, unknown>;
  options?: {
    ttl?: number;
    topic?: string;
    urgency?: "low" | "normal" | "high";
  };
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function encodeBase64Url(value: ArrayBuffer | ArrayBufferView): string {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\//g, "_").replace(/\+/g, "-").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function createVapidHeaders(subscription: PushSubscription, vapid: VapidKeys) {
  invariant(vapid.subject, "VAPID subject is empty");
  invariant(vapid.privateKey, "VAPID private key is empty");
  invariant(vapid.publicKey, "VAPID public key is empty");

  const publicKeyBytes = decodeBase64Url(vapid.publicKey);
  invariant(publicKeyBytes.length === 65 && publicKeyBytes[0] === 4, "Invalid VAPID public key");
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicKeyBytes.slice(1, 33)),
      y: encodeBase64Url(publicKeyBytes.slice(33, 65)),
      d: vapid.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1_000);
  const header = encodeJson({ typ: "JWT", alg: "ES256" });
  const claims = encodeJson({
    iat: now,
    aud: new URL(subscription.endpoint).origin,
    exp: now + 12 * 60 * 60,
    sub: vapid.subject,
  });
  const unsignedToken = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    new TextEncoder().encode(unsignedToken),
  );

  return {
    authorization: `vapid t=${unsignedToken}.${encodeBase64Url(signature)}, k=${vapid.publicKey}`,
  };
}

function createHmac(keyData: BufferSource) {
  if (keyData.byteLength === 0) {
    return { hash: async () => new ArrayBuffer(32) };
  }
  const keyPromise = crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return {
    hash: async (input: BufferSource) => crypto.subtle.sign("HMAC", await keyPromise, input),
  };
}

async function hkdf(salt: BufferSource, inputKeyMaterial: BufferSource) {
  const pseudoRandomKey = createHmac(salt).hash(inputKeyMaterial).then(createHmac);
  return {
    extract: async (info: Uint8Array, length: number) => {
      const input = new Uint8Array([...info, 1]);
      return (await (await pseudoRandomKey).hash(input)).slice(0, length);
    },
  };
}

function createWebPushInfo(clientPublic: Uint8Array, serverPublic: Uint8Array): Uint8Array {
  return new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic,
  ]);
}

function createContentEncodingInfo(type: "aes128gcm" | "nonce"): Uint8Array {
  return new TextEncoder().encode(`Content-Encoding: ${type}\0`);
}

async function encryptNotification(subscription: PushSubscription, plaintext: Uint8Array) {
  const recordSize = 4096;
  invariant(plaintext.byteLength <= 3993, "Web Push payload exceeds the RFC 8291 single-record limit");
  const clientPublicBytes = decodeBase64Url(subscription.keys.p256dh);
  invariant(
    clientPublicBytes.length === 65 && clientPublicBytes[0] === 4,
    "Invalid subscription p256dh key",
  );
  const clientPublicKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(clientPublicBytes.slice(1, 33)),
      y: encodeBase64Url(clientPublicBytes.slice(33, 65)),
      ext: true,
    },
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  const localKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const localPublicJwk = await crypto.subtle.exportKey("jwk", localKeys.publicKey);
  invariant(localPublicJwk.x && localPublicJwk.y, "Generated Web Push key is missing coordinates");
  const localPublicBytes = new Uint8Array([
    4,
    ...decodeBase64Url(localPublicJwk.x),
    ...decodeBase64Url(localPublicJwk.y),
  ]);
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    localKeys.privateKey,
    256,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const authSecret = decodeBase64Url(subscription.keys.auth);
  const authHkdf = await hkdf(authSecret.slice().buffer as ArrayBuffer, sharedSecret);
  const inputKeyMaterial = await authHkdf.extract(
    createWebPushInfo(clientPublicBytes, localPublicBytes),
    32,
  );
  const messageHkdf = await hkdf(salt, inputKeyMaterial);
  const contentEncryptionKey = await messageHkdf.extract(
    createContentEncodingInfo("aes128gcm"),
    16,
  );
  const nonce = await messageHkdf.extract(
    createContentEncodingInfo("nonce"),
    12,
  );
  const encryptionKey = await crypto.subtle.importKey(
    "raw",
    contentEncryptionKey,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"],
  );
  const record = new Uint8Array(plaintext.byteLength + 1);
  record.set(plaintext);
  record[record.length - 1] = 2;
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    encryptionKey,
    record,
  ));
  const body = new Uint8Array(16 + 4 + 1 + localPublicBytes.byteLength + ciphertext.byteLength);
  body.set(salt, 0);
  new DataView(body.buffer).setUint32(16, recordSize, false);
  body[20] = localPublicBytes.byteLength;
  body.set(localPublicBytes, 21);
  body.set(ciphertext, 21 + localPublicBytes.byteLength);

  return body;
}

export async function buildPushPayload(
  message: PushMessage,
  subscription: PushSubscription,
  vapid: VapidKeys,
) {
  const vapidHeaders = await createVapidHeaders(subscription, vapid);
  const serialized = typeof message.data === "string" || typeof message.data === "number"
    ? message.data.toString()
    : JSON.stringify(message.data);
  const body = await encryptNotification(subscription, new TextEncoder().encode(serialized));

  return {
    method: "POST",
    headers: {
      ...vapidHeaders,
      ttl: (message.options?.ttl ?? 60).toString(),
      ...(message.options?.urgency ? { urgency: message.options.urgency } : {}),
      ...(message.options?.topic ? { topic: message.options.topic } : {}),
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream",
    },
    body,
  };
}
