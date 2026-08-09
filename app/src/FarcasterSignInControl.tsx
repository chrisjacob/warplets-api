import { useCallback, useEffect, useState } from "react";
import { AuthKitProvider, SignInButton } from "@farcaster/auth-kit";
import "@farcaster/auth-kit/styles.css";
import type { StatusAPIResponse } from "@farcaster/auth-client";
import { verifyFarcasterSiwf } from "./appSession";

export interface FarcasterWebIdentity {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  actionSessionToken: string | null;
}

interface FarcasterChallenge { nonce: string; uri: string }

function currentSignInUri(): string {
  const uri = new URL(window.location.href);
  uri.hash = "";
  return uri.href;
}

async function requestNonce(): Promise<FarcasterChallenge> {
  const uri = currentSignInUri();
  const response = await fetch("/api/auth/farcaster/challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri }),
  });
  const payload = await response.json() as { nonce?: unknown; error?: unknown };
  if (!response.ok || typeof payload.nonce !== "string") {
    throw new Error(typeof payload.error === "string" ? payload.error : "Farcaster sign-in could not start");
  }
  return { nonce: payload.nonce, uri };
}

export default function FarcasterSignInControl({
  disabled = false,
  connected = false,
  onAuthenticated,
  onError,
}: {
  disabled?: boolean;
  connected?: boolean;
  onAuthenticated: (identity: FarcasterWebIdentity) => void;
  onError?: (message: string) => void;
}) {
  const [challenge, setChallenge] = useState<FarcasterChallenge | null>(null);
  const [verifying, setVerifying] = useState(false);

  const refreshNonce = useCallback(() => {
    setChallenge(null);
    void requestNonce().then(setChallenge).catch((error) => {
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in could not start");
    });
  }, [onError]);

  useEffect(() => { if (!connected) refreshNonce(); }, [connected, refreshNonce]);

  const complete = useCallback(async (result: StatusAPIResponse) => {
    if (!result.message || !result.signature || !result.nonce) {
      onError?.("Farcaster did not return a complete sign-in proof");
      refreshNonce();
      return;
    }
    setVerifying(true);
    try {
      const session = await verifyFarcasterSiwf({
        nonce: result.nonce,
        message: result.message,
        signature: result.signature,
        ...(Number.isInteger(result.fid) && Number(result.fid) > 0 ? { fid: result.fid } : {}),
      });
      const verifiedFid = Number(session.farcasterFid);
      if (!Number.isInteger(verifiedFid) || verifiedFid <= 0) throw new Error("Farcaster identity could not be restored");
      const value = (primary: unknown, fallback: unknown): string | null => {
        if (typeof primary === "string" && primary.trim()) return primary.trim();
        return typeof fallback === "string" && fallback.trim() ? fallback.trim() : null;
      };
      onAuthenticated({
        fid: verifiedFid,
        username: value(result.username, session.username),
        displayName: value(result.displayName, session.displayName),
        pfpUrl: value(result.pfpUrl, session.pfpUrl),
        actionSessionToken: typeof session.actionSessionToken === "string" ? session.actionSessionToken : null,
      });
    } catch (error) {
      setVerifying(false);
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in failed");
      refreshNonce();
    }
  }, [onAuthenticated, onError, refreshNonce]);

  if (connected) return <button type="button" disabled>Connected</button>;
  if (verifying) return <button type="button" disabled>Connecting…</button>;
  if (disabled || !challenge) return <button type="button" disabled>Connect Farcaster</button>;
  return (
    <AuthKitProvider config={{ domain: window.location.host, siweUri: challenge.uri }}>
      <div className="farcaster-signin-control">
        <SignInButton nonce={challenge.nonce} hideSignOut onSuccess={(result) => void complete(result)} onError={() => refreshNonce()} />
      </div>
    </AuthKitProvider>
  );
}
