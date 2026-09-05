import { AppViewport } from "./AppViewport";
import sdk from "@farcaster/miniapp-sdk";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { loadAppSession, logoutAppPrincipal, verifyFarcasterQuickAuth } from "./appSession";
import EmailWaitlistCta from "./EmailWaitlistCta";
import type { FarcasterWebIdentity } from "./FarcasterSignInControl";
import { hasPendingFarcasterSignIn, restorePendingFarcasterSignIn } from "./farcasterSignInPersistence";
import { hapticSelectionChanged, hapticSuccess, hapticTap } from "./haptics";
import { MiniAppHeader, MiniAppMenuPage, useMiniAppChrome } from "./miniAppChrome.tsx";
import MiniAppShell from "./MiniAppShell";
import { detectMiniAppContext } from "./miniAppContext";
import NotificationsPromptModal from "./NotificationsPromptModal";
import { PwaControls } from "./PwaControls";
import SiteFooter from "./SiteFooter";
import { isEmbeddedWebView, isLikelyBaseAppBrowser, isStandaloneDisplay, subscribeToWebPush } from "./pwa";
import { FARCASTER_NOTIFICATIONS_MANUAL_ENABLE_MESSAGE, getEmbeddedWalletProvider } from "./surfaceAdapter";
import { WebConnectModal } from "./WebConnectModal";
import {
  configureFarcasterWallet,
  disconnectWallet,
  requestBaseAppWalletLogin,
  restoreFarcasterWallet,
  restoreWebWallet,
  useWalletController,
} from "./walletController";
import { WARPLETS_APP_ORIGINS } from "../shared/warpletsApp";

const FarcasterSignInControl = lazy(() => import("./FarcasterSignInControl"));

type ViewerProfile = {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
};

type HomeToast = {
  kind: "success" | "warning" | "error";
  message: string;
};

type HomeLink = {
  id: string;
  label: string;
  title: string;
  imageUrl: string;
  href: string;
  action: "warplets" | "farcaster" | "external";
};

function getWarpletsUrl(): string {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("-local.")) {
    return `${WARPLETS_APP_ORIGINS.local}/`;
  }
  if (hostname.includes("-dev.")) return `${WARPLETS_APP_ORIGINS.dev}/`;
  return `${WARPLETS_APP_ORIGINS.prod}/`;
}

function homeLinks(): HomeLink[] {
  return [
    { id: "warplets", label: "10X Warplets", title: "Open the 10X Warplets app", imageUrl: "/menu/10xwarplets.jpg", href: getWarpletsUrl(), action: "warplets" },
    { id: "farcaster", label: "Farcaster", title: "Follow @10XMeme.eth on Farcaster", imageUrl: "/menu/farcaster.png", href: "https://farcaster.xyz/10xmeme.eth", action: "farcaster" },
    { id: "x", label: "X (Twitter)", title: "Follow @10XMemeX on X", imageUrl: "/menu/x.png", href: "https://twitter.com/intent/follow?user_id=3275559396", action: "external" },
    { id: "discord", label: "Discord", title: "Join The 10X Network on Discord", imageUrl: "/menu/discord.png", href: "https://discord.gg/X7QrXueZkn", action: "external" },
    { id: "telegram", label: "Telegram", title: "Join 10X.MEME Alpha Signals on Telegram", imageUrl: "/menu/telegram.png", href: "https://t.me/The10XNetwork", action: "external" },
    { id: "opensea", label: "OpenSea", title: "View 10X Warplets on OpenSea", imageUrl: "/menu/opensea.png", href: "https://link.10x.meme/10xwarplets", action: "external" },
    { id: "fomo", label: "FOMO", title: "Follow @10XMemeX on FOMO", imageUrl: "/menu/fomo.jpg", href: "https://fomo.family/profile/10XMemeX", action: "external" },
    { id: "pumpfun", label: "Pump.fun", title: "Follow @10XMemeX on Pump.fun", imageUrl: "/menu/pumpfun.png", href: "https://pump.fun/profile/10XMemeX", action: "external" },
    { id: "youtube", label: "YouTube", title: "Watch 10X Meme on YouTube", imageUrl: "/menu/youtube.png", href: "https://www.youtube.com/@10XMemeX", action: "external" },
  ];
}

function formatShortWallet(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function HomeAccountControl({
  isInMiniAppContext,
  viewerProfile,
  walletAddress,
  showInstallWebApp,
  open,
  centered,
  onOpenChange,
  onAvatarToggle,
  onOpen,
  onEnableNotifications,
  onInstallWebApp,
  onDisconnect,
}: {
  isInMiniAppContext: boolean;
  viewerProfile: ViewerProfile | null;
  walletAddress: string | null;
  showInstallWebApp: boolean;
  open: boolean;
  centered: boolean;
  onOpenChange: (open: boolean) => void;
  onAvatarToggle: () => void;
  onOpen: () => void;
  onEnableNotifications?: () => void;
  onInstallWebApp: () => void;
  onDisconnect: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const connected = Boolean(viewerProfile || walletAddress);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (event.target instanceof Element && event.target.closest(".miniapp-header__title-badge")) return;
      onOpenChange(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  const runMenuAction = (action: () => void) => {
    onOpenChange(false);
    void hapticTap();
    action();
  };

  if (!connected) {
    return (
      <div className="search-header-account" ref={rootRef}>
        {!isInMiniAppContext && (
          <button type="button" className="search-header-connect-button" onClick={() => { void hapticTap(); onOpen(); }}>
            Connect
          </button>
        )}
        {open && (
          <AppViewport portalled={centered} onMouseDown={(event) => event.stopPropagation()} className={`search-header-account-menu${centered ? " search-header-account-menu--centered" : ""}`} role="menu">
            {!isInMiniAppContext && (
              <button type="button" role="menuitem" className="search-header-account-menu__connection" onClick={() => runMenuAction(onOpen)}>
                <span className="search-header-account-menu__avatar-frame"><img src="/base.webp" alt="" /></span>
                <span>Connect wallet</span>
              </button>
            )}
            <button type="button" role="menuitem" className="search-header-account-menu__connection" onClick={() => isInMiniAppContext ? onOpenChange(false) : runMenuAction(onOpen)}>
              <span className="search-header-account-menu__avatar-frame"><img src="/farcaster.webp" alt="" /></span>
              <span>Connect social</span>
            </button>
            {onEnableNotifications && <button type="button" role="menuitem" onClick={() => runMenuAction(onEnableNotifications)}>Enable notifications</button>}
            {showInstallWebApp && <button type="button" role="menuitem" onClick={() => runMenuAction(onInstallWebApp)}>Install web app</button>}
          </AppViewport>
        )}
      </div>
    );
  }

  return (
    <div className="search-header-account" ref={rootRef}>
      <button
        type="button"
        className="search-header-avatar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={viewerProfile?.username ? `Connected as @${viewerProfile.username}` : "Connected account"}
        title="Manage connected accounts"
        onClick={() => {
          void hapticTap();
          onAvatarToggle();
        }}
      >
        <span className="search-header-avatar-stack">
          {walletAddress && !isInMiniAppContext && (
            <span className="search-header-avatar-frame search-header-avatar-frame--wallet">
              <img src="/base.webp" alt="" className="search-header-avatar-image" />
            </span>
          )}
          {viewerProfile && (
            <span className="search-header-avatar-frame search-header-avatar-frame--identity">
              <img src={viewerProfile.pfpUrl || "/farcaster.webp"} alt="" className="search-header-avatar-image" />
            </span>
          )}
        </span>
      </button>
      {open && (
        <AppViewport portalled={centered} onMouseDown={(event) => event.stopPropagation()} className={`search-header-account-menu${centered ? " search-header-account-menu--centered" : ""}`} role="menu">
          {!isInMiniAppContext && (
            <button type="button" role="menuitem" className="search-header-account-menu__connection" onClick={() => runMenuAction(onOpen)}>
              <span className="search-header-account-menu__avatar-frame"><img src="/base.webp" alt="" /></span>
              <span>{walletAddress ? formatShortWallet(walletAddress) : "Connect wallet"}</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="search-header-account-menu__connection"
            onClick={() => isInMiniAppContext ? onOpenChange(false) : runMenuAction(onOpen)}
          >
            <span className="search-header-account-menu__avatar-frame">
              <img src={viewerProfile?.pfpUrl || "/farcaster.webp"} alt="" />
            </span>
            <span>{viewerProfile?.username ? `@${viewerProfile.username}` : viewerProfile?.displayName || "Connect social"}</span>
          </button>
          {onEnableNotifications && (
            <button type="button" role="menuitem" onClick={() => runMenuAction(onEnableNotifications)}>
              Enable notifications
            </button>
          )}
          {showInstallWebApp && (
            <button type="button" role="menuitem" onClick={() => runMenuAction(onInstallWebApp)}>
              Install web app
            </button>
          )}
          {!isInMiniAppContext && (
            <button type="button" role="menuitem" onClick={() => runMenuAction(onDisconnect)}>
              Disconnect
            </button>
          )}
        </AppViewport>
      )}
    </div>
  );
}

export default function App() {
  const walletController = useWalletController();
  const [showAddAppPrompt, setShowAddAppPrompt] = useState(false);
  const [notificationsOnlyPrompt, setNotificationsOnlyPrompt] = useState(false);
  const [actionError, setActionError] = useState("");
  const [isInMiniAppContext, setIsInMiniAppContext] = useState(false);
  const [miniAppContextKnown, setMiniAppContextKnown] = useState(false);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [actionSessionToken, setActionSessionToken] = useState<string | null>(null);
  const [webConnectOpen, setWebConnectOpen] = useState(() => hasPendingFarcasterSignIn());
  const [webConnectIdentityError, setWebConnectIdentityError] = useState<string | null>(null);
  const [homeToast, setHomeToast] = useState<HomeToast | null>(null);
  const [homeLinksVisible, setHomeLinksVisible] = useState(false);
  const [headerAccountMenuAnchor, setHeaderAccountMenuAnchor] = useState<"title" | "avatar" | null>(null);
  const handleHeaderAccountMenuOpenChange = useCallback((open: boolean) => {
    if (!open) setHeaderAccountMenuAnchor(null);
  }, []);
  const handleHeaderTitleMenuToggle = useCallback(() => {
    setHeaderAccountMenuAnchor((current) => current === "title" ? null : "title");
  }, []);
  const handleHeaderAvatarMenuToggle = useCallback(() => {
    setHeaderAccountMenuAnchor((current) => current === "avatar" ? null : "avatar");
  }, []);
  const initializationStartedRef = useRef(false);
  const sessionRefreshInFlightRef = useRef(false);
  const homeLinksSectionRef = useRef<HTMLElement | null>(null);
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("app");

  useEffect(() => {
    setHeaderAccountMenuAnchor(null);
  }, [isMenuRoute]);

  const applySession = useCallback((session: Awaited<ReturnType<typeof loadAppSession>> | null) => {
    if (!session?.farcasterFid) return;
    setViewerProfile(session.farcasterProfile ?? { fid: session.farcasterFid, username: null, displayName: null, pfpUrl: null });
    setActionSessionToken(session.actionSessionToken);
    setWebConnectOpen(false);
  }, []);

  useEffect(() => {
    if (!miniAppContextKnown || isInMiniAppContext || viewerProfile) return;

    const refreshReturnedSession = () => {
      if (hasPendingFarcasterSignIn()) setWebConnectOpen(true);
      if (sessionRefreshInFlightRef.current) return;
      sessionRefreshInFlightRef.current = true;
      void loadAppSession()
        .then(applySession)
        .catch(() => undefined)
        .finally(() => { sessionRefreshInFlightRef.current = false; });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshReturnedSession();
    };

    void restorePendingFarcasterSignIn().then((pending) => {
      if (pending) setWebConnectOpen(true);
      refreshReturnedSession();
    });
    window.addEventListener("pageshow", refreshReturnedSession);
    window.addEventListener("focus", refreshReturnedSession);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", refreshReturnedSession);
      window.removeEventListener("focus", refreshReturnedSession);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [applySession, isInMiniAppContext, miniAppContextKnown, viewerProfile]);

  useEffect(() => {
    if (initializationStartedRef.current) return;
    initializationStartedRef.current = true;
    let shouldCallReady = false;

    const initialize = async () => {
      try {
        const inMiniApp = await detectMiniAppContext(
          typeof sdk.isInMiniApp === "function" ? () => sdk.isInMiniApp() : undefined,
        );
        setIsInMiniAppContext(inMiniApp);
        configureFarcasterWallet(inMiniApp
          ? async () => {
            const provider = await getEmbeddedWalletProvider();
            if (!provider) throw new Error("Farcaster wallet is unavailable");
            return provider;
          }
          : null);

        const inBaseApp = isLikelyBaseAppBrowser();
        if (inBaseApp) {
          setNotificationsOnlyPrompt(true);
          void requestBaseAppWalletLogin().then(async (baseSession) => {
            if (baseSession) {
              const response = await fetch("/api/notifications/base/status", {
                headers: { accept: "application/json" },
                credentials: "same-origin",
              }).catch(() => null);
              if (response?.ok) {
                const status = await response.json() as { appPinned?: unknown; notificationsEnabled?: unknown };
                if (status.appPinned === true && status.notificationsEnabled === true) return;
              }
            }
            setShowAddAppPrompt(true);
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (!/reject|denied|cancel/i.test(message)) console.warn("10X.MEME Base wallet login failed:", error);
            setShowAddAppPrompt(true);
          });
        }

        if (!inMiniApp) {
          const [, session] = await Promise.all([
            (inBaseApp ? Promise.resolve(null) : restoreWebWallet()).catch((error) => {
              console.warn("10X.MEME wallet restore failed:", error);
              return null;
            }),
            loadAppSession().catch((error) => {
              console.warn("10X.MEME session restore failed:", error);
              return null;
            }),
          ]);
          applySession(session);
          return;
        }

        shouldCallReady = true;
        const context = await sdk.context;
        const user = (context as { user?: Record<string, unknown> }).user;
        const rawFid = Number(user?.fid);
        const fid = Number.isInteger(rawFid) && rawFid > 0 ? rawFid : null;
        if (fid) {
          const liveProfile: ViewerProfile = {
            fid,
            username: typeof user?.username === "string" ? user.username : null,
            displayName: typeof user?.displayName === "string" ? user.displayName : typeof user?.display_name === "string" ? user.display_name : null,
            pfpUrl: typeof user?.pfpUrl === "string" ? user.pfpUrl : typeof user?.pfp_url === "string" ? user.pfp_url : typeof user?.pfp === "string" ? user.pfp : null,
          };
          setViewerProfile(liveProfile);
          void sdk.quickAuth.getToken()
            .then(({ token }) => verifyFarcasterQuickAuth(token))
            .then(async (session) => {
              const verifiedFid = Number(session.farcasterFid);
              setViewerProfile({
                fid: Number.isInteger(verifiedFid) && verifiedFid > 0 ? verifiedFid : fid,
                username: typeof session.username === "string" && session.username.trim() ? session.username.trim() : liveProfile.username,
                displayName: typeof session.displayName === "string" && session.displayName.trim() ? session.displayName.trim() : liveProfile.displayName,
                pfpUrl: typeof session.pfpUrl === "string" && session.pfpUrl.trim() ? session.pfpUrl.trim() : liveProfile.pfpUrl,
              });
              if (typeof session.actionSessionToken === "string") setActionSessionToken(session.actionSessionToken);
              await restoreFarcasterWallet();
            })
            .catch((error) => console.warn("10X.MEME Farcaster authentication failed:", error));
        }

        const client = (context as { client?: Record<string, unknown> }).client;
        const shouldPromptAddApp = (!client?.added || !client?.notificationDetails)
          && (window.location.hostname === "10x.meme" || new URLSearchParams(window.location.search).get("add") === "1");
        if (shouldPromptAddApp) {
          setShowAddAppPrompt(true);
          setNotificationsOnlyPrompt(client?.added === true && !client?.notificationDetails);
        }
      } catch (error) {
        console.error("10X.MEME initialization failed:", error);
      } finally {
        setMiniAppContextKnown(true);
        if (shouldCallReady) sdk.actions.ready();
      }
    };

    void initialize();
  }, [applySession]);

  useEffect(() => { document.title = "10X.MEME — The 10X Thesis"; }, []);
  useEffect(() => {
    if (!actionError) return;
    const id = window.setTimeout(() => setActionError(""), 5_000);
    return () => window.clearTimeout(id);
  }, [actionError]);
  useEffect(() => {
    if (!homeToast) return;
    const id = window.setTimeout(() => setHomeToast(null), homeToast.kind === "error" ? 8_000 : 5_000);
    return () => window.clearTimeout(id);
  }, [homeToast]);

  useEffect(() => {
    const section = homeLinksSectionRef.current;
    if (!section) return;
    if (!("IntersectionObserver" in window)) {
      setHomeLinksVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setHomeLinksVisible(true);
      observer.disconnect();
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!webConnectOpen || isInMiniAppContext || viewerProfile) return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      void loadAppSession().then((session) => {
        if (!cancelled && session.farcasterFid) applySession(session);
      }).catch(() => undefined);
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applySession, isInMiniAppContext, viewerProfile, webConnectOpen]);

  const handleWebFarcasterAuthenticated = useCallback((identity: FarcasterWebIdentity) => {
    setWebConnectIdentityError(null);
    setViewerProfile({ fid: identity.fid, username: identity.username, displayName: identity.displayName, pfpUrl: identity.pfpUrl });
    setActionSessionToken(identity.actionSessionToken);
    setWebConnectOpen(false);
  }, []);

  const handleWebFarcasterDisconnect = useCallback(async () => {
    await logoutAppPrincipal("farcaster");
    setViewerProfile(null);
    setActionSessionToken(null);
    setWebConnectIdentityError(null);
  }, []);

  const handleDisconnect = useCallback(() => {
    void disconnectWallet().then(async () => {
      await logoutAppPrincipal("all").catch(() => undefined);
      setViewerProfile(null);
      setActionSessionToken(null);
      setWebConnectIdentityError(null);
      setHomeToast({ kind: "success", message: "Connected accounts were disconnected." });
    }).catch((error) => {
      setHomeToast({ kind: "error", message: error instanceof Error ? error.message : "The account could not be disconnected." });
    });
  }, []);

  const handleEnableNotifications = useCallback(() => {
    setNotificationsOnlyPrompt(true);
    setShowAddAppPrompt(true);
  }, []);

  const handleConfirmAddAppPrompt = async () => {
    setShowAddAppPrompt(false);
    if (isLikelyBaseAppBrowser()) return;
    try {
      if (isInMiniAppContext) {
        const result = await sdk.actions.addMiniApp();
        if (!result.notificationDetails) {
          setHomeToast({ kind: "error", message: FARCASTER_NOTIFICATIONS_MANUAL_ENABLE_MESSAGE });
        }
      } else {
        await subscribeToWebPush(["announcements"]);
        setHomeToast({ kind: "success", message: "Web notifications are enabled for 10X.MEME." });
      }
    } catch (error) {
      console.error("Failed to add 10X.MEME:", error);
      const message = isInMiniAppContext && notificationsOnlyPrompt
        ? FARCASTER_NOTIFICATIONS_MANUAL_ENABLE_MESSAGE
        : error instanceof Error ? error.message : String(error);
      setActionError(message);
      setHomeToast({ kind: "error", message });
    }
  };

  const openHomeLink = async (link: HomeLink) => {
    void hapticTap();
    void hapticSelectionChanged();
    if (link.action === "warplets") {
      await sdk.actions.openMiniApp({ url: link.href });
      return;
    }
    if (link.action === "farcaster") {
      await sdk.actions.viewProfile({ fid: 1313340 });
      return;
    }
    await sdk.actions.openUrl(link.href);
  };

  return (
    <MiniAppShell>
      {!isInMiniAppContext && (
        <PwaControls
          appName="10X.MEME"
          autoPrompt={false}
          onMessage={(kind, message) => setHomeToast({ kind, message })}
        />
      )}
      {!isInMiniAppContext && (
        <WebConnectModal
          open={webConnectOpen}
          onClose={() => { setWebConnectOpen(false); setWebConnectIdentityError(null); }}
          identityError={webConnectIdentityError}
          onClearIdentityError={() => setWebConnectIdentityError(null)}
          identityConnected={Boolean(viewerProfile)}
          onWalletConnected={() => {
            void hapticSuccess();
            void loadAppSession().then(applySession).catch(() => undefined);
          }}
          farcasterControl={(
            <Suspense fallback={<button type="button" disabled>Connecting...</button>}>
              <FarcasterSignInControl
                connected={Boolean(viewerProfile)}
                onAuthenticated={handleWebFarcasterAuthenticated}
                onDisconnect={handleWebFarcasterDisconnect}
                onError={(message) => setWebConnectIdentityError(/reject|denied|cancel|closed/i.test(message) ? "Farcaster connection was cancelled." : message)}
              />
            </Suspense>
          )}
        />
      )}

      {homeToast && (
        <AppViewport className={`trade-toast ${homeToast.kind === "error" ? "trade-toast--danger" : ""}`} role="status" aria-live="polite">
          <div className="flex w-full items-center gap-3">
            <span className="min-w-0 flex-1">{homeToast.message}</span>
            <button type="button" aria-label="Close message" onClick={() => setHomeToast(null)} className="trade-toast__close">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </div>
        </AppViewport>
      )}

      {showAddAppPrompt && (
        <NotificationsPromptModal
          notificationsOnlyPrompt={notificationsOnlyPrompt}
          baseAppContext={isLikelyBaseAppBrowser()}
          onConfirm={() => void handleConfirmAddAppPrompt()}
        />
      )}

      <div className="relative z-30 w-full">
        <MiniAppHeader
          appSlug="app"
          title="10X.MEME"
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.goToCurrentRoot}
          onMenu={actions.openMenu}
          onTitleMenu={handleHeaderTitleMenuToggle}
          rightAccessory={(
            <HomeAccountControl
              isInMiniAppContext={isInMiniAppContext}
              viewerProfile={viewerProfile}
              walletAddress={walletController.session?.address ?? null}
              showInstallWebApp={!isInMiniAppContext && !isStandaloneDisplay() && !isEmbeddedWebView() && !isLikelyBaseAppBrowser()}
              open={headerAccountMenuAnchor !== null}
              centered={headerAccountMenuAnchor === "title"}
              onOpenChange={handleHeaderAccountMenuOpenChange}
              onAvatarToggle={handleHeaderAvatarMenuToggle}
              onOpen={() => setWebConnectOpen(true)}
              onEnableNotifications={handleEnableNotifications}
              onInstallWebApp={() => window.dispatchEvent(new CustomEvent("10x:open-pwa-install"))}
              onDisconnect={handleDisconnect}
            />
          )}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="app" />
        ) : (
          <main className="mx-auto w-full max-w-md px-4 pb-12 pt-6">
            <header className="text-center">
              <p className="text-lg font-black uppercase tracking-[0.18em] text-[#7959ff] drop-shadow-[0_0_5px_rgba(121,89,255,0.55)]">The 10X Thesis</p>
              <h1 className="mt-3 text-[2rem] font-black leading-[1.12] text-[#E0E3FF]">
                Crypto Doesn't Need More Tokens.
                <span className="mt-2 block text-[#00FF00]">It Needs...</span>
              </h1>
            </header>

            <div className="home-thesis-media-stack mt-7 rounded-xl shadow-[0_0_18px_rgba(0,255,0,0.12)]">
              <section className="overflow-hidden rounded-t-xl border-x border-t border-[#00FF00]/25 bg-black/75 px-3">
                <div className="aspect-square w-full">
                  <iframe
                    className="h-full w-full"
                    src="https://www.youtube.com/embed/P8tnl7sodII?controls=1"
                    title="The 10X Thesis"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
              </section>

              <EmailWaitlistCta
                actionSessionToken={actionSessionToken}
                viewerFid={viewerProfile?.fid ?? null}
                joinedToPrevious
                autoFocusEmail
              />
            </div>

            <section ref={homeLinksSectionRef} className="mt-5" aria-label="Explore 10X.MEME">
              <div className="mb-3 text-center">
                <h2 className="text-lg font-black text-[#00FF00]">Follow + Notifications ON 🔔</h2>
                <p className="mt-0.5 text-sm font-bold text-[#b8d7b8]">(so you don&apos;t miss out)</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {homeLinks().map((link, index) => (
                  <a
                    key={link.id}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.title}
                    className={`home-link-card group min-w-0 overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/70 transition hover:-translate-y-px hover:border-[#00FF00] hover:shadow-[0_0_14px_rgba(0,255,0,0.3)] ${homeLinksVisible ? "home-link-card--visible" : ""}`}
                    style={{ "--home-link-index": index } as CSSProperties}
                    onClick={(event) => {
                      if (!isInMiniAppContext) {
                        void hapticTap();
                        return;
                      }
                      event.preventDefault();
                      void openHomeLink(link).catch((error) => {
                        console.error(`Failed to open ${link.label}:`, error);
                        window.location.href = link.href;
                      });
                    }}
                  >
                    <img src={link.imageUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                    <span className="flex min-h-[34px] items-center justify-center bg-[#00FF00] px-2 py-1.5 text-center text-[0.72rem] font-bold leading-4 text-[rgb(0,80,0)]">
                      {link.label}
                    </span>
                  </a>
                ))}
              </div>
            </section>

            {actionError && (
              <div className="mt-5 rounded-xl border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs font-bold text-red-300">
                {actionError}
              </div>
            )}
          </main>
        )}
        <SiteFooter />
      </div>

    </MiniAppShell>
  );
}
