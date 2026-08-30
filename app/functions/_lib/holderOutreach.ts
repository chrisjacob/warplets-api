export const HOLDER_OUTREACH_WINDOW_MS = 24 * 60 * 60 * 1000;

export const HOLDER_OUTREACH_TEMPLATES = [
  {
    id: "airdrop-seen",
    label: "Did you see your airdrop?",
    text: "Did you see your 10X Warplet airdrop yet? 👀",
  },
  {
    id: "warplet-live",
    label: "Your Warplet is live",
    text: "Your 10X Warplet #{tokenId} is live — have you checked it out yet?",
  },
  {
    id: "meet-warplet",
    label: "Meet your Warplet",
    text: "Meet your 10X Warplet #{tokenId} 🟢",
  },
  {
    id: "open-airdrop",
    label: "Open your airdrop",
    text: "You received 10X Warplet #{tokenId}. Open your airdrop here:",
  },
] as const;

export type HolderOutreachTemplateId = typeof HOLDER_OUTREACH_TEMPLATES[number]["id"];

export type HolderOutreachCast = {
  fid: number;
  hash: string;
  username: string;
  displayName: string | null;
  pfpUrl: string | null;
  xUsername: string | null;
  text: string;
  timestamp: string;
  parentHash: string | null;
};

type TransientFetchOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  beforeAttempt?: () => Promise<void>;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryAfterMilliseconds(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

export async function fetchWithTransientRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: TransientFetchOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 4));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 15_000);
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await options.beforeAttempt?.();
    try {
      const response = await fetcher(input, init);
      if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === attempts - 1) return response;
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = retryAfterMilliseconds(response.headers.get("retry-after"), now());
      const exponential = baseDelayMs * (2 ** attempt) + Math.floor(random() * 250);
      await sleep(Math.min(maxDelayMs, retryAfter ?? exponential));
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      const exponential = baseDelayMs * (2 ** attempt) + Math.floor(random() * 250);
      await sleep(Math.min(maxDelayMs, exponential));
    }
  }

  throw new Error("Transient fetch retry loop exhausted");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function verifiedXUsername(author: Record<string, unknown>): string | null {
  const accounts = Array.isArray(author.verified_accounts) ? author.verified_accounts : [];
  for (const value of accounts) {
    const account = record(value);
    if (account?.platform === "x") {
      const username = optionalString(account.username, 80);
      if (username) return username.replace(/^@/, "");
    }
  }
  return null;
}

export function parseHolderOutreachFeedPage(
  payload: unknown,
  allowedFids: ReadonlySet<number>,
): { casts: HolderOutreachCast[]; nextCursor: string | null } {
  const body = record(payload);
  const rawCasts = Array.isArray(body?.casts) ? body.casts : [];
  const casts: HolderOutreachCast[] = [];

  for (const value of rawCasts) {
    const cast = record(value);
    const author = record(cast?.author);
    const fid = Number(author?.fid);
    const hash = optionalString(cast?.hash, 100);
    const username = optionalString(author?.username, 80);
    const timestamp = optionalString(cast?.timestamp, 80);
    if (!Number.isSafeInteger(fid) || fid <= 0 || !allowedFids.has(fid) || !hash || !username || !timestamp) {
      continue;
    }

    casts.push({
      fid,
      hash,
      username,
      displayName: optionalString(author?.display_name, 160),
      pfpUrl: optionalString(author?.pfp_url, 2048),
      xUsername: verifiedXUsername(author ?? {}),
      text: optionalString(cast?.text, 4096) ?? "",
      timestamp,
      parentHash: optionalString(cast?.parent_hash, 100),
    });
  }

  const next = record(body?.next);
  return {
    casts,
    nextCursor: optionalString(next?.cursor, 2048),
  };
}

export function buildHolderOutreachDeepLink(origin: string, tokenId: number, trackingCode: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("search", String(tokenId));
  url.searchParams.set("warplet", String(tokenId));
  url.searchParams.set("outreach", trackingCode);
  return url.toString();
}

export function buildHolderOutreachMessage(
  templateId: string,
  tokenId: number,
  deepLink: string,
): { templateId: HolderOutreachTemplateId; text: string } {
  const template = HOLDER_OUTREACH_TEMPLATES.find((candidate) => candidate.id === templateId)
    ?? HOLDER_OUTREACH_TEMPLATES[0];
  const introduction = template.text.replaceAll("{tokenId}", String(tokenId));
  return {
    templateId: template.id,
    text: `${introduction} ${deepLink}`,
  };
}

export function buildFarcasterReplyComposeUrl(text: string, deepLink: string, parentCastHash: string): string {
  const url = new URL("https://farcaster.xyz/~/compose");
  url.searchParams.set("text", text);
  url.searchParams.append("embeds[]", deepLink);
  url.searchParams.set("parentCastHash", parentCastHash);
  return url.toString();
}

export function normalizeOutreachTrackingCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{32}$/.test(normalized) ? normalized : null;
}

export async function recordHolderOutreachOpen(
  db: D1Database,
  trackingCode: string,
  openedAt = new Date().toISOString(),
): Promise<void> {
  await db.prepare(
    `UPDATE holder_outreach_events
     SET first_opened_at = COALESCE(first_opened_at, ?),
         last_opened_at = ?,
         open_count = open_count + 1
     WHERE tracking_code = ?`,
  ).bind(openedAt, openedAt, trackingCode).run();
}
