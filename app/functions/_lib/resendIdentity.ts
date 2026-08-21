import { outboundFetch } from "./outbound.js";

export const RESEND_10X_SEGMENT_ID = "ae46cf43-d4cf-4bc6-bc42-8af13fbc0dd7";
export const RESEND_DROP_SEGMENT_ID = "e52bdc31-4f3c-4ec6-a623-9bc3977042e2";
export const RESEND_DISCORD_SEGMENT_ID = "be2dd809-e0bd-4b71-95ac-eb11f68270c4";
export const RESEND_COMMUNITY_TOPIC_ID = "c3e8d591-73e6-4e98-a873-5e197a8581ee";

export type TrustedEmailIdentity = {
  email: string;
  farcasterFid?: number | null;
  farcasterUsername?: string | null;
  discordUserId?: string | null;
  discordName?: string | null;
  wallet?: string | null;
};

type ResendContact = {
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribed?: boolean;
  properties?: Record<string, string | number | null | { value?: string | number | null; type?: string }>;
};

const EVM_WALLET = /^0x[a-f0-9]{40}$/;

function clean(value: string | null | undefined, maxLength = 200): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, maxLength) : null;
}

function flattenContactProperties(properties: ResendContact["properties"]): Record<string, string | number> {
  const flattened: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(properties ?? {})) {
    const value = raw && typeof raw === "object" ? raw.value : raw;
    if (typeof value === "string" || typeof value === "number") flattened[key] = value;
  }
  return flattened;
}

export function normalizeIdentity(identity: TrustedEmailIdentity): TrustedEmailIdentity {
  const wallet = clean(identity.wallet, 42)?.toLowerCase() ?? null;
  return {
    email: identity.email.trim().toLowerCase(),
    farcasterFid: Number.isInteger(identity.farcasterFid) && Number(identity.farcasterFid) > 0
      ? Number(identity.farcasterFid)
      : null,
    farcasterUsername: clean(identity.farcasterUsername, 100),
    discordUserId: clean(identity.discordUserId, 32),
    discordName: clean(identity.discordName, 100),
    wallet: wallet && EVM_WALLET.test(wallet) ? wallet : null,
  };
}

export function identityProperties(identity: TrustedEmailIdentity): Record<string, string> {
  const normalized = normalizeIdentity(identity);
  const properties: Record<string, string> = {};
  if (normalized.farcasterFid) properties.FarcasterFID = String(normalized.farcasterFid);
  if (normalized.farcasterUsername) properties.FarcasterUsername = normalized.farcasterUsername;
  if (normalized.discordUserId) properties.DiscordUserID = normalized.discordUserId;
  if (normalized.discordName) properties.DiscordName = normalized.discordName;
  if (normalized.wallet) properties.Wallet = normalized.wallet;
  return properties;
}

export function projectContactNames(
  identity: TrustedEmailIdentity,
  existing?: Pick<ResendContact, "first_name" | "last_name"> | null,
): { first_name?: string; last_name?: string } {
  const normalized = normalizeIdentity(identity);
  if (normalized.farcasterFid && normalized.farcasterUsername) {
    return { first_name: normalized.farcasterUsername, last_name: String(normalized.farcasterFid) };
  }
  if (normalized.discordUserId && normalized.discordName) {
    return { first_name: normalized.discordName, last_name: normalized.discordUserId };
  }
  const firstName = clean(existing?.first_name, 100);
  const lastName = clean(existing?.last_name, 100);
  return {
    ...(firstName ? { first_name: firstName } : {}),
    ...(lastName ? { last_name: lastName } : {}),
  };
}

async function responseDetail(response: Response): Promise<string> {
  return (await response.text().catch(() => response.statusText)).slice(0, 500);
}

async function requestResend(apiKey: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return outboundFetch(url, { ...init, headers });
}

export async function getResendContact(apiKey: string, email: string): Promise<ResendContact | null> {
  const response = await requestResend(apiKey, `https://api.resend.com/contacts/${encodeURIComponent(email)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Resend contact lookup failed (${response.status}): ${await responseDetail(response)}`);
  return response.json<ResendContact>();
}

export async function syncTrustedIdentityToResend(input: {
  apiKey: string;
  identity: TrustedEmailIdentity;
  segmentId: string;
  resubscribe: boolean;
}): Promise<void> {
  const identity = normalizeIdentity(input.identity);
  const existing = await getResendContact(input.apiKey, identity.email);
  const existingProperties = flattenContactProperties(existing?.properties);
  const properties = {
    ...existingProperties,
    ...identityProperties(identity),
  };
  const names = projectContactNames(identity, existing);
  const contactPath = `https://api.resend.com/contacts/${encodeURIComponent(identity.email)}`;

  if (!existing) {
    const create = await requestResend(input.apiKey, "https://api.resend.com/contacts", {
      method: "POST",
      body: JSON.stringify({
        email: identity.email,
        ...names,
        ...(input.resubscribe ? { unsubscribed: false } : {}),
        properties,
        segments: [{ id: input.segmentId }],
        ...(input.resubscribe ? {
          topics: [{ id: RESEND_COMMUNITY_TOPIC_ID, subscription: "opt_in" }],
        } : {}),
      }),
    });
    if (!create.ok && create.status !== 409) {
      throw new Error(`Resend contact create failed (${create.status}): ${await responseDetail(create)}`);
    }
    if (create.status === 409) {
      const update = await requestResend(input.apiKey, contactPath, {
        method: "PATCH",
        body: JSON.stringify({
          ...names,
          properties,
          ...(input.resubscribe ? { unsubscribed: false } : {}),
        }),
      });
      if (!update.ok) throw new Error(`Resend contact conflict update failed (${update.status}): ${await responseDetail(update)}`);
    }
  } else {
    const update = await requestResend(input.apiKey, contactPath, {
      method: "PATCH",
      body: JSON.stringify({
        ...names,
        properties,
        ...(input.resubscribe ? { unsubscribed: false } : {}),
      }),
    });
    if (!update.ok) throw new Error(`Resend contact update failed (${update.status}): ${await responseDetail(update)}`);
  }

  const segment = await requestResend(input.apiKey, `${contactPath}/segments/${input.segmentId}`, { method: "POST" });
  if (!segment.ok && segment.status !== 409) {
    throw new Error(`Resend segment update failed (${segment.status}): ${await responseDetail(segment)}`);
  }

  if (input.resubscribe) {
    const topic = await requestResend(input.apiKey, `${contactPath}/topics`, {
      method: "PATCH",
      body: JSON.stringify({ topics: [{ id: RESEND_COMMUNITY_TOPIC_ID, subscription: "opt_in" }] }),
    });
    if (!topic.ok) throw new Error(`Resend topic update failed (${topic.status}): ${await responseDetail(topic)}`);
  }
}

export async function refreshTrustedIdentityLabels(input: {
  apiKey: string;
  identity: TrustedEmailIdentity;
}): Promise<void> {
  const identity = normalizeIdentity(input.identity);
  const existing = await getResendContact(input.apiKey, identity.email);
  if (!existing) return;
  const properties = {
    ...flattenContactProperties(existing.properties),
    ...identityProperties(identity),
  };
  const response = await requestResend(
    input.apiKey,
    `https://api.resend.com/contacts/${encodeURIComponent(identity.email)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ ...projectContactNames(identity, existing), properties }),
    },
  );
  if (!response.ok) {
    throw new Error(`Resend label refresh failed (${response.status}): ${await responseDetail(response)}`);
  }
}
