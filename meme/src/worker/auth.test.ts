import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { authRequest, sessionView } from "./auth";
import { sha } from "./db";
import { encode58 } from "../shared/base58";
import { testDb } from "./testDb";
const origin = "http://localhost:8797";
function request(path: string, body?: unknown, cookie = "") {
  return new Request(origin + path, {
    method: body == null ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", cookie },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
}
test("real Base signature, origin-bound nonce, replay and linked-principal checks", async () => {
  const t = testDb();
  try {
    const account = privateKeyToAccount(
      ("0x" + "11".repeat(32)) as `0x${string}`,
    );
    const c = (await (await authRequest(
      t.db,
      request("/api/auth/wallet/challenge", {
        address: account.address,
        chainId: 8453,
      }),
    ))!.json()) as { message: string };
    const signature = await account.signMessage({ message: c.message });
    const login = await authRequest(
      t.db,
      request("/api/auth/wallet/verify", { message: c.message, signature }),
    );
    assert.equal(login?.status, 200);
    const cookie = login!.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await sessionView(t.db, request("/api/auth/session", undefined, cookie)))
        .walletAddress,
      account.address.toLowerCase(),
    );
    await assert.rejects(
      authRequest(
        t.db,
        request("/api/auth/wallet/verify", { message: c.message, signature }),
      ),
      /expired challenge/,
    );
    await assert.rejects(
      authRequest(t.db, request("/api/auth/link", { confirm: true }, cookie)),
      /Connect Farcaster/,
    );
    await assert.rejects(
      authRequest(
        t.db,
        request("/api/auth/farcaster/verify", {
          nonce: "fake",
          message: "fake",
          signature: "0x12",
          fid: 42,
        }),
      ),
      /challenge/,
    );
  } finally {
    t.close();
  }
});
test("Solana proof binds FID, origin, role and session, consumes once and preserves audit evidence", async () => {
  const t = testDb();
  try {
    const token = "test-session";
    t.raw
      .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
      .run(await sha(token), origin, 42, null, Date.now() + 60000);
    const cookie = "meme_session=" + token;
    const key = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const exported = await crypto.subtle.exportKey("raw", key.publicKey);
    assert(exported instanceof ArrayBuffer);
    const address = encode58(new Uint8Array(exported));
    const c = (await (await authRequest(
      t.db,
      request("/api/auth/solana/challenge", { address }, cookie),
    ))!.json()) as { nonce: string; message: string };
    const signature = encode58(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          key.privateKey,
          new TextEncoder().encode(c.message),
        ),
      ),
    );
    await assert.rejects(
      authRequest(
        t.db,
        request(
          "/api/auth/solana/verify",
          { nonce: c.nonce, signature: encode58(new Uint8Array(64)) },
          cookie,
        ),
      ),
      /Invalid Solana signature/,
    );
    const verified = await authRequest(
      t.db,
      request("/api/auth/solana/verify", { nonce: c.nonce, signature }, cookie),
    );
    assert.equal(verified?.status, 200);
    assert.equal(
      (await sessionView(t.db, request("/api/auth/session", undefined, cookie)))
        .solanaWallet,
      address,
    );
    await assert.rejects(
      authRequest(
        t.db,
        request(
          "/api/auth/solana/verify",
          { nonce: c.nonce, signature },
          cookie,
        ),
      ),
      /challenge/,
    );
    assert.equal(
      t.raw.prepare("SELECT count(*) n FROM meme_nonce_uses").get()?.n,
      1,
    );
    const holdingChallenge = (await (await authRequest(
      t.db,
      request(
        "/api/auth/solana/challenge",
        { address, role: "holding" },
        cookie,
      ),
    ))!.json()) as { nonce: string; message: string };
    const holdingSignature = encode58(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          key.privateKey,
          new TextEncoder().encode(holdingChallenge.message),
        ),
      ),
    );
    await authRequest(
      t.db,
      request(
        "/api/auth/solana/verify",
        { nonce: holdingChallenge.nonce, signature: holdingSignature },
        cookie,
      ),
    );
    assert.equal(
      (await sessionView(t.db, request("/api/auth/session", undefined, cookie)))
        .solanaWallet,
      address,
      "Adding the same holding wallet must preserve its active reward role",
    );
  } finally {
    t.close();
  }
});
