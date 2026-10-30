import assert from "node:assert/strict";
import { request } from "node:http";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createGateway, issueGrant } from "./gateway.mjs";

// Connects only to the separately started local Worker. Never starts a tunnel.
const origin = "https://isolated-qa.trycloudflare.com",
  invitation = issueGrant(1431382);
if (!process.argv[2])
  throw Error(
    "Provide the private generated gateway.json path; only its loopback Worker is contacted",
  );
const privateConfig = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (privateConfig.origin !== origin)
  throw Error("The local probe requires the inert isolated-qa test hostname");
const gateway = createGateway({ ...privateConfig, grants: [invitation.grant] });
await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
function call(path, { cookie = "", body, type = "application/json" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: gateway.address().port,
        path,
        method: body === undefined ? "GET" : "POST",
        headers: {
          host: new URL(origin).host,
          origin,
          cookie,
          "content-type": type,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (b) => chunks.push(b));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
try {
  assert.equal((await call("/")).status, 401);
  const access = await call("/qa/access", {
    body: new URLSearchParams({ code: invitation.code }).toString(),
    type: "application/x-www-form-urlencoded",
  });
  assert.equal(access.status, 303);
  const accessCookie = access.headers["set-cookie"][0].split(";")[0];
  assert.equal((await call("/", { cookie: accessCookie })).status, 200);
  const wallet = privateKeyToAccount(generatePrivateKey());
  const challenge = await call("/api/auth/wallet/challenge", {
    cookie: accessCookie,
    body: JSON.stringify({ address: wallet.address, chainId: 8453 }),
  });
  assert.equal(challenge.status, 200, challenge.body);
  const { message } = JSON.parse(challenge.body);
  assert(message.includes("URI: " + origin));
  const login = await call("/api/auth/wallet/verify", {
    cookie: accessCookie,
    body: JSON.stringify({
      message,
      signature: await wallet.signMessage({ message }),
    }),
  });
  assert.equal(login.status, 200, login.body);
  const sessionCookie = login.headers["set-cookie"][0].split(";")[0];
  assert(sessionCookie.startsWith("__Host-meme_session="));
  assert(login.headers["set-cookie"][0].includes("Secure"));
  const cookie = accessCookie + "; " + sessionCookie;
  const session = await call("/api/auth/session", { cookie });
  assert.equal(
    JSON.parse(session.body).walletAddress,
    wallet.address.toLowerCase(),
  );
  assert.equal((await call("/api/meme/state", { cookie })).status, 401);
  for (const path of [
    "/api/meme/operator/rounds",
    "/api/meme/claims",
    "/cdn-cgi/local/explorer/api/local/workers",
    "/.dev.vars",
  ])
    assert.equal((await call(path, { cookie })).status, 404);
  await call("/api/auth/logout", { cookie, body: "{}" });
  console.log(
    JSON.stringify({
      gatewayWorkerRoundtrip: "passed",
      secureOriginBoundEoaProof: "passed",
      invitedFarcasterStillRequired: "passed",
      operatorSecretsAndFinancialRoutesBlocked: "passed",
      walletMode: "disposable-local-proof-only",
      publicExposure: false,
      providerRequests: 0,
    }),
  );
} finally {
  await new Promise((resolve) => gateway.close(resolve));
}
