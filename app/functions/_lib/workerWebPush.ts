/*
 * Worker-safe Web Push payload builder, adapted from
 * @block65/webcrypto-web-push (MIT). Cloudflare Workers always expose the
 * Web Crypto API, so this intentionally has no Node crypto fallback.
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
    authorization: `WebPush ${unsignedToken}.${encodeBase64Url(signature)}`,
    "crypto-key": `p256ecdsa=${vapid.publicKey}`,
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

function encodeLength(value: number): Uint8Array {
  return new Uint8Array([0, value]);
}

function createInfo(clientPublic: Uint8Array, serverPublic: Uint8Array, type: string): Uint8Array {
  return new Uint8Array([
    ...new TextEncoder().encode(`Content-Encoding: ${type}\0`),
    ...new TextEncoder().encode("P-256\0"),
    ...encodeLength(clientPublic.byteLength),
    ...clientPublic,
    ...encodeLength(serverPublic.byteLength),
    ...serverPublic,
  ]);
}

function createAuthInfo(): Uint8Array {
  return new TextEncoder().encode("Content-Encoding: auth\0");
}

function generateNonce(base: Uint8Array, index: number): Uint8Array {
  const nonce = base.slice(0, 12);
  for (let offset = 0; offset < 6; offset += 1) {
    nonce[nonce.length - 1 - offset] ^= (index / 256 ** offset) & 0xff;
  }
  return nonce;
}

function splitIntoChunks(value: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

async function encryptNotification(subscription: PushSubscription, plaintext: Uint8Array) {
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
  const inputKeyMaterial = await authHkdf.extract(createAuthInfo(), 32);
  const messageHkdf = await hkdf(salt, inputKeyMaterial);
  const contentEncryptionKey = await messageHkdf.extract(
    createInfo(clientPublicBytes, localPublicBytes, "aesgcm"),
    16,
  );
  const nonce = await messageHkdf.extract(
    createInfo(clientPublicBytes, localPublicBytes, "nonce"),
    12,
  );
  const encryptionKey = await crypto.subtle.importKey(
    "raw",
    contentEncryptionKey,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"],
  );
  const encryptedChunks = await Promise.all(splitIntoChunks(plaintext, 4_095).map(async (chunk, index) => {
    const paddedChunk = new Uint8Array(chunk.length + 2);
    paddedChunk.set(chunk, 2);
    return new Uint8Array(await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: generateNonce(new Uint8Array(nonce), index).slice().buffer as ArrayBuffer,
      },
      encryptionKey,
      paddedChunk,
    ));
  }));
  const ciphertextLength = encryptedChunks.reduce((total, chunk) => total + chunk.length, 0);
  const ciphertext = new Uint8Array(ciphertextLength);
  let offset = 0;
  for (const chunk of encryptedChunks) {
    ciphertext.set(chunk, offset);
    offset += chunk.length;
  }

  return { ciphertext, salt, localPublicBytes };
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
  const encrypted = await encryptNotification(subscription, new TextEncoder().encode(serialized));

  return {
    method: "POST",
    headers: {
      ...vapidHeaders,
      "crypto-key": `dh=${encodeBase64Url(encrypted.localPublicBytes)};${vapidHeaders["crypto-key"]}`,
      encryption: `salt=${encodeBase64Url(encrypted.salt)}`,
      ttl: (message.options?.ttl ?? 60).toString(),
      ...(message.options?.urgency ? { urgency: message.options.urgency } : {}),
      ...(message.options?.topic ? { topic: message.options.topic } : {}),
      "content-encoding": "aesgcm",
      "content-length": encrypted.ciphertext.byteLength.toString(),
      "content-type": "application/octet-stream",
    },
    body: encrypted.ciphertext,
  };
}
