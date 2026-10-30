import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as http } from "node:http";
import { createGateway, issueGrant, validateGateway } from "../src/gateway.mjs";
import { encryptRecovery, decryptRecovery } from "../src/recovery.mjs";
import { createWalletMaterial, publicWallets } from "../src/wallets.mjs";

test("portable encrypted recovery restores the same keys and rejects tampering and wrong passwords", () => {
  const material = createWalletMaterial(),
    phrase = "test only disposable unique passphrase";
  const envelope = encryptRecovery(material, phrase);
  assert.equal(
    JSON.stringify(envelope).includes(material.basePrivateKey),
    false,
  );
  assert.deepEqual(
    publicWallets(decryptRecovery(envelope, phrase)),
    publicWallets(material),
  );
  assert.throws(
    () => decryptRecovery(envelope, phrase + "wrong"),
    /Recovery failed/,
  );
  assert.throws(
    () =>
      decryptRecovery(
        { ...envelope, tag: Buffer.alloc(16).toString("base64") },
        phrase,
      ),
    /Recovery failed/,
  );
  assert.throws(() => encryptRecovery(material, "short"), /20 characters/);
});
test("restricted compiled gateway requires access, expires sessions and cannot proxy operator/secret/financial paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meme-gateway-")),
    origin = "https://isolated-qa.trycloudflare.com";
  let now = Date.now(),
    fid = null,
    writes = 0;
  const invitation = issueGrant(1431382, now);
  const config = {
    origin,
    worker: "http://127.0.0.1:8799",
    staticDirectory: dir,
    grants: [invitation.grant],
    upstreamToken: "t".repeat(43),
  };
  writeFileSync(join(dir, "index.html"), "compiled QA");
  assert.throws(() =>
    validateGateway({ ...config, origin: "https://app-local.10x.meme" }),
  );
  const server = createGateway(config, {
    now: () => now,
    fetcher: async (url, init) => {
      assert.equal(init.headers.get("x-qa-principal"), null);
      if (url.pathname === "/api/auth/session")
        return Response.json({ farcasterFid: fid });
      if (url.pathname === "/api/auth/wallet/challenge")
        return Response.json({ error: "Expired proof" }, { status: 401 });
      writes++;
      return Response.json({ ok: true });
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const call = (
    path,
    {
      method = "GET",
      cookie = "",
      body,
      host = new URL(origin).host,
      extra = {},
    } = {},
  ) =>
    new Promise((resolve, reject) => {
      const r = http(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          method,
          headers: {
            host,
            origin,
            cookie,
            ...extra,
            ...(body
              ? { "content-type": "application/x-www-form-urlencoded" }
              : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      r.on("error", reject);
      r.end(body);
    });
  try {
    assert.equal((await call("/")).status, 401);
    assert.equal((await call("/", { host: "evil.test" })).status, 403);
    const login = await call("/qa/access", {
      method: "POST",
      body: new URLSearchParams({ code: invitation.code }).toString(),
    });
    assert.equal(login.status, 303);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    assert.match(
      login.headers["set-cookie"][0],
      /HttpOnly; Secure; SameSite=Strict/,
    );
    assert.equal((await call("/", { cookie })).body, "compiled QA");
    for (const path of [
      "/api/meme/operator/rounds",
      "/api/meme/claims",
      "/api/qa/principal",
      "/.env",
      "/src/main.tsx",
      "/%2e%2e/secret.js",
      "/foo.map",
    ])
      assert.equal((await call(path, { cookie })).status, 404, path);
    fid = 37;
    assert.equal(
      (
        await call("/api/meme/rounds/today/vote", {
          method: "POST",
          cookie,
          body: "x=y",
        })
      ).status,
      403,
    );
    assert.equal(writes, 0);
    fid = 1431382;
    assert.equal(
      (
        await call("/api/meme/state", {
          cookie,
          extra: { "x-qa-principal": "admin" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/api/auth/wallet/challenge", {
          cookie,
          method: "POST",
          body: "x=y",
        })
      ).status,
      401,
    );
    now = invitation.grant.expiresAt + 1;
    assert.equal((await call("/", { cookie })).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
