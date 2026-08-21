import { describe, expect, it } from "vitest";
import { identityProperties, normalizeIdentity, projectContactNames } from "./resendIdentity.js";

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
});
