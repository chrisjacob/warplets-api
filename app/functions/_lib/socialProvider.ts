import {
  createPublicClient,
  http,
  parseAbi,
  parseUnits,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, bsc } from "viem/chains";
import { DAY, safeSocialUrl, type BoostEvidence } from "../../shared/social.js";
import {
  FAMILY,
  SocialError,
  ensureIdentity,
  socialConfig,
  type Member,
  type SocialEnv,
} from "./socialStore.js";
import type { AppSession } from "./appAuth.js";

export async function neynar<T>(
  env: SocialEnv,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.NEYNAR_API_KEY)
    throw new SocialError("Farcaster integration is not configured yet", 503);
  const response = await fetch(`https://api.neynar.com/v2/farcaster/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-api-key": env.NEYNAR_API_KEY,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new SocialError(
      `Farcaster request failed (${response.status}). Retry shortly.`,
      502,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new SocialError("Empty Farcaster response", 502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2_000_000) {
      await reader.cancel();
      throw new SocialError("Farcaster response exceeded limit", 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
export interface Cast {
  hash: string;
  text: string;
  timestamp: string;
  parent_hash?: string | null;
  author: { fid: number; username?: string; pfp_url?: string };
  embeds?: Array<{
    url?: string;
    cast_id?: { hash: string; fid: number };
    cast?: Cast;
  }>;
  reactions?: { likes_count?: number; recasts_count?: number };
  replies?: { count?: number };
}
export function validateCast(cast: Cast, fid?: number, now = Date.now()) {
  if (
    !cast ||
    !/^0x[0-9a-f]{40}$/i.test(cast.hash) ||
    !cast.author?.fid ||
    typeof cast.text !== "string"
  )
    throw new SocialError("Invalid cast");
  if (fid && cast.author.fid !== fid)
    throw new SocialError("Choose a cast from your own account", 403);
  if (cast.parent_hash)
    throw new SocialError("Comments cannot be submitted to the main feed");
  const timestamp = Date.parse(cast.timestamp);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now + 60_000 ||
    timestamp <= now - DAY
  )
    throw new SocialError("Choose a cast published in the last 24 hours");
}
export async function fetchCast(env: SocialEnv, hash: string) {
  if (!/^0x[0-9a-f]{40}$/i.test(hash))
    throw new SocialError("Invalid cast hash");
  return (
    await neynar<{ cast: Cast }>(env, `cast?identifier=${hash}&type=hash`)
  ).cast;
}
export async function saveCast(
  env: SocialEnv,
  cast: Cast,
  member?: Member,
): Promise<string> {
  member ??= await ensureIdentity(
    env.WARPLETS,
    `fid:${cast.author.fid}`,
    cast.author.username,
    safeSocialUrl(cast.author.pfp_url),
  );
  const id = cast.hash.toLowerCase();
  const embeds = (cast.embeds ?? []).flatMap((e) =>
    e.url
      ? [safeSocialUrl(e.url)].filter(Boolean)
      : e.cast_id || e.cast
        ? [
            `https://farcaster.xyz/~/conversations/${(e.cast_id || e.cast)!.hash}`,
          ]
        : [],
  );
  await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      "UPDATE social_members SET username=?,avatar=? WHERE id=?",
    ).bind(
      cast.author.username || member.username,
      safeSocialUrl(cast.author.pfp_url),
      member.id,
    ),
    env.WARPLETS.prepare(
      `INSERT INTO social_posts(id,member_id,fid,cast_hash,text,embeds_json,raw_json,kind,created_at,likes,comments,recasts,refreshed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cast_hash) DO UPDATE SET likes=excluded.likes,comments=excluded.comments,recasts=excluded.recasts,refreshed_at=excluded.refreshed_at,raw_json=excluded.raw_json,embeds_json=excluded.embeds_json`,
    ).bind(
      id,
      member.id,
      cast.author.fid,
      id,
      cast.text,
      JSON.stringify(embeds),
      JSON.stringify(cast),
      (cast.embeds ?? []).some((e) => e.cast_id || e.cast)
        ? "quote"
        : "original",
      Date.parse(cast.timestamp),
      cast.reactions?.likes_count ?? 0,
      cast.replies?.count ?? 0,
      cast.reactions?.recasts_count ?? 0,
      Date.now(),
    ),
  ]);
  return id;
}
interface Signer {
  signer_uuid: string;
  public_key: Hex;
  status: string;
  fid?: number;
  signer_approval_url?: string;
}
export async function signerStatus(
  env: SocialEnv,
  member: Member,
  fid: number,
) {
  const row = await env.WARPLETS.prepare(
    `SELECT signer_uuid FROM social_signers WHERE member_id IN (${FAMILY}) AND fid=? ORDER BY checked_at DESC LIMIT 1`,
  )
    .bind(member.group_id, fid)
    .first<{ signer_uuid: string }>();
  if (!row) return null;
  const signer = await neynar<Signer>(
    env,
    `signer?signer_uuid=${encodeURIComponent(row.signer_uuid)}`,
  );
  const status =
    signer.status === "approved" && signer.fid !== fid
      ? "wrong_account"
      : signer.status;
  await env.WARPLETS.prepare(
    "UPDATE social_signers SET status=?,checked_at=? WHERE signer_uuid=?",
  )
    .bind(status, Date.now(), row.signer_uuid)
    .run();
  return { ...signer, status };
}
export async function startSigner(
  env: SocialEnv,
  member: Member,
  fid: number,
  origin: string,
) {
  const old = await signerStatus(env, member, fid);
  if (old && ["approved", "pending_approval"].includes(old.status))
    return { status: old.status, url: old.signer_approval_url };
  if (!env.SOCIAL_SIGNER_SPONSOR_PRIVATE_KEY || !env.SOCIAL_APP_FID)
    throw new SocialError(
      "Signer approval is awaiting the Social app registration",
      503,
    );
  const signer = await neynar<Signer>(env, "signer", {});
  const account = privateKeyToAccount(
    env.SOCIAL_SIGNER_SPONSOR_PRIVATE_KEY as Hex,
  );
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  const signature = await account.signTypedData({
    domain: {
      name: "Farcaster SignedKeyRequestValidator",
      version: "1",
      chainId: 10,
      verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553",
    },
    types: {
      SignedKeyRequest: [
        { name: "requestFid", type: "uint256" },
        { name: "key", type: "bytes" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "SignedKeyRequest",
    message: {
      requestFid: BigInt(env.SOCIAL_APP_FID),
      key: signer.public_key,
      deadline: BigInt(deadline),
    },
  });
  const registered = await neynar<Signer>(env, "signer/signed_key", {
    signer_uuid: signer.signer_uuid,
    app_fid: Number(env.SOCIAL_APP_FID),
    deadline,
    signature,
    redirect_url: `${origin}/?page=rewards`,
  });
  await env.WARPLETS.prepare(
    "INSERT INTO social_signers(member_id,signer_uuid,fid,status,approval_url,checked_at) VALUES(?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET signer_uuid=excluded.signer_uuid,fid=excluded.fid,status=excluded.status,approval_url=excluded.approval_url,checked_at=excluded.checked_at",
  )
    .bind(
      member.id,
      registered.signer_uuid,
      fid,
      registered.status,
      registered.signer_approval_url ?? null,
      Date.now(),
    )
    .run();
  return { status: registered.status, url: registered.signer_approval_url };
}
export async function requiredSigner(
  env: SocialEnv,
  member: Member,
  session: AppSession,
) {
  if (!session.farcasterFid)
    throw new SocialError("Connect Farcaster first", 401);
  const signer = await signerStatus(env, member, session.farcasterFid);
  if (signer?.status !== "approved" || signer.fid !== session.farcasterFid)
    throw new SocialError("Approve Farcaster publishing permission first", 403);
  return signer.signer_uuid;
}
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const erc721 = parseAbi(["function ownerOf(uint256) view returns (address)"]);
export async function refreshEvidence(
  env: SocialEnv,
  member: Member,
  session: AppSession,
) {
  const { config } = await socialConfig(env.WARPLETS);
  const data: Partial<BoostEvidence> = {
    follow: false,
    email: false,
    notifications: false,
    signer: false,
    warpletLevel: 0,
    stonklets: 0,
  };
  const wallets = new Set<string>();
  if (session.walletAddress) wallets.add(session.walletAddress.toLowerCase());
  const linked = await env.WARPLETS.prepare(
    `SELECT identity FROM social_identities WHERE member_id IN (${FAMILY}) AND identity LIKE 'wallet:%'`,
  )
    .bind(member.group_id)
    .all<{ identity: string }>();
  linked.results.forEach((r) => wallets.add(r.identity.slice(7)));
  const warnings: string[] = [];
  if (session.farcasterFid) {
    try {
      const result = await neynar<{
        users: Array<{
          fid: number;
          username?: string;
          pfp_url?: string;
          verified_addresses?: { eth_addresses: string[] };
          viewer_context?: { following?: boolean };
        }>;
      }>(
        env,
        `user/bulk?fids=${session.farcasterFid},${config.followFid}&viewer_fid=${session.farcasterFid}`,
      );
      const self = result.users.find((u) => u.fid === session.farcasterFid);
      for (const wallet of self?.verified_addresses?.eth_addresses ?? [])
        if (/^0x[a-f0-9]{40}$/i.test(wallet)) wallets.add(wallet.toLowerCase());
      if (self)
        await env.WARPLETS.prepare(
          "UPDATE social_members SET username=?,avatar=? WHERE id=?",
        )
          .bind(
            self.username || member.username,
            safeSocialUrl(self.pfp_url),
            member.id,
          )
          .run();
      data.follow =
        result.users.find((u) => u.fid === config.followFid)?.viewer_context
          ?.following === true;
      data.signer =
        (await signerStatus(env, member, session.farcasterFid))?.status ===
        "approved";
    } catch {
      warnings.push("Farcaster verification is temporarily unavailable");
    }
    data.email = !!(await env.WARPLETS.prepare(
      "SELECT 1 FROM email_waitlist WHERE fid=? AND verified=1 AND unsubscribed_at IS NULL LIMIT 1",
    )
      .bind(session.farcasterFid)
      .first());
    data.notifications = !!(await env.WARPLETS.prepare(
      "SELECT 1 FROM miniapp_notification_tokens WHERE fid=? AND app_slug='social' AND enabled=1 LIMIT 1",
    )
      .bind(session.farcasterFid)
      .first());
  }
  const baseClient = createPublicClient({
    chain: base,
    transport: http(env.BASE_RPC_URL || "https://mainnet.base.org", {
      timeout: 10000,
      retryCount: 1,
    }),
  });
  const bnbClient = createPublicClient({
    chain: bsc,
    transport: http(env.BNB_RPC_URL || "https://bsc-dataseed.bnbchain.org", {
      timeout: 10000,
      retryCount: 1,
    }),
  });
  const balances: Array<{ name: string; qualifies: boolean }> = [];
  const verifiedWallets = [...wallets].slice(0, 20);
  // Multicall batches all approved assets per chain; no per-wallet RPC loop.
  if (verifiedWallets.length)
    for (const chainId of [8453, 56]) {
      const assets = config.stonklets.filter(
        (asset) => asset.chainId === chainId,
      );
      if (!assets.length) continue;
      try {
        const results = await (
          chainId === 8453 ? baseClient : bnbClient
        ).multicall({
          contracts: assets.flatMap((asset) => [
            {
              address: asset.address as Address,
              abi: erc20,
              functionName: "decimals" as const,
            },
            ...verifiedWallets.map((wallet) => ({
              address: asset.address as Address,
              abi: erc20,
              functionName: "balanceOf" as const,
              args: [wallet as Address] as const,
            })),
          ]),
        });
        for (let index = 0; index < assets.length; index++) {
          const asset = assets[index];
          const values = results.slice(
            index * (verifiedWallets.length + 1),
            (index + 1) * (verifiedWallets.length + 1),
          );
          if (
            values.some((value) => value.status !== "success") ||
            Number(values[0].result) !== asset.decimals
          ) {
            warnings.push(
              `${asset.name} balance or decimals could not be verified`,
            );
            continue;
          }
          const balance = values
            .slice(1)
            .reduce((sum, value) => sum + BigInt(value.result ?? 0), 0n);
          const qualifies =
            balance >= parseUnits(asset.minimum, asset.decimals);
          balances.push({ name: asset.name, qualifies });
          if (qualifies) data.stonklets!++;
        }
      } catch {
        warnings.push(
          `Holdings on chain ${chainId} are temporarily unavailable`,
        );
      }
    }
  // Use the existing owner index for candidates, then verify ownership onchain.
  const traits = [
    "cast",
    "fid",
    "follower",
    "holder",
    "luck",
    "minter",
    "neynar",
    "nft",
    "token",
    "volume",
  ];
  if (wallets.size) {
    const addresses = [...wallets].slice(0, 20);
    const rows = await env.WARPLETS.prepare(
      `SELECT s.token_id,${traits.map((t) => `m.${t}_level`).join(",")} FROM warplet_market_state s JOIN warplets_metadata m ON m.token_id=s.token_id WHERE lower(s.owner_wallet) IN (${addresses.map(() => "?").join(",")}) ORDER BY MAX(${traits.map((t) => `COALESCE(CAST(m.${t}_level AS REAL),0)`).join(",")}) DESC LIMIT 100`,
    )
      .bind(...addresses)
      .all<Record<string, string | number>>();
    // The collection address is shared with Warplets (resolved below at build time).
    const COLLECTION_ADDRESS =
      "0x780446dd12e080ae0db762fcd4daf313f3e359de" as const;
    for (const row of rows.results) {
      const level = Math.min(
        10,
        Math.max(
          0,
          ...traits.map(
            (t) => Number.parseFloat(String(row[`${t}_level`])) || 0,
          ),
        ),
      );
      if (level <= (data.warpletLevel ?? 0)) continue;
      try {
        const owner = await baseClient.readContract({
          address: COLLECTION_ADDRESS,
          abi: erc721,
          functionName: "ownerOf",
          args: [BigInt(row.token_id!)],
        });
        if (wallets.has(owner.toLowerCase())) data.warpletLevel = level;
      } catch {
        warnings.push("Warplet ownership verification unavailable");
        break;
      }
    }
  }
  await env.WARPLETS.prepare(
    "INSERT INTO social_evidence(member_id,data_json,updated_at) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at",
  )
    .bind(
      member.id,
      JSON.stringify({ ...data, balances, warnings }),
      Date.now(),
    )
    .run();
  return { data, balances, warnings };
}
export const CHECKIN_ABI = parseAbi([
  "function checkIn()",
  "event CheckedIn(address indexed member,uint256 indexed day)",
]);
export async function verifyCheckin(
  env: SocialEnv,
  hash: string,
  wallet: string,
) {
  if (
    !env.SOCIAL_CHECKIN_ADDRESS ||
    !/^0x[0-9a-f]{40}$/i.test(env.SOCIAL_CHECKIN_ADDRESS)
  )
    throw new SocialError(
      "The Base check-in contract is awaiting deployment",
      503,
    );
  if (!/^0x[0-9a-f]{64}$/i.test(hash))
    throw new SocialError("Invalid transaction hash");
  const client = createPublicClient({
    chain: base,
    transport: http(env.BASE_RPC_URL || "https://mainnet.base.org", {
      timeout: 10000,
    }),
  });
  if ((await client.getChainId()) !== 8453)
    throw new SocialError("Base mainnet RPC required", 503);
  const receipt = await client
    .getTransactionReceipt({ hash: hash as Hex })
    .catch(() => null);
  if (!receipt)
    throw new SocialError(
      "Transaction is pending. Retry confirmation shortly.",
      409,
    );
  if (receipt.status !== "success")
    throw new SocialError("The check-in transaction reverted");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash)
    throw new SocialError(
      "Transaction confirmation changed. Retry shortly.",
      409,
    );
  const finalized = await client.getBlock({ blockTag: "safe" });
  if (finalized.number < receipt.blockNumber)
    throw new SocialError("Waiting for Base confirmation. Retry shortly.", 409);
  const day = Number(block.timestamp / 86400n);
  const matched = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== env.SOCIAL_CHECKIN_ADDRESS!.toLowerCase())
      return false;
    try {
      const decoded = decodeEventLog({
        abi: CHECKIN_ABI,
        data: log.data,
        topics: log.topics,
      });
      return (
        decoded.eventName === "CheckedIn" &&
        decoded.args.member.toLowerCase() === wallet.toLowerCase() &&
        Number(decoded.args.day) === day
      );
    } catch {
      return false;
    }
  });
  if (!matched)
    throw new SocialError("No matching check-in for your verified wallet");
  return {
    day: new Date(day * DAY).toISOString().slice(0, 10),
    timestamp: Number(block.timestamp) * 1000,
  };
}
