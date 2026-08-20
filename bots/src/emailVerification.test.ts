import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_VERIFICATION_GUILD_ID,
  EmailVerificationState,
  handleEmailVerificationInteraction,
  verificationPanelPayload,
} from "./emailVerification";

function verificationStateHarness() {
  const values = new Map<string, unknown>();
  const storage = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
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

test("verification state enforces codes and one Discord account per email", async () => {
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
  assert.equal(reused.status, "email_already_used");
});
