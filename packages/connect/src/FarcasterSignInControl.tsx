import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthKitProvider, SignInButton } from "@farcaster/auth-kit";
import "@farcaster/auth-kit/styles.css";
import { type StatusAPIResponse } from "@farcaster/auth-client";
import { loadAppSession, verifyFarcasterSiwf } from "./appSession";
import { clearPendingFarcasterSignIn, readPendingFarcasterSignIn, writePendingFarcasterSignIn } from "./farcasterSignInPersistence";
import { currentWalletBrowserSignals, resolveFarcasterMobileHandoffUrl } from "./farcasterHandoff";

export interface FarcasterWebIdentity {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  actionSessionToken: string | null;
}

interface FarcasterChallenge { nonce: string; uri: string }
interface PreparedMobileChannel {
  url: string;
  channelToken: string;
  nonce: string;
  uri: string;
  expiresAt: number;
}

interface FarcasterSignInDebugState {
  phase: string;
  relayState: string;
  pollCount: number;
  lastHttpStatus: number | null;
  proofReceived: boolean;
  serverSessionReceived: boolean;
  resumeEvents: number;
  initiatedAt: number | null;
  lastEvent: string;
  lastError: string | null;
}

function farcasterDiagnosticsEnabled(): boolean {
  return window.location.hostname === "warplet-local.10x.meme"
    || window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1";
}

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

type FarcasterChannelStatus = StatusAPIResponse & {
  session?: Record<string, unknown>;
  debugHttpStatus?: number;
  error?: unknown;
  recoverySource?: unknown;
};

async function requestFarcasterChannelStatus(channelToken: string): Promise<FarcasterChannelStatus> {
  const response = await fetch("/api/auth/farcaster/status", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelToken }),
  });
  const payload = await response.json().catch(() => null) as (FarcasterChannelStatus & { error?: unknown }) | null;
  if (payload && (payload.state as string) === "failed") {
    return { ...payload, debugHttpStatus: response.status };
  }
  if (!response.ok || !payload) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Farcaster sign-in status was unavailable");
  }
  return { ...payload, debugHttpStatus: response.status };
}

function discardFarcasterHandoff(): void {
  clearPendingFarcasterSignIn();
  void fetch("/api/auth/farcaster/status", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cancel: true }),
  }).catch(() => undefined);
}

async function createFarcasterChannel(challenge: FarcasterChallenge): Promise<{
  channelToken: string;
  nonce: string;
  url: string;
}> {
  const response = await fetch("/api/auth/farcaster/channel", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce: challenge.nonce, uri: challenge.uri }),
  });
  const payload = await response.json().catch(() => null) as {
    channelToken?: unknown;
    nonce?: unknown;
    url?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof payload?.channelToken !== "string" || typeof payload.nonce !== "string" || typeof payload.url !== "string") {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Farcaster sign-in could not start");
  }
  return { channelToken: payload.channelToken, nonce: payload.nonce, url: payload.url };
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
  const [preparedMobileChannel, setPreparedMobileChannel] = useState<PreparedMobileChannel | null>(null);
  const [debugNow, setDebugNow] = useState(() => Date.now());
  const [debugCopied, setDebugCopied] = useState(false);
  const [debugState, setDebugState] = useState<FarcasterSignInDebugState>(() => ({
    phase: readPendingFarcasterSignIn() ? "restoring" : "initializing",
    relayState: "not checked",
    pollCount: 0,
    lastHttpStatus: null,
    proofReceived: false,
    serverSessionReceived: false,
    resumeEvents: 0,
    initiatedAt: readPendingFarcasterSignIn()?.initiatedAt ?? null,
    lastEvent: "Component mounted",
    lastError: null,
  }));
  const completionStartedRef = useRef(false);
  const mobilePollGenerationRef = useRef(0);
  const mobilePollInFlightRef = useRef<string | null>(null);
  const debugEnabled = useMemo(farcasterDiagnosticsEnabled, []);
  const updateDebug = useCallback((update: Partial<FarcasterSignInDebugState>
    | ((current: FarcasterSignInDebugState) => Partial<FarcasterSignInDebugState>)) => {
    if (!debugEnabled) return;
    setDebugState((current) => ({
      ...current,
      ...(typeof update === "function" ? update(current) : update),
    }));
  }, [debugEnabled]);

  useEffect(() => {
    if (!debugEnabled || !debugState.initiatedAt || connected) return;
    const interval = window.setInterval(() => setDebugNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [connected, debugEnabled, debugState.initiatedAt]);

  const refreshNonce = useCallback(() => {
    completionStartedRef.current = false;
    setPreparedMobileChannel(null);
    setChallenge(null);
    updateDebug({ phase: "requesting challenge", lastEvent: "Requested sign-in challenge", lastError: null });
    void requestNonce().then((nextChallenge) => {
      setChallenge(nextChallenge);
      updateDebug({ phase: "preparing channel", lastEvent: "Challenge received" });
    }).catch((error) => {
      updateDebug({
        phase: "challenge failed",
        lastEvent: "Challenge request failed",
        lastError: error instanceof Error ? error.message : "Unknown challenge error",
      });
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in could not start");
    });
  }, [onError, updateDebug]);

  useEffect(() => { if (!connected) refreshNonce(); }, [connected, refreshNonce]);

  useEffect(() => {
    if (connected || !challenge || !usesMobileFarcasterHandoff() || readPendingFarcasterSignIn()) return;
    let active = true;
    void createFarcasterChannel(challenge).then((created) => {
      if (!active) return;
      const prepared = {
        channelToken: created.channelToken,
        nonce: created.nonce,
        uri: challenge.uri,
        expiresAt: Date.now() + 5 * 60_000,
      };
      setPreparedMobileChannel({
        ...prepared,
        // Base needs the direct Farcaster scheme while Trust Wallet rejects
        // custom Farcaster URLs and must follow the relay's HTTPS handoff.
        url: resolveFarcasterMobileHandoffUrl(created.url, currentWalletBrowserSignals()),
      });
      updateDebug({ phase: "ready", lastEvent: "Mobile relay channel prepared", relayState: "not checked" });
    }).catch((error) => {
      if (active) {
        updateDebug({
          phase: "channel failed",
          lastEvent: "Mobile relay channel preparation failed",
          lastError: error instanceof Error ? error.message : "Unknown channel error",
        });
        onError?.(error instanceof Error ? error.message : "Farcaster sign-in could not start");
      }
    });
    return () => { active = false; };
  }, [challenge, connected, onError, updateDebug]);

  const complete = useCallback(async (result: FarcasterChannelStatus, nonceOverride?: string) => {
    if (completionStartedRef.current) return;
    if (!result.session && (!result.message || !result.signature)) {
      updateDebug({
        phase: "incomplete proof",
        lastEvent: "Relay completed without a usable proof",
        proofReceived: false,
        serverSessionReceived: false,
        lastError: "Completed relay response did not include a proof or verified session",
      });
      discardFarcasterHandoff();
      mobilePollGenerationRef.current += 1;
      mobilePollInFlightRef.current = null;
      setMobileHandoffPending(false);
      setVerifying(false);
      onError?.("Farcaster did not return a complete sign-in proof");
      refreshNonce();
      return;
    }
    completionStartedRef.current = true;
    setVerifying(true);
    updateDebug({
      phase: "verifying",
      lastEvent: result.session ? "Server returned a verified session" : "Verifying relay proof",
      proofReceived: Boolean(result.message && result.signature),
      serverSessionReceived: Boolean(result.session),
    });
    try {
      const session = result.session ?? await verifyFarcasterSiwf({
        nonce: nonceOverride ?? challenge?.nonce ?? "",
        message: result.message!,
        signature: result.signature!,
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
      updateDebug({ phase: "connected", lastEvent: "Farcaster application session established", lastError: null });
      discardFarcasterHandoff();
      setMobileHandoffPending(false);
    } catch (error) {
      updateDebug({
        phase: "verification failed",
        lastEvent: "Proof or session verification failed",
        lastError: error instanceof Error ? error.message : "Unknown verification error",
      });
      discardFarcasterHandoff();
      setMobileHandoffPending(false);
      setVerifying(false);
      onError?.(error instanceof Error ? error.message : "Farcaster sign-in failed");
      refreshNonce();
    }
  }, [challenge?.nonce, onAuthenticated, onError, refreshNonce, updateDebug]);

  const resumeMobileHandoff = useCallback(async () => {
    const pending = readPendingFarcasterSignIn();
    if (!pending || completionStartedRef.current) return;
    // Base's iOS WebView can emit several pageshow/visibility events while it
    // resumes. Keep one poll alive for this channel instead of repeatedly
    // invalidating responses that are already on their way back.
    if (mobilePollInFlightRef.current === pending.channelToken) return;
    const generation = ++mobilePollGenerationRef.current;
    mobilePollInFlightRef.current = pending.channelToken;
    setMobileHandoffPending(true);
    setVerifying(true);
    updateDebug({
      phase: "polling",
      lastEvent: "Started same-origin relay polling",
      initiatedAt: pending.initiatedAt,
      lastError: null,
    });
    let lastError: unknown = null;
    const synchronizationDeadline = Math.min(pending.expiresAt, pending.initiatedAt + 45_000);
    while (generation === mobilePollGenerationRef.current) {
      try {
        const result = await requestFarcasterChannelStatus(pending.channelToken);
        if (generation !== mobilePollGenerationRef.current) return;
        updateDebug((current) => ({
          phase: (result.state as string) === "pending" ? "waiting for Farcaster" : "relay responded",
          relayState: String(result.state || "missing"),
          pollCount: current.pollCount + 1,
          lastHttpStatus: result.debugHttpStatus ?? null,
          proofReceived: Boolean(result.message && result.signature),
          serverSessionReceived: Boolean(result.session),
          lastEvent: result.recoverySource === "server-receipt"
            ? "Recovered verified approval from server receipt"
            : `Relay status received (${String(result.state || "missing")})`,
          lastError: null,
        }));
        if ((result.state as string) === "failed") {
          lastError = new Error(typeof result.error === "string"
            ? result.error
            : "Farcaster identity could not be verified");
          break;
        }
        // ConnectKit calls the terminal relay state `complete`; AuthKit calls
        // it `completed`. The API normalizes it, but accepting both here keeps
        // an already-loaded client compatible while the local server reloads.
        if ((result.state as string) === "completed" || (result.state as string) === "complete"
          || (typeof result.message === "string" && typeof result.signature === "string")) {
          await complete(result, pending.nonce);
          if (generation === mobilePollGenerationRef.current) mobilePollInFlightRef.current = null;
          return;
        }
      } catch (error) {
        lastError = error;
        updateDebug((current) => ({
          phase: "poll error",
          pollCount: current.pollCount + 1,
          lastEvent: "Relay status request failed",
          lastError: error instanceof Error ? error.message : "Unknown polling error",
        }));
      }
      if (Date.now() >= synchronizationDeadline) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
    }
    if (generation === mobilePollGenerationRef.current) {
      mobilePollInFlightRef.current = null;
      discardFarcasterHandoff();
      setMobileHandoffPending(false);
      setVerifying(false);
      updateDebug({
        phase: "synchronization timed out",
        lastEvent: "Stopped waiting after 45 seconds",
        lastError: lastError instanceof Error ? lastError.message : "Relay remained pending",
      });
      onError?.(lastError instanceof Error
        ? lastError.message
        : "Farcaster sign-in did not synchronize. Please tap Connect and try again.");
      refreshNonce();
    }
  }, [complete, onError, refreshNonce, updateDebug]);

  useEffect(() => {
    if (!connected && readPendingFarcasterSignIn()) void resumeMobileHandoff();
  }, [connected, resumeMobileHandoff]);

  useEffect(() => {
    if (connected) return;
    const resumeRestoredHandoff = () => {
      updateDebug((current) => ({
        phase: "restoring",
        resumeEvents: current.resumeEvents + 1,
        lastEvent: "Recovered handoff from secure server cookie",
      }));
      setMobileHandoffPending(true);
      void resumeMobileHandoff();
    };
    window.addEventListener("warplets:farcaster-handoff-restored", resumeRestoredHandoff);
    return () => window.removeEventListener("warplets:farcaster-handoff-restored", resumeRestoredHandoff);
  }, [connected, resumeMobileHandoff, updateDebug]);

  useEffect(() => {
    if (connected) return;
    const resumeWhenVisible = (event: Event) => {
      updateDebug((current) => ({
        resumeEvents: current.resumeEvents + 1,
        lastEvent: `${event.type}; visibility=${document.visibilityState}`,
      }));
      // Embedded iOS clients can restore a visibly active WebView while still
      // reporting `visibilityState === "hidden"`. Starting a new generation is
      // safe because every poll is a short, idempotent same-origin status read.
      if (readPendingFarcasterSignIn()) void resumeMobileHandoff();
    };
    window.addEventListener("pageshow", resumeWhenVisible);
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      window.removeEventListener("pageshow", resumeWhenVisible);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [connected, resumeMobileHandoff, updateDebug]);

  useEffect(() => () => {
    mobilePollGenerationRef.current += 1;
    mobilePollInFlightRef.current = null;
  }, []);

  const startMobileHandoff = useCallback(() => {
    if (!preparedMobileChannel) return;
    setMobileHandoffPending(true);
    const initiatedAt = Date.now();
    writePendingFarcasterSignIn({
      channelToken: preparedMobileChannel.channelToken,
      nonce: preparedMobileChannel.nonce,
      uri: preparedMobileChannel.uri,
      expiresAt: preparedMobileChannel.expiresAt,
      initiatedAt,
    });
    updateDebug({
      phase: "opening Farcaster",
      relayState: "not checked",
      pollCount: 0,
      lastHttpStatus: null,
      proofReceived: false,
      serverSessionReceived: false,
      initiatedAt,
      lastEvent: "Connect tapped; launching Farcaster URL",
      lastError: null,
    });
    // The anchor navigation remains the direct result of the user's tap. That
    // matters in iOS WebViews, which commonly reject custom-scheme launches
    // from hidden frames or after an awaited network request.
    void resumeMobileHandoff();
  }, [preparedMobileChannel, resumeMobileHandoff, updateDebug]);

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

  const diagnosticText = useMemo(() => JSON.stringify({
    capturedAt: new Date(debugNow).toISOString(),
    host: window.location.host,
    visibility: document.visibilityState,
    online: window.navigator.onLine,
    mobileHandoff: usesMobileFarcasterHandoff(),
    connected,
    buttonState: verifying || mobileHandoffPending ? "connecting" : preparedMobileChannel ? "ready" : "initializing",
    elapsedSeconds: debugState.initiatedAt ? Math.max(0, Math.round((debugNow - debugState.initiatedAt) / 1_000)) : null,
    ...debugState,
  }, null, 2), [connected, debugNow, debugState, mobileHandoffPending, preparedMobileChannel, verifying]);

  const diagnostics = debugEnabled ? (
    <details className="farcaster-signin-debug" open={verifying || mobileHandoffPending}>
      <summary>Local sign-in diagnostics</summary>
      <dl>
        <div><dt>Phase</dt><dd>{debugState.phase}</dd></div>
        <div><dt>Relay</dt><dd>{debugState.relayState}</dd></div>
        <div><dt>HTTP</dt><dd>{debugState.lastHttpStatus ?? "—"}</dd></div>
        <div><dt>Polls</dt><dd>{debugState.pollCount}</dd></div>
        <div><dt>Proof</dt><dd>{debugState.proofReceived ? "yes" : "no"}</dd></div>
        <div><dt>Session</dt><dd>{debugState.serverSessionReceived ? "yes" : "no"}</dd></div>
        <div><dt>Resumes</dt><dd>{debugState.resumeEvents}</dd></div>
        <div><dt>Elapsed</dt><dd>{debugState.initiatedAt ? `${Math.max(0, Math.round((debugNow - debugState.initiatedAt) / 1_000))}s` : "—"}</dd></div>
      </dl>
      <p><strong>Last event:</strong> {debugState.lastEvent}</p>
      {debugState.lastError ? <p className="farcaster-signin-debug__error"><strong>Error:</strong> {debugState.lastError}</p> : null}
      <button
        type="button"
        className="farcaster-signin-debug__copy"
        onClick={() => {
          void navigator.clipboard.writeText(diagnosticText).then(() => {
            setDebugCopied(true);
            window.setTimeout(() => setDebugCopied(false), 1_500);
          }).catch(() => {
            onError?.("Diagnostics could not be copied. Please take a screenshot of this panel.");
          });
        }}
      >{debugCopied ? "Copied" : "Copy diagnostics"}</button>
    </details>
  ) : null;

  let control: ReactNode;
  if (connected) control = (
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
  else if (verifying || mobileHandoffPending) control = <div className="farcaster-signin-control"><button type="button" disabled>Connecting…</button></div>;
  // Keep one visible idle label while AuthKit and its nonce initialize.
  else if (disabled || !challenge || (usesMobileFarcasterHandoff() && !preparedMobileChannel)) control = <div className="farcaster-signin-control"><button type="button" disabled>Connect</button></div>;
  else if (usesMobileFarcasterHandoff()) control = (
    <div className="farcaster-signin-control">
      <a
        className="farcaster-mobile-signin-button"
        href={preparedMobileChannel?.url}
        onClick={startMobileHandoff}
      >Connect</a>
    </div>
  );
  else control = (
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
  return <>{control}{diagnostics}</>;
}

export default memo(FarcasterSignInControl);
