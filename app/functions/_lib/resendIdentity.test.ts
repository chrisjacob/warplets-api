import { describe, expect, it } from "vitest";
import {
  RESEND_DISCORD_SEGMENT_ID,
  identityProperties,
  normalizeIdentity,
  projectContactNames,
  removeDiscordIdentityFromResend,
  resendContactMatchesIdentity,
  RESEND_COMMUNITY_TOPIC_ID,
  syncTrustedIdentityToResend,
} from "./resendIdentity.js";

describe("trusted Resend identity projection", () => {
  it("normalizes wallets and writes only the five canonical property keys", () => {
    const identity = normalizeIdentity({
      email: " Person@Example.COM ",
      farcasterFid: 123,
      farcasterUsername: "alice",
      discordUserId: "692467495952449628",
      discordName: "Alice Discord",
      wallet: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    });
    expect(identity.email).toBe("person@example.com");
    expect(identity.wallet).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(identityProperties(identity)).toEqual({
      FarcasterFID: "123",
      FarcasterUsername: "alice",
      DiscordUserID: "692467495952449628",
      DiscordName: "Alice Discord",
      Wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    });
  });

  it("gives trusted Farcaster identity precedence over Discord names", () => {
    expect(projectContactNames({
      email: "person@example.com",
      farcasterFid: 123,
      farcasterUsername: "alice",
      discordUserId: "692467495952449628",
      discordName: "Alice Discord",
    })).toEqual({ first_name: "alice", last_name: "123" });
  });

  it("uses Discord only when a complete trusted Farcaster pair is absent", () => {
    expect(projectContactNames({
      email: "person@example.com",
      discordUserId: "692467495952449628",
      discordName: "Alice Discord",
    })).toEqual({ first_name: "Alice Discord", last_name: "692467495952449628" });
  });

  it("preserves existing names when no complete trusted identity is available", () => {
    expect(projectContactNames(
      { email: "person@example.com", farcasterFid: 123 },
      { first_name: "Legacy", last_name: "Contact" },
    )).toEqual({ first_name: "Legacy", last_name: "Contact" });
  });

  it("unwraps Resend property values without stringifying objects", () => {
    const identity = {
      email: "person@example.com",
      discordUserId: "692467495952449628",
      discordName: "Alice Discord",
    };
    expect(resendContactMatchesIdentity({
      first_name: { value: "Alice Discord", type: "string" },
      last_name: { value: "692467495952449628", type: "string" },
      properties: {
        DiscordUserID: { value: { value: "692467495952449628" }, type: "string" },
        DiscordName: { value: "Alice Discord", type: "string" },
      },
    }, identity)).toBe(true);
    expect(projectContactNames(
      { email: "person@example.com" },
      { first_name: { notAString: true }, last_name: { value: "Legacy ID" } },
    )).toEqual({ last_name: "Legacy ID" });
  });

  it("detects object-string corruption in Resend contacts", () => {
    expect(resendContactMatchesIdentity({
      first_name: "[object Object]",
      last_name: "[object Object]",
      properties: {
        DiscordUserID: { value: "[object Object]", type: "string" },
        DiscordName: { value: "[object Object]", type: "string" },
      },
    }, {
      email: "person@example.com",
      discordUserId: "692467495952449628",
      discordName: "Alice Discord",
    })).toBe(false);
  });

  it("rejects malformed Discord IDs instead of publishing them to Resend", () => {
    expect(normalizeIdentity({
      email: "person@example.com",
      discordUserId: "692467495952449628a",
      discordName: "Alice Discord",
    }).discordUserId).toBeNull();
  });

  it("removes Discord fields and segment while restoring Farcaster name precedence", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (!init?.method) return Response.json({
        first_name: "Discord Alice",
        last_name: "692467495952449628",
        properties: {
          FarcasterFID: { value: 123 },
          FarcasterUsername: { value: "alice" },
          DiscordUserID: { value: "692467495952449628" },
          DiscordName: { value: "Discord Alice" },
        },
      });
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      await removeDiscordIdentityFromResend({
        apiKey: "test-key",
        identity: {
          email: "person@example.com",
          farcasterFid: 123,
          farcasterUsername: "alice",
          discordUserId: "692467495952449628",
          discordName: "Discord Alice",
        },
        previousDiscordUserId: "692467495952449628",
        previousDiscordName: "Discord Alice",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const patch = requests.find((request) => request.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      first_name: "alice",
      last_name: "123",
      properties: {
        FarcasterFID: 123,
        FarcasterUsername: "alice",
        DiscordUserID: "",
        DiscordName: "",
      },
    });
    expect(requests.some((request) => request.init?.method === "DELETE"
      && request.url.endsWith(`/segments/${RESEND_DISCORD_SEGMENT_ID}`))).toBe(true);
  });

  it("updates an existing contact topic by immutable contact ID", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (!init?.method) {
        return Response.json({
          id: "contact-123",
          first_name: "Legacy",
          last_name: "Contact",
          properties: {},
        });
      }
      return Response.json({ id: "contact-123" });
    }) as typeof fetch;
    try {
      await syncTrustedIdentityToResend({
        apiKey: "test-key",
        identity: {
          email: "person@example.com",
          farcasterFid: 123,
          farcasterUsername: "alice",
        },
        segmentId: "segment-123",
        resubscribe: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const topic = requests.find((request) => request.url.endsWith("/contacts/contact-123/topics"));
    expect(topic?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(topic?.init?.body))).toEqual({
      topics: [{ id: RESEND_COMMUNITY_TOPIC_ID, subscription: "opt_in" }],
    });
  });

  it("does not repeat topic mutation after topics are applied during contact creation", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (!init?.method) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ id: "contact-created" });
    }) as typeof fetch;
    try {
      await syncTrustedIdentityToResend({
        apiKey: "test-key",
        identity: {
          email: "new@example.com",
          farcasterFid: 123,
          farcasterUsername: "alice",
        },
        segmentId: "segment-123",
        resubscribe: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const create = requests.find((request) => request.url === "https://api.resend.com/contacts"
      && request.init?.method === "POST");
    expect(JSON.parse(String(create?.init?.body)).topics).toEqual([
      { id: RESEND_COMMUNITY_TOPIC_ID, subscription: "opt_in" },
    ]);
    expect(requests.some((request) => request.url.endsWith("/topics"))).toBe(false);
  });
});
