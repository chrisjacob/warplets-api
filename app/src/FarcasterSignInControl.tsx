import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthKitProvider, SignInButton } from "@farcaster/auth-kit";
import "@farcaster/auth-kit/styles.css";
import { createAppClient, viemConnector, type StatusAPIResponse } from "@farcaster/auth-client";
import { loadAppSession, verifyFarcasterSiwf } from "./appSession";
import { clearPendingFarcasterSignIn, readPendingFarcasterSignIn, writePendingFarcasterSignIn } from "./farcasterSignInPersistence";

export interface FarcasterWebIdentity {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  actionSessionToken: string | null;
}

interface FarcasterChallenge { nonce: string; uri: string }

const farcasterAuthClient = createAppClient({ relay: "https://relay.farcaster.xyz", ethereum: viemConnector({}), version: "v1" });

function usesMobileFarcasterHandoff(): boolean {
  return /iPhone|iPad|iPod/i.test(window.navigator.userAgent);
}

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
  onDisconnect,
  onError,
}: {
  disabled?: boolean;
  connected?: boolean;
  onAuthenticated: (identity: FarcasterWebIdentity) => void;
  onDisconnect?: () => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const [challenge, setChallenge] = useState<FarcasterChallenge | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [mobileHandoffPending, setMobileHandoffPending] = useState(() => Boolean(readPendingFarcasterSignIn()));
  const completionStartedRef = useRef(false);
  const resumeStartedRef = useRef(false);

  const refreshNonce = useCallback(() => {
    completionStartedRef.current = false;
    setChallenge(null);
    void requestNonce().then(setChallenge).catch((error) => {
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in could not start");
    });
  }, [onError]);

  useEffect(() => { if (!connected) refreshNonce(); }, [connected, refreshNonce]);

  const complete = useCallback(async (result: StatusAPIResponse, nonceOverride?: string) => {
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
        nonce: nonceOverride ?? challenge?.nonce ?? "",
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
      clearPendingFarcasterSignIn();
      setMobileHandoffPending(false);
    } catch (error) {
      clearPendingFarcasterSignIn();
      setMobileHandoffPending(false);
      setVerifying(false);
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in failed");
      refreshNonce();
    }
  }, [challenge?.nonce, onAuthenticated, onError, refreshNonce]);

  const resumeMobileHandoff = useCallback(async () => {
    const pending = readPendingFarcasterSignIn();
    if (!pending || completionStartedRef.current || resumeStartedRef.current) return;
    resumeStartedRef.current = true;
    setMobileHandoffPending(true);
    setVerifying(true);
    try {
      const result = await farcasterAuthClient.watchStatus({
        channelToken: pending.channelToken,
        interval: 1200,
        timeout: Math.max(1_000, pending.expiresAt - Date.now()),
      });
      if (result.isError || !result.data) throw result.error ?? new Error("Farcaster sign-in could not be restored");
      await complete(result.data, pending.nonce);
    } catch (error) {
      resumeStartedRef.current = false;
      clearPendingFarcasterSignIn();
      setMobileHandoffPending(false);
      setVerifying(false);
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in could not be restored");
      refreshNonce();
    }
  }, [complete, onError, refreshNonce]);

  useEffect(() => {
    if (!connected && readPendingFarcasterSignIn()) void resumeMobileHandoff();
  }, [connected, resumeMobileHandoff]);

  useEffect(() => {
    if (connected) return;
    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible" && readPendingFarcasterSignIn()) void resumeMobileHandoff();
    };
    window.addEventListener("pageshow", resumeWhenVisible);
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      window.removeEventListener("pageshow", resumeWhenVisible);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [connected, resumeMobileHandoff]);

  const startMobileHandoff = useCallback(async () => {
    if (!challenge) return;
    setMobileHandoffPending(true);
    try {
      const created = await farcasterAuthClient.createChannel({
        nonce: challenge.nonce,
        siweUri: challenge.uri,
        domain: window.location.host,
      });
      if (created.isError || !created.data) throw created.error ?? new Error("Farcaster sign-in could not start");
      writePendingFarcasterSignIn({
        channelToken: created.data.channelToken,
        nonce: created.data.nonce,
        uri: challenge.uri,
        expiresAt: Date.now() + 5 * 60_000,
      });
      window.location.assign(created.data.url);
    } catch (error) {
      clearPendingFarcasterSignIn();
      setMobileHandoffPending(false);
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in could not start");
    }
  }, [challenge, onError]);

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

  if (connected) return (
    <div className="farcaster-signin-control farcaster-signin-control--connected">
      <button
        type="button"
        disabled={disconnecting}
        onClick={() => {
          setDisconnecting(true);
          Promise.resolve(onDisconnect?.()).catch((error) => {
            onError?.(error instanceof Error ? error.message : "Farcaster identity could not be disconnected");
          }).finally(() => setDisconnecting(false));
        }}
      >
        {disconnecting ? "Disconnecting…" : "Disconnect"}
      </button>
    </div>
  );
  if (verifying || mobileHandoffPending) return <div className="farcaster-signin-control"><button type="button" disabled>Connecting…</button></div>;
  // Keep one visible idle label while AuthKit and its nonce initialize.
  if (disabled || !challenge) return <div className="farcaster-signin-control"><button type="button" disabled>Connect</button></div>;
  if (usesMobileFarcasterHandoff()) return (
    <div className="farcaster-signin-control">
      <button type="button" onClick={() => void startMobileHandoff()}>Connect</button>
    </div>
  );
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
