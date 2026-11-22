import { createClient } from "@farcaster/quick-auth";
import { createAppClient, viemConnector } from "@farcaster/auth-client";
import { createPublicClient, http, recoverMessageAddress } from "viem";
import { base } from "viem/chains";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { decode58 } from "../shared/base58";
import {
  one,
  rows,
  run,
  json,
  payload,
  requireThat,
  sha,
  random,
  text,
  Problem,
  type Database,
} from "./db";
export interface Session {
  token_hash: string;
  origin: string;
  fid: number | null;
  wallet: string | null;
  expires_at: number;
}
interface Challenge {
  nonce: string;
  kind: string;
  origin: string;
  address: string | null;
  fid: number | null;
  role: string | null;
  session_hash: string | null;
  message: string | null;
  issued_at: string;
  expires_at: number;
  consumed_at: number | null;
}
const cookieName = (r: Request) =>
  new URL(r.url).protocol === "https:" ? "__Host-meme_session" : "meme_session";
export function cookie(request: Request, name: string) {
  return (
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) ?? null
  );
}
function setCookie(
  request: Request,
  name: string,
  value: string,
  maxAge = 2592000,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function session(db: Database, request: Request) {
  const token = cookie(request, cookieName(request));
  return token
    ? one<Session>(
        db,
        "SELECT * FROM meme_sessions WHERE token_hash=? AND origin=? AND expires_at>?",
        await sha(token),
        new URL(request.url).origin,
        Date.now(),
      )
    : null;
}
export async function principal(db: Database, request: Request) {
  const s = await session(db, request);
  requireThat(s?.fid, 401, "Connect Farcaster first");
  return s as Session & { fid: number };
}
async function establish(
  db: Database,
  request: Request,
  identity: { fid?: number; wallet?: string },
) {
  const previous = await session(db, request),
    token = random(),
    origin = new URL(request.url).origin;
  const fid = identity.fid ?? previous?.fid ?? null,
    changed =
      identity.fid != null &&
      previous?.fid != null &&
      identity.fid !== previous.fid;
  const wallet =
    identity.wallet ?? (changed ? null : (previous?.wallet ?? null));
  const expiry = Date.now() + 2592000000;
  await db.batch([
    db
      .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
      .bind(await sha(token), origin, fid, wallet, expiry),
    db
      .prepare("DELETE FROM meme_sessions WHERE token_hash=?")
      .bind(previous?.token_hash ?? ""),
  ]);
  return json(
    {
      farcasterFid: fid,
      walletAddress: wallet,
      expiresAt: new Date(expiry).toISOString(),
    },
    200,
    { "set-cookie": setCookie(request, cookieName(request), token) },
  );
}
// Session response construction is centralized to keep rotation and cookie policy identical.
async function login(
  db: Database,
  request: Request,
  identity: { fid?: number; wallet?: string },
) {
  const response = await establish(db, request, identity);
  return response;
}
async function consume(db: Database, c: Challenge) {
  const r = await run(
    db,
    "UPDATE meme_challenges SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL AND expires_at>?",
    Date.now(),
    c.nonce,
    Date.now(),
  );
  requireThat(r.meta.changes === 1, 409, "Challenge already used or expired");
}
async function challenge(
  db: Database,
  request: Request,
  nonce: string,
  kind: string,
) {
  const c = await one<Challenge>(
    db,
    "SELECT * FROM meme_challenges WHERE nonce=? AND kind=?",
    nonce,
    kind,
  );
  requireThat(
    c &&
      c.origin === new URL(request.url).origin &&
      c.expires_at > Date.now() &&
      c.consumed_at == null,
    401,
    "Invalid or expired challenge",
  );
  return c;
}
async function createChallenge(
  db: Database,
  request: Request,
  kind: string,
  address: string | null,
  fid: number | null,
  role: string | null,
  message: (
    nonce: string,
    issuedAt: string,
    expiresAt: number,
  ) => string | null,
) {
  const nonce = random(),
    issued = new Date().toISOString(),
    expires = Date.now() + 300000,
    s = await session(db, request);
  const content = message(nonce, issued, expires);
  await run(
    db,
    "INSERT INTO meme_challenges VALUES(?,?,?,?,?,?,?,?,?,?,NULL)",
    nonce,
    kind,
    new URL(request.url).origin,
    address,
    fid,
    role,
    s?.token_hash ?? null,
    content,
    issued,
    expires,
  );
  return { nonce, message: content, issuedAt: issued, expiresAt: expires };
}
export async function sessionView(db: Database, request: Request) {
  const s = await session(db, request);
  const links = s?.fid
    ? await rows<{ chain: string; address: string; role: string }>(
        db,
        "SELECT chain,address,role FROM meme_wallet_links WHERE fid=? AND revoked_at IS NULL",
        s.fid,
      )
    : [];
  return {
    authenticated: !!s,
    farcasterFid: s?.fid ?? null,
    farcasterProfile: s?.fid
      ? { fid: s.fid, username: null, displayName: null, pfpUrl: null }
      : null,
    walletAddress: s?.wallet ?? null,
    identitiesLinked: links.some(
      (l) => l.chain === "base" && l.address === s?.wallet,
    ),
    expiresAt: s ? new Date(s.expires_at).toISOString() : null,
    actionSessionToken: null,
    solanaWallet:
      links.find((l) => l.chain === "solana" && l.role === "reward")?.address ??
      null,
    baseWallets: links.filter((l) => l.chain === "base").map((l) => l.address),
    wallets: links,
  };
}
async function relay(url: string, init?: RequestInit) {
  const response = await fetch("https://relay.farcaster.xyz/v1/" + url, {
    ...init,
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  requireThat(response.ok, 502, "Farcaster relay unavailable");
  const reader = response.body?.getReader();
  requireThat(reader, 502, "Empty relay response");
  let data = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const n = await reader.read();
      if (n.done) break;
      size += n.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Problem(502, "Relay response too large");
      }
      data += decoder.decode(n.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(data);
  requireThat(
    value && typeof value === "object" && !Array.isArray(value),
    502,
    "Invalid relay response",
  );
  return value as Record<string, unknown>;
}
async function verifyFarcaster(
  db: Database,
  request: Request,
  p: Record<string, unknown>,
) {
  let fid: number;
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const result = await createClient().verifyJwt({
      token: bearer.slice(7),
      domain: new URL(request.url).host,
    });
    fid = Number(result.sub);
  } else {
    const nonce = text(p.nonce, "nonce"),
      c = await challenge(db, request, nonce, "farcaster");
    const message = text(p.message, "message", 8192),
      signature = text(p.signature, "signature", 1024);
    requireThat(/^0x[0-9a-fA-F]+$/.test(signature), 400, "Invalid signature");
    const client = createAppClient({
      ethereum: viemConnector({ rpcUrl: "https://mainnet.optimism.io" }),
    });
    const proof = await client.verifySignInMessage({
      message,
      signature: signature as `0x${string}`,
      domain: new URL(request.url).host,
      nonce,
    });
    requireThat(
      proof.success &&
        proof.fid &&
        new URL(String(proof.data.uri)).href === c.message,
      401,
      "Invalid signed Farcaster identity",
    );
    fid = Number(proof.fid);
    requireThat(p.fid == null || p.fid === fid, 401, "FID mismatch");
    await consume(db, c);
  }
  requireThat(
    Number.isSafeInteger(fid) && fid > 0,
    401,
    "Invalid Farcaster identity",
  );
  await run(
    db,
    "INSERT INTO meme_audit(at,actor,action,subject,detail) VALUES(?,?,'sign-in',?,'{}')",
    Date.now(),
    String(fid),
    String(fid),
  );
  return login(db, request, { fid });
}
export async function authRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/auth/")) return null;
  if (request.method === "GET" && path === "/api/auth/session")
    return json(await sessionView(db, request));
  requireThat(
    ["POST", "DELETE"].includes(request.method),
    405,
    "Method not allowed",
  );
  const window = Math.floor(Date.now() / 60000),
    bucket = await sha(
      (request.headers.get("cf-connecting-ip") ?? "local") + ":" + path,
    );
  const limit = await one<{ attempts: number }>(
    db,
    "INSERT INTO meme_auth_limits VALUES(?,?,1) ON CONFLICT(bucket,window) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    bucket,
    window,
  );
  requireThat(limit && limit.attempts <= 120, 429, "Try again later");
  if (path === "/api/auth/logout") {
    const p = await payload(request, ["principal"]),
      s = await session(db, request);
    if (s) {
      if (p.principal === "wallet")
        await run(
          db,
          "UPDATE meme_sessions SET wallet=NULL WHERE token_hash=?",
          s.token_hash,
        );
      else if (p.principal === "farcaster")
        await run(
          db,
          "UPDATE meme_sessions SET fid=NULL WHERE token_hash=?",
          s.token_hash,
        );
      else
        await run(
          db,
          "DELETE FROM meme_sessions WHERE token_hash=?",
          s.token_hash,
        );
    }
    return json({ ok: true });
  }
  if (path === "/api/auth/farcaster/challenge") {
    const p = await payload(request, ["uri"]),
      uri = new URL(text(p.uri, "uri", 2048));
    requireThat(
      uri.origin === new URL(request.url).origin,
      400,
      "Sign-in URL must belong to this app",
    );
    const c = await createChallenge(
      db,
      request,
      "farcaster",
      null,
      null,
      null,
      () => uri.href,
    );
    return json({
      nonce: c.nonce,
      expiresAt: new Date(c.expiresAt).toISOString(),
    });
  }
  if (path === "/api/auth/farcaster/verify") {
    const p = request.headers.has("authorization")
      ? {}
      : await payload(request, ["nonce", "message", "signature", "fid"]);
    return verifyFarcaster(db, request, p);
  }
  if (path === "/api/auth/farcaster/channel") {
    const p = await payload(request, ["nonce", "uri"]),
      c = await challenge(db, request, text(p.nonce, "nonce"), "farcaster");
    requireThat(c.message === p.uri, 400, "URI mismatch");
    const result = await relay("channel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nonce: c.nonce,
        siweUri: c.message,
        domain: new URL(request.url).host,
      }),
    });
    const token = text(result.channelToken, "channel"),
      recovery = random();
    requireThat(result.nonce === c.nonce, 502, "Relay nonce mismatch");
    await run(
      db,
      "INSERT INTO meme_channels VALUES(?,?,?,?,?,?,NULL,NULL)",
      token,
      await sha(recovery),
      c.nonce,
      c.message,
      c.origin,
      c.expires_at,
    );
    return json(result, 200, {
      "set-cookie": setCookie(request, "meme_handoff", recovery, 300),
    });
  }
  if (path === "/api/auth/farcaster/status") {
    const p = await payload(request, ["channelToken", "cancel"]),
      recovery = cookie(request, "meme_handoff");
    if (p.cancel === true) {
      if (recovery)
        await run(
          db,
          "DELETE FROM meme_channels WHERE recovery_hash=?",
          await sha(recovery),
        );
      return json({ state: "idle" }, 200, {
        "set-cookie": setCookie(request, "meme_handoff", "", 0),
      });
    }
    if (!recovery) return json({ state: "idle" });
    const c = await one<{
      token: string;
      nonce: string;
      uri: string;
      expires_at: number;
      started_at: number | null;
      verified_fid: number | null;
    }>(
      db,
      "SELECT * FROM meme_channels WHERE recovery_hash=? AND origin=? AND expires_at>?",
      await sha(recovery),
      new URL(request.url).origin,
      Date.now(),
    );
    if (!c || (!p.channelToken && !c.started_at))
      return json({ state: "idle" });
    requireThat(
      p.channelToken == null || p.channelToken === c.token,
      401,
      "Channel mismatch",
    );
    if (c.verified_fid) {
      const signed = await login(db, request, { fid: c.verified_fid });
      return json(
        { state: "completed", session: await signed.json() },
        200,
        signed.headers,
      );
    }
    await run(
      db,
      "UPDATE meme_channels SET started_at=COALESCE(started_at,?) WHERE token=?",
      Date.now(),
      c.token,
    );
    const result = await relay("channel/status", {
      headers: { authorization: "Bearer " + c.token },
    });
    if (
      typeof result.message === "string" &&
      typeof result.signature === "string"
    ) {
      const verified = await verifyFarcaster(db, request, {
        nonce: c.nonce,
        message: result.message,
        signature: result.signature,
        ...(result.fid ? { fid: result.fid } : {}),
      });
      const view = (await verified.json()) as { farcasterFid: number };
      await run(
        db,
        "UPDATE meme_channels SET verified_fid=? WHERE token=?",
        view.farcasterFid,
        c.token,
      );
      return json({ state: "completed", session: view }, 200, verified.headers);
    }
    return json({
      ...result,
      recovery: {
        channelToken: c.token,
        nonce: c.nonce,
        uri: c.uri,
        expiresAt: c.expires_at,
        initiatedAt: c.started_at ?? Date.now(),
      },
    });
  }
  if (path === "/api/auth/wallet/challenge") {
    const p = await payload(request, ["address", "chainId"]);
    requireThat(p.chainId === 8453, 400, "Base Mainnet required");
    const address =
      p.address == null ? null : text(p.address, "address").toLowerCase();
    requireThat(
      !address || /^0x[0-9a-f]{40}$/.test(address),
      400,
      "Invalid Base address",
    );
    const c = await createChallenge(
      db,
      request,
      "base",
      address,
      null,
      null,
      (nonce, issued, expires) =>
        address
          ? createSiweMessage({
              address: address as `0x${string}`,
              domain: new URL(request.url).host,
              uri: new URL(request.url).origin,
              version: "1",
              chainId: 8453,
              nonce,
              issuedAt: new Date(issued),
              expirationTime: new Date(expires),
              statement: "Sign in to 10X.meme. No blockchain transaction.",
            })
          : null,
    );
    return json({
      ...c,
      signInWithEthereum: {
        nonce: c.nonce,
        chainId: "0x2105",
        domain: new URL(request.url).host,
        uri: new URL(request.url).origin,
        version: "1",
        statement: "Sign in to 10X.meme. No blockchain transaction.",
        issuedAt: c.issuedAt,
        expirationTime: new Date(c.expiresAt).toISOString(),
      },
    });
  }
  if (path === "/api/auth/wallet/verify") {
    const p = await payload(request, ["message", "signature"]),
      message = text(p.message, "message", 8192),
      signature = text(p.signature, "signature", 8192),
      siwe = parseSiweMessage(message);
    const c = await challenge(db, request, text(siwe.nonce, "nonce"), "base"),
      address = siwe.address?.toLowerCase();
    requireThat(
      address &&
        /^0x[0-9a-f]{40}$/.test(address) &&
        (!c.address || c.address === address) &&
        siwe.chainId === 8453 &&
        siwe.domain === new URL(request.url).host &&
        siwe.uri === c.origin &&
        siwe.issuedAt?.toISOString() === c.issued_at &&
        siwe.expirationTime?.getTime() === c.expires_at,
      401,
      "Signed wallet challenge mismatch",
    );
    let valid = false;
    try {
      valid =
        (
          await recoverMessageAddress({
            message,
            signature: signature as `0x${string}`,
          })
        ).toLowerCase() === address;
    } catch {
      /* smart wallet checked below */
    }
    if (!valid)
      valid = await createPublicClient({
        chain: base,
        transport: http("https://mainnet.base.org", {
          timeout: 10000,
          retryCount: 0,
        }),
      })
        .verifySiweMessage({
          message,
          signature: signature as `0x${string}`,
          domain: siwe.domain,
          nonce: c.nonce,
        })
        .catch(() => false);
    requireThat(valid, 401, "Invalid wallet signature");
    await consume(db, c);
    return login(db, request, { wallet: address });
  }
  if (path === "/api/auth/link") {
    const s = await principal(db, request);
    requireThat(s.wallet, 401, "Verify a Base wallet first");
    if (request.method === "DELETE") {
      await run(
        db,
        "UPDATE meme_wallet_links SET revoked_at=? WHERE fid=? AND chain='base' AND address=?",
        Date.now(),
        s.fid,
        s.wallet,
      );
      return json({ linked: false });
    }
    const p = await payload(request, ["confirm", "automatic"]);
    requireThat(p.confirm === true, 409, "Confirmation required");
    await run(
      db,
      "INSERT INTO meme_wallet_links VALUES(?,'base',?,'boost',?,NULL,?) ON CONFLICT(fid,chain,address) DO UPDATE SET verified_at=excluded.verified_at,revoked_at=NULL,proof_hash=excluded.proof_hash",
      s.fid,
      s.wallet,
      Date.now(),
      s.token_hash,
    );
    return json({ linked: true });
  }
  if (path === "/api/auth/solana/challenge") {
    const s = await principal(db, request),
      p = await payload(request, ["address", "role"]),
      address = text(p.address, "address");
    decode58(address, 32);
    requireThat(
      p.role === undefined || p.role === "holding" || p.role === "reward",
      400,
      "Invalid Solana wallet role",
    );
    const role = p.role === "holding" ? "holding" : "reward";
    const c = await createChallenge(
      db,
      request,
      "solana",
      address,
      s.fid,
      role,
      (nonce, issued, expires) =>
        `${new URL(request.url).host} wants you to verify your Solana wallet:\n${address}\n\nLink ${role} wallet to Farcaster FID ${s.fid} for 10X.meme. No transaction.\nURI: ${new URL(request.url).origin}\nNonce: ${nonce}\nIssued At: ${issued}\nExpiration Time: ${new Date(expires).toISOString()}`,
    );
    return json(c);
  }
  if (path === "/api/auth/solana/verify") {
    const s = await principal(db, request),
      p = await payload(request, ["nonce", "signature"]),
      c = await challenge(db, request, text(p.nonce, "nonce"), "solana");
    requireThat(
      c.fid === s.fid &&
        c.session_hash === s.token_hash &&
        c.address &&
        c.message,
      401,
      "Wallet proof belongs to another session",
    );
    const key = await crypto.subtle.importKey(
      "raw",
      decode58(c.address, 32),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    requireThat(
      await crypto.subtle.verify(
        "Ed25519",
        key,
        decode58(text(p.signature, "signature"), 64),
        new TextEncoder().encode(c.message),
      ),
      401,
      "Invalid Solana signature",
    );
    const statements = [
      db
        .prepare(
          "INSERT INTO meme_nonce_uses VALUES((SELECT nonce FROM meme_challenges WHERE nonce=? AND consumed_at IS NULL AND expires_at>?))",
        )
        .bind(c.nonce, Date.now()),
      db
        .prepare(
          "UPDATE meme_challenges SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL AND expires_at>?",
        )
        .bind(Date.now(), c.nonce, Date.now()),
    ];
    if (c.role === "reward")
      statements.push(
        db
          .prepare(
            "UPDATE meme_wallet_links SET revoked_at=? WHERE fid=? AND chain='solana' AND role='reward' AND revoked_at IS NULL AND changes()=1",
          )
          .bind(Date.now(), s.fid),
      );
    statements.push(
      db
        .prepare(
          "INSERT INTO meme_wallet_links VALUES(?,'solana',?,?,?,NULL,?) ON CONFLICT(fid,chain,address) DO UPDATE SET role=CASE WHEN meme_wallet_links.role='reward' AND meme_wallet_links.revoked_at IS NULL AND excluded.role='holding' THEN 'reward' ELSE excluded.role END,verified_at=excluded.verified_at,revoked_at=NULL,proof_hash=excluded.proof_hash",
        )
        .bind(s.fid, c.address, c.role, Date.now(), await sha(c.message)),
    );
    await db.batch(statements);
    return json(await sessionView(db, request));
  }
  throw new Problem(404, "Unknown authentication route");
}
