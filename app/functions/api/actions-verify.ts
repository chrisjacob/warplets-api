interface Env {
  NEYNAR_API_KEY?: string;
}

interface RequestBody {
  fid?: unknown;
  actionSlug?: unknown;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function isFollowingFid(apiKey: string, viewerFid: number, targetFid: number): Promise<boolean> {
  const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${viewerFid}&fids=${targetFid}`;
  const response = await fetch(endpoint, { headers: { "x-api-key": apiKey } });
  if (!response.ok) return false;

  const payload = (await response.json()) as { users?: Array<{ viewer_context?: { following?: boolean } }> };
  const user = Array.isArray(payload.users) ? payload.users[0] : null;
  return Boolean(user?.viewer_context?.following);
}

async function isFollowingChannel(apiKey: string, fid: number, channelId: string): Promise<boolean> {
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const url = new URL("https://api.neynar.com/v2/farcaster/user/channels/");
    url.searchParams.set("fid", String(fid));
    url.searchParams.set("limit", "100");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), { headers: { "x-api-key": apiKey } });
    if (!response.ok) return false;

    const payload = (await response.json()) as {
      channels?: Array<{ id?: string }>;
      next?: { cursor?: string };
    };
    const channels = Array.isArray(payload.channels) ? payload.channels : [];
    if (channels.some((channel) => channel.id === channelId)) {
      return true;
    }
    const nextCursor = typeof payload.next?.cursor === "string" ? payload.next.cursor : "";
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return false;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RequestBody = {};
  try {
    body = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fid = asPositiveInt(body.fid);
  const actionSlug = asNonEmptyString(body.actionSlug)?.toLowerCase();
  if (!fid || !actionSlug) {
    return Response.json({ error: "fid and actionSlug are required" }, { status: 400 });
  }

  const apiKey = context.env.NEYNAR_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Missing NEYNAR_API_KEY" }, { status: 500 });
  }

  try {
    if (actionSlug === "drop-follow-fc-10xmeme") {
      const verified = await isFollowingFid(apiKey, fid, 1313340);
      return Response.json({ verified });
    }
    if (actionSlug === "drop-follow-fc-10xchris") {
      const verified = await isFollowingFid(apiKey, fid, 1129138);
      return Response.json({ verified });
    }
    if (actionSlug === "drop-join-fc-channel") {
      const verified = await isFollowingChannel(apiKey, fid, "10xmeme");
      return Response.json({ verified });
    }
  } catch {
    return Response.json({ verified: false });
  }

  return Response.json({ error: "Unsupported actionSlug" }, { status: 400 });
};
