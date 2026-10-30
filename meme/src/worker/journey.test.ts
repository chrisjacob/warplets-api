import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index";
import { testDb } from "./testDb";
import { sha } from "./db";
import { encode58 } from "../shared/base58";
import { DAY_MS } from "../shared/rules";
const origin = "http://127.0.0.1:5194";
test("HTTP journey verifies a Solana proof, votes, seals evidence, settles and reads only its own unfunded entitlement", async (context) => {
  const clock = Date.now();
  context.mock.timers.enable({ apis: ["Date"], now: clock });
  const t = testDb(),
    token = "generated-test-session",
    operatorToken = "generated-test-operator";
  const env: Env = {
    MEME_DB: t.db,
    LOCAL_PREVIEW_ONLY: "true",
    LOCAL_PARTICIPATION_ENABLED: "true",
    LOCAL_OPERATIONS_ENABLED: "false",
    MEME_QA_ORIGIN: "",
    MEME_QA_FIDS: "",
    MEME_QA_GATEWAY_TOKEN: "",
    HELIUS_API_KEY: "",
    PYTH_API_KEY: "",
  };
  async function call(path: string, body?: unknown, privileged = false) {
    const response = await worker.fetch(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: "meme_session=" + token,
          ...(privileged ? { authorization: "Bearer " + operatorToken } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    const value = (await response.json()) as Record<string, any>;
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  }
  try {
    // Farcaster's verified external assertion is supplied as an in-memory test principal only.
    t.raw
      .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
      .run(await sha(token), origin, 42, null, clock + 2 * DAY_MS);
    t.raw
      .prepare("INSERT INTO meme_operator_tokens VALUES(?,?,?)")
      .run(await sha(operatorToken), "test operator", clock);
    const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const exported = await crypto.subtle.exportKey("raw", keys.publicKey);
    assert(exported instanceof ArrayBuffer);
    const wallet = encode58(new Uint8Array(exported));
    const challenge = await call("/api/auth/solana/challenge", {
      address: wallet,
      role: "reward",
    });
    const signature = encode58(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          keys.privateKey,
          new TextEncoder().encode(challenge.message),
        ),
      ),
    );
    await call("/api/auth/solana/verify", {
      nonce: challenge.nonce,
      signature,
    });
    const opensAt = clock + 60000,
      closesAt = clock + 3600000;
    await call(
      "/api/meme/operator/rounds",
      {
        id: "journey",
        opensAt,
        closesAt,
        attribute: "cast",
        simulated: true,
        candidates: [
          {
            id: "a",
            name: "Alpha",
            symbol: "A",
            ogMint: wallet,
            evidence: "SIMULATED reviewed candidate",
          },
        ],
      },
      true,
    );
    await call(
      "/api/meme/operator/rounds/journey/freeze",
      {
        source: "warplets",
        mode: "simulated",
        sourceAt: clock,
        checkpoint: "simulated-zero-ownership",
        complete: true,
        ownership: [],
      },
      true,
    );
    await call(
      "/api/meme/operator/campaigns",
      {
        id: "campaign",
        mint: wallet,
        symbol: "ED",
        launchedAt: clock - DAY_MS + 7200000,
        totalSupply: "10000",
        decimals: 0,
        mode: "simulated",
        launchEvidence: "SIMULATED actual-time fixture",
      },
      true,
    );
    context.mock.timers.setTime(opensAt + 1);
    await call("/api/meme/rounds/journey/vote", {
      candidateId: "a",
      key: "journey-vote-001",
    });
    context.mock.timers.setTime(closesAt + 1);
    await call(
      "/api/meme/operator/ledger",
      {
        campaignId: "campaign",
        mode: "simulated",
        scopeWallets: [wallet],
        events: [],
        throughAt: closesAt,
        throughSlot: 1,
        source: "Simulated complete zero-activity history",
        cursor: "final",
        complete: true,
        fromMint: true,
      },
      true,
    );
    await call(
      "/api/meme/operator/rounds/journey/outcome",
      { skip: true, reason: "Simulated skipped new launch" },
      true,
    );
    let settled = await call(
      "/api/meme/operator/rounds/journey/settle",
      {},
      true,
    );
    for (let i = 0; i < 10 && settled.state !== "finalized"; i++)
      settled = await call(
        "/api/meme/operator/rounds/journey/settle",
        {},
        true,
      );
    assert.equal(settled.state, "finalized");
    const state = await call("/api/meme/state");
    assert.equal(state.entitlements[0].amount, "100");
    assert.equal(state.entitlements[0].reward_wallet, wallet);
    assert.equal(state.boost.finality, "finalized");
    const anonymous = await worker.fetch(
      new Request(origin + "/api/meme/state"),
      env,
    );
    assert.deepEqual(
      ((await anonymous.json()) as { entitlements: unknown[] }).entitlements,
      [],
    );
  } finally {
    t.close();
    context.mock.timers.reset();
  }
});
test("runtime rejects remote hosts, cross-origin mutations, missing principals, invalid operators and every financial mutation", async () => {
  const t = testDb(),
    env: Env = {
      MEME_DB: t.db,
      LOCAL_PREVIEW_ONLY: "true",
      LOCAL_PARTICIPATION_ENABLED: "true",
      LOCAL_OPERATIONS_ENABLED: "false",
      MEME_QA_ORIGIN: "",
      MEME_QA_FIDS: "",
      MEME_QA_GATEWAY_TOKEN: "",
      HELIUS_API_KEY: "",
      PYTH_API_KEY: "",
    };
  try {
    const fetch = (
      url: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      worker.fetch(
        new Request(url, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json", ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        env,
      );
    assert.equal(
      (await fetch("https://meme.example/api/meme/state")).status,
      404,
    );
    const framed = await fetch(origin + "/api/meme/state");
    assert.equal(
      framed.headers.get("content-security-policy"),
      "frame-ancestors 'none'",
    );
    assert.equal(framed.headers.get("x-frame-options"), "DENY");
    assert.equal(framed.headers.get("referrer-policy"), "no-referrer");
    assert.equal(
      (
        await fetch(origin + "/api/meme/state", undefined, {
          "sec-fetch-site": "cross-site",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + "/api/auth/session", undefined, {
          origin: "http://localhost:4444",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(
          origin + "/api/meme/rounds/r/vote",
          {},
          { origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(
          origin + "/api/meme/rounds/r/vote",
          { candidateId: "a", key: "request-key" },
          { origin },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(
          origin + "/api/meme/operator/rounds",
          {},
          { origin, authorization: "Bearer invalid" },
        )
      ).status,
      403,
    );
    for (const path of ["claims", "launches", "funding"])
      assert.equal(
        (await fetch(origin + "/api/meme/" + path, {}, { origin })).status,
        405,
      );
    const disabled = await worker.fetch(
      new Request(origin + "/api/meme/state"),
      { ...env, LOCAL_PARTICIPATION_ENABLED: "false" } as unknown as Env,
    );
    assert.equal(disabled.status, 404);
  } finally {
    t.close();
  }
});
