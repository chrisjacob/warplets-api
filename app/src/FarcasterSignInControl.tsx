import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthKitProvider, SignInButton } from "@farcaster/auth-kit";
import "@farcaster/auth-kit/styles.css";
import type { StatusAPIResponse } from "@farcaster/auth-client";
import { loadAppSession, verifyFarcasterSiwf } from "./appSession";

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

function FarcasterSignInControl({
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
  const completionStartedRef = useRef(false);

  const refreshNonce = useCallback(() => {
    completionStartedRef.current = false;
    setChallenge(null);
    void requestNonce().then(setChallenge).catch((error) => {
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in could not start");
    });
  }, [onError]);

  useEffect(() => { if (!connected) refreshNonce(); }, [connected, refreshNonce]);

  const complete = useCallback(async (result: StatusAPIResponse) => {
    if (completionStartedRef.current) return;
    if (!result.message || !result.signature) {
      onError?.("Farcaster did not return a complete sign-in proof");
      refreshNonce();
      return;
    }
    completionStartedRef.current = true;
    setVerifying(true);
    try {
      const session = await verifyFarcasterSiwf({
        nonce: challenge?.nonce ?? "",
        message: result.message,
        signature: result.signature,
        ...(Number.isInteger(result.fid) && Number(result.fid) > 0 ? { fid: result.fid } : {}),
      });
      const verifiedFid = Number(session.farcasterFid);
      if (!Number.isInteger(verifiedFid) || verifiedFid <= 0) throw new Error("Farcaster identity could not be restored");
      const value = (primary: unknown, fallback: unknown): string | null => {
        const normalize = (candidate: unknown) => {
          if (typeof candidate !== "string") return null;
          const normalized = candidate.trim();
          return normalized && normalized.toLowerCase() !== "undefined" && normalized.toLowerCase() !== "null"
            ? normalized
            : null;
        };
        return normalize(primary) ?? normalize(fallback);
      };
      const restored = (!value(result.username, session.username) || !value(result.pfpUrl, session.pfpUrl))
        ? await loadAppSession().catch(() => null)
        : null;
      const restoredProfile = restored?.farcasterFid === verifiedFid ? restored.farcasterProfile : null;
      onAuthenticated({
        fid: verifiedFid,
        username: value(result.username, session.username) ?? restoredProfile?.username ?? null,
        displayName: value(result.displayName, session.displayName) ?? restoredProfile?.displayName ?? null,
        pfpUrl: value(result.pfpUrl, session.pfpUrl) ?? restoredProfile?.pfpUrl ?? null,
        actionSessionToken: typeof session.actionSessionToken === "string" ? session.actionSessionToken : null,
      });
    } catch (error) {
      setVerifying(false);
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in failed");
      refreshNonce();
    }
  }, [challenge?.nonce, onAuthenticated, onError, refreshNonce]);

  const handleAuthKitSuccess = useCallback((result: StatusAPIResponse) => {
    void complete(result);
  }, [complete]);

  const handleAuthKitError = useCallback((error?: unknown) => {
    // AuthKit can emit a trailing relay/polling error while the completed proof
    // is already being verified by our server. Do not replace a successful
    // channel with a fresh QR during that handoff.
    if (completionStartedRef.current) return;
    const possibleMessage = error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "").trim()
      : "";
    const message = possibleMessage || "Farcaster sign-in could not be completed";
    setVerifying(false);
    onError?.(message);
    refreshNonce();
  }, [onError, refreshNonce]);

  const authKitConfig = useMemo(() => ({
    domain: window.location.host,
    siweUri: challenge?.uri ?? currentSignInUri(),
  }), [challenge?.uri]);

  if (connected) return <button type="button" disabled>Connected</button>;
  if (verifying) return <button type="button" disabled>Connecting…</button>;
  if (disabled || !challenge) return <button type="button" disabled>Connect Farcaster</button>;
  return (
    <AuthKitProvider key={challenge.nonce} config={authKitConfig}>
      <div className="farcaster-signin-control">
        <SignInButton
          nonce={challenge.nonce}
          hideSignOut
          onSuccess={handleAuthKitSuccess}
          onError={handleAuthKitError}
        />
      </div>
    </AuthKitProvider>
  );
}

export default memo(FarcasterSignInControl);
