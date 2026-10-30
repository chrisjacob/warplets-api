import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import worker from "./index";
import { testDb } from "./testDb";

const origin = "https://isolated-qa.trycloudflare.com";
function environment(db: D1Database, tunnel = ""): Env {
  const env: Env = {
    MEME_DB: db,
    LOCAL_PREVIEW_ONLY: "true",
    LOCAL_PARTICIPATION_ENABLED: "true",
    LOCAL_OPERATIONS_ENABLED: "false",
    MEME_QA_ORIGIN: "",
    MEME_QA_FIDS: "",
    HELIUS_API_KEY: "",
    PYTH_API_KEY: "",
  };
  return Object.assign(env, {
    MEME_QA_ORIGIN: tunnel,
    MEME_QA_FIDS: "1431382",
  });
}
function request(path: string, body?: unknown, cookie = "") {
  return new Request("http://isolated-qa.trycloudflare.com" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("tunnel is opt-in, requires local preview mode and accepts only its exact host", async () => {
  const t = testDb();
  try {
    const env = environment(t.db, origin);
    assert.equal(
      (await worker.fetch(request("/health"), environment(t.db))).status,
      404,
    );
    const disabled = Object.assign(environment(t.db, origin), {
      LOCAL_PREVIEW_ONLY: "false",
    });
    assert.equal(
      (await worker.fetch(request("/health"), disabled)).status,
      404,
    );
    for (const host of [
      "10x.meme",
      "other.10x.meme",
      "isolated-qa.trycloudflare.com.evil.test",
      "isolated-qa.trycloudflare.com:9999",
    ]) {
      assert.equal(
        (
          await worker.fetch(
            new Request(`http://${host}/health`, {
              headers: {
                "x-forwarded-host": "isolated-qa.trycloudflare.com",
                "x-forwarded-proto": "https",
              },
            }),
            env,
          )
        ).status,
        404,
      );
    }
    assert.equal((await worker.fetch(request("/health"), env)).status, 200);
    assert.equal(
      (
        await worker.fetch(
          new Request("http://localhost/health"),
          environment(t.db),
        )
      ).status,
      200,
    );
  } finally {
    t.close();
  }
});

test("tunnel preserves cross-origin, operator and disabled-action checks", async () => {
  const t = testDb();
  try {
    const env = environment(t.db, origin);
    for (const headers of [
      new Headers({ origin: "https://evil.test" }),
      new Headers({ "sec-fetch-site": "cross-site" }),
    ]) {
      assert.equal(
        (
          await worker.fetch(
            new Request(
              "http://isolated-qa.trycloudflare.com/api/auth/session",
              { headers },
            ),
            env,
          )
        ).status,
        403,
      );
    }
    assert.equal(
      (
        await worker.fetch(
          new Request(
            "http://isolated-qa.trycloudflare.com/api/auth/wallet/challenge",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            },
          ),
          env,
        )
      ).status,
      403,
    );
    assert.equal(
      (await worker.fetch(request("/api/meme/operator/rounds", {}), env))
        .status,
      404,
    );
    assert.equal(
      (await worker.fetch(request("/api/meme/claims", {}), env)).status,
      404,
    );
  } finally {
    t.close();
  }
});

test("tunneled wallet proofs and Secure host cookies bind to the public HTTPS origin", async () => {
  const t = testDb();
  try {
    const env = environment(t.db, origin);
    const account = privateKeyToAccount(
      ("0x" + "11".repeat(32)) as `0x${string}`,
    );
    const challenge = await worker.fetch(
      request("/api/auth/wallet/challenge", {
        address: account.address,
        chainId: 8453,
      }),
      env,
    );
    assert.equal(challenge.status, 200);
    const body = (await challenge.json()) as { message: string };
    assert.ok(
      body.message.includes(
        "isolated-qa.trycloudflare.com wants you to sign in",
      ),
    );
    assert.ok(body.message.includes("URI: " + origin));
    const proof = {
      message: body.message,
      signature: await account.signMessage({ message: body.message }),
    };
    const login = await worker.fetch(
      request("/api/auth/wallet/verify", proof),
      env,
    );
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    assert.ok(cookie.startsWith("__Host-meme_session="));
    assert.ok(cookie.includes("; Secure"));
    assert.ok(!cookie.includes("Domain="));
    const session = await worker.fetch(
      request("/api/auth/session", undefined, cookie.split(";")[0]),
      env,
    );
    assert.equal(
      ((await session.json()) as { walletAddress: string }).walletAddress,
      account.address.toLowerCase(),
    );
    const local = await worker.fetch(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: cookie.split(";")[0] },
      }),
      env,
    );
    assert.equal(
      ((await local.json()) as { authenticated: boolean }).authenticated,
      false,
    );
    assert.equal(
      (await worker.fetch(request("/api/auth/wallet/verify", proof), env))
        .status,
      401,
    );
  } finally {
    t.close();
  }
});
