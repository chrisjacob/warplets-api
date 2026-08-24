import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_VERIFICATION_GUILD_ID,
  EmailVerificationState,
  ensureResendContact,
  handleEmailVerificationInteraction,
  verificationPanelPayload,
} from "./emailVerification";

function verificationStateHarness() {
  const values = new Map<string, unknown>();
  const storage = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    delete: async (key: string) => values.delete(key),
    list: async <T>(options?: { prefix?: string }) => new Map(
      [...values.entries()].filter(([key]) => !options?.prefix || key.startsWith(options.prefix)),
    ) as Map<string, T>,
    transaction: async <T>(callback: (transaction: DurableObjectTransaction) => Promise<T>) => callback(storage as unknown as DurableObjectTransaction),
  };
  const durableObject = new EmailVerificationState({ storage } as unknown as DurableObjectState);
  return async (path: string, body: Record<string, unknown>) => {
    const response = await durableObject.fetch(new Request(`https://state.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    return response.json() as Promise<Record<string, unknown>>;
  };
}

function identityDbHarness(): D1Database {
  const claims = new Map<string, Record<string, unknown>>();
  const profiles = new Map<string, Record<string, unknown>>();
  const statement = (sql: string) => {
    let args: unknown[] = [];
    const bound = {
      bind: (...values: unknown[]) => { args = values; return bound; },
      first: async <T>() => {
        if (sql.includes("FROM email_identity_profiles")) return (profiles.get(String(args[0])) ?? null) as T | null;
        if (sql.includes("FROM email_identity_claims")) {
          return ([...claims.values()].find((claim) => claim.token_hash === args[0]) ?? null) as T | null;
        }
        if (sql.includes("SELECT attempts FROM email_resend_outbox")) return { attempts: 0 } as T;
        return null;
      },
      run: async () => {
        if (sql.includes("INSERT OR IGNORE INTO email_identity_claims")) {
          const [id, email, source, segmentId, tokenHash, farcasterFid, farcasterUsername, discordUserId, discordName, wallet, resubscribe, expiresAt, createdAt] = args;
          if (!claims.has(String(id))) claims.set(String(id), {
            id, email, source, segment_id: segmentId, token_hash: tokenHash,
            farcaster_fid: farcasterFid, farcaster_username: farcasterUsername,
            discord_user_id: discordUserId, discord_name: discordName, wallet,
            drop_reward_eligible: 0, resubscribe, status: "pending", expires_at: expiresAt,
            created_at: createdAt, confirmed_at: null, synced_at: null, last_error: null,
          });
        }
        if (sql.includes("SET status = 'confirmed_pending_sync'")) {
          const claim = claims.get(String(args[1]));
          if (!claim || claim.status !== "pending") return { meta: { changes: 0 } };
          claim.status = "confirmed_pending_sync";
          claim.confirmed_at = args[0];
        }
        if (sql.includes("INSERT INTO email_identity_profiles")) {
          profiles.set(String(args[0]), {
            email: args[0], farcaster_fid: args[1], farcaster_username: args[2],
            discord_user_id: args[3], discord_name: args[4], wallet: args[5], email_verified_at: args[6],
          });
        }
        if (sql.includes("SET status = 'synced'")) {
          const claim = claims.get(String(args[1]));
          if (claim) claim.status = "synced";
        }
        return { meta: { changes: 1 } };
      },
      all: async () => ({ results: [] }),
    };
    return bound;
  };
  return {
    prepare: statement,
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((item) => item.run())),
  } as unknown as D1Database;
}

test("verification panel exposes native email and code buttons", () => {
  const payload = JSON.stringify(verificationPanelPayload());
  assert.match(payload, /email_verify:start/);
  assert.match(payload, /email_verify:code/);
  assert.match(payload, /Disposable email providers/);
  assert.match(payload, /use it for sending you community updates/);
});

test("email button opens a native Discord modal", () => {
  const response = handleEmailVerificationInteraction({}, {
    type: 3,
    guild_id: EMAIL_VERIFICATION_GUILD_ID,
    member: { user: { id: "123" } },
    data: { custom_id: "email_verify:start" },
  }, () => assert.fail("opening a modal must not defer work"));
  assert.equal(response?.type, 9);
  assert.equal((response?.data as { custom_id?: string }).custom_id, "email_verify:email_modal");
});

test("verification interactions are rejected outside the configured guild", () => {
  const response = handleEmailVerificationInteraction({}, {
    type: 3,
    guild_id: "other-guild",
    member: { user: { id: "123" } },
    data: { custom_id: "email_verify:start" },
  }, () => assert.fail("rejected interactions must not defer work"));
  assert.equal(response?.type, 4);
  assert.equal((response?.data as { flags?: number }).flags, 64);
});

test("new Resend contacts store the Discord name and permanent user ID", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/contacts/member%40example.com") && !init?.method) return new Response(null, { status: 404 });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await ensureResendContact({ RESEND_API_KEY: "test-key", WARPLETS: identityDbHarness() }, "member@example.com", "10XChris.eth", "692467495952449628");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const create = requests.find((request) => request.url === "https://api.resend.com/contacts" && request.init?.method === "POST");
  assert.ok(create);
  assert.deepEqual(JSON.parse(String(create.init?.body)), {
    email: "member@example.com",
    first_name: "10XChris.eth",
    last_name: "692467495952449628",
    properties: {
      DiscordUserID: "692467495952449628",
      DiscordName: "10XChris.eth",
    },
    segments: [{ id: "be2dd809-e0bd-4b71-95ac-eb11f68270c4" }],
  });
});

test("existing Resend contacts are updated without changing unsubscribe state", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/contacts/member%40example.com") && !init?.method) {
      return Response.json({
        unsubscribed: true,
        properties: { Campaign: { value: "Legacy", type: "string" } },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  let result: Awaited<ReturnType<typeof ensureResendContact>>;
  try {
    result = await ensureResendContact({ RESEND_API_KEY: "test-key", WARPLETS: identityDbHarness() }, "member@example.com", "Updated Name", "692467495952449628");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.unsubscribed, true);
  const update = requests.find((request) => request.init?.method === "PATCH");
  assert.ok(update);
  assert.deepEqual(JSON.parse(String(update.init?.body)), {
    first_name: "Updated Name",
    last_name: "692467495952449628",
    properties: {
      Campaign: "Legacy",
      DiscordUserID: "692467495952449628",
      DiscordName: "Updated Name",
    },
  });
});

test("verification state requires a fresh code before replacing the Discord account for an email", async () => {
  const request = verificationStateHarness();
  const base = { guildId: EMAIL_VERIFICATION_GUILD_ID, userId: "user-1" };
  const reserved = await request("/reserve", {
    ...base,
    email: "person@example.com",
    emailKey: "email-hash",
    challengeId: "challenge-1",
    codeHash: "correct-hash",
    now: 1_000_000,
    expiresAt: 1_600_000,
  });
  assert.equal(reserved.status, "reserved");

  const wrong = await request("/check", { ...base, challengeId: "challenge-1", candidateHash: "wrong-hash00", now: 1_000_100 });
  assert.equal(wrong.status, "invalid_code");
  assert.equal(wrong.attemptsRemaining, 4);

  const accepted = await request("/check", { ...base, challengeId: "challenge-1", candidateHash: "correct-hash", now: 1_000_200 });
  assert.equal(accepted.status, "accepted");
  const completed = await request("/complete", { ...base, challengeId: "challenge-1", now: 1_000_300 });
  assert.equal(completed.status, "completed");
  const listed = await request("/verified-records", {});
  assert.deepEqual(listed.records, [{ userId: "user-1", email: "person@example.com", verifiedAt: 1_000_300 }]);

  const reused = await request("/reserve", {
    guildId: EMAIL_VERIFICATION_GUILD_ID,
    userId: "user-2",
    email: "person@example.com",
    emailKey: "email-hash",
    challengeId: "challenge-2",
    codeHash: "another-hash",
    now: 2_000_000,
    expiresAt: 2_600_000,
  });
  assert.equal(reused.status, "reserved");
  const acceptedReplacement = await request("/check", {
    guildId: EMAIL_VERIFICATION_GUILD_ID,
    userId: "user-2",
    challengeId: "challenge-2",
    candidateHash: "another-hash",
    now: 2_000_100,
  });
  assert.equal(acceptedReplacement.status, "accepted");
  const completedReplacement = await request("/complete", {
    guildId: EMAIL_VERIFICATION_GUILD_ID,
    userId: "user-2",
    challengeId: "challenge-2",
    now: 2_000_200,
  });
  assert.equal(completedReplacement.status, "completed");
  assert.equal(completedReplacement.replacedUserId, "user-1");
  const oldStatus = await request("/status", { ...base });
  assert.equal(oldStatus.status, "empty");
});

test("admin reset removes the permanent user and email claim so the Discord user can verify again", async () => {
  const request = verificationStateHarness();
  const identity = { guildId: EMAIL_VERIFICATION_GUILD_ID, userId: "692467495952449628" };
  await request("/reserve", {
    ...identity,
    email: "wrong@example.com",
    emailKey: "wrong-email-hash",
    challengeId: "challenge-reset",
    codeHash: "correct-hash",
    now: 1_000_000,
    expiresAt: 1_600_000,
  });
  await request("/check", { ...identity, challengeId: "challenge-reset", candidateHash: "correct-hash", now: 1_000_100 });
  await request("/complete", { ...identity, challengeId: "challenge-reset", now: 1_000_200 });

  const stale = await request("/admin-reset", {
    ...identity,
    expectedEmail: "different@example.com",
    expectedEmailKey: "different-hash",
  });
  assert.equal(stale.status, "association_changed");
  assert.equal((await request("/status", identity)).status, "verified");

  const reset = await request("/admin-reset", {
    ...identity,
    expectedEmail: "wrong@example.com",
    expectedEmailKey: "wrong-email-hash",
  });
  assert.equal(reset.status, "reset");
  assert.equal((await request("/status", identity)).status, "empty");
  assert.deepEqual((await request("/verified-records", {})).records, []);

  const retry = await request("/reserve", {
    ...identity,
    email: "correct@example.com",
    emailKey: "correct-email-hash",
    challengeId: "challenge-after-reset",
    codeHash: "new-hash",
    now: 2_000_000,
    expiresAt: 2_600_000,
  });
  assert.equal(retry.status, "reserved");
});
