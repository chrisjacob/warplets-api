import { z } from "zod";

export const IdentityAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const IdentityIntent = z.enum(["login", "link", "unlink"]);
export const IdentityChallengeRequest = z.object({ address: IdentityAddress, intent: IdentityIntent }).strict();
export const IdentityVerifyRequest = z.object({ challenge_id: z.uuid(), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict();
export const IdentityChallengeResponse = z.object({
  challenge_id: z.uuid(), address: IdentityAddress, intent: IdentityIntent,
  message: z.string().max(2048), expires_at: z.iso.datetime(), chain: z.literal("solana:mainnet"),
}).strict();
export const IdentitySessionResponse = z.object({
  authenticated: z.boolean(), identity_id: z.uuid().nullable(), expires_at: z.iso.datetime().nullable(),
  wallets: z.array(z.object({ address: IdentityAddress, linked_at: z.iso.datetime() }).strict()).max(10),
  scope: z.literal("local_solana_identity"), voting_enabled: z.literal(false),
  human_verification: z.literal("unverified"),
}).strict();
export type IdentitySessionView = z.infer<typeof IdentitySessionResponse>;
