import { useEffect, useMemo, useState, type ReactNode } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";
import { hapticSelectionChanged, hapticTap } from "./haptics";

export type AppSlug = "app" | "drop" | "find" | "million";

type AppConfig = {
  slug: AppSlug;
  appName: string;
  headerTitle: string;
  ctaLabel: string;
  absoluteUrl: string;
  iconUrl: string;
  imageUrl: string;
  available: boolean;
};

type MenuCard = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  ctaLabel: string;
  kind: "miniapp" | "openUrl" | "viewProfile";
  appSlug?: AppSlug;
  disabled?: boolean;
  href?: string;
  fid?: number;
};

const APP_CONFIGS: Record<AppSlug, AppConfig> = {
  app: {
    slug: "app",
    appName: "10X",
    headerTitle: "10X Network",
    ctaLabel: "Open 10X",
    absoluteUrl: "https://app.10x.meme/",
    iconUrl: "https://app.10x.meme/icon.png",
    imageUrl: "https://app.10x.meme/hero.png",
    available: true,
  },
  drop: {
    slug: "drop",
    appName: "10X Warplets Drop",
    headerTitle: "10X Warplets Drop",
    ctaLabel: "Claim Your Warplet",
    absoluteUrl: "https://drop.10x.meme/",
    iconUrl: "https://drop.10x.meme/icon_drop.png",
    imageUrl: "https://drop.10x.meme/hero_drop.png",
    available: true,
  },
  find: {
    slug: "find",
    appName: "10X Warplet Find",
    headerTitle: "10X Warplet Find",
    ctaLabel: "Coming soon...",
    absoluteUrl: "https://find.10x.meme/",
    iconUrl: "https://app.10x.meme/icon.png",
    imageUrl: "https://app.10x.meme/embed.png",
    available: false,
  },
  million: {
    slug: "million",
    appName: "$1M Warplet",
    headerTitle: "$1M Warplet",
    ctaLabel: "Coming soon...",
    absoluteUrl: "https://million.10x.meme/",
    iconUrl: "https://app.10x.meme/icon.png",
    imageUrl: "https://app.10x.meme/embed.png",
    available: false,
  },
};

const HOSTS_BY_APP: Record<AppSlug, string[]> = {
  app: ["app.10x.meme", "app-dev.10x.meme", "app-local.10x.meme"],
  drop: ["drop.10x.meme", "drop-dev.10x.meme", "drop-local.10x.meme"],
  find: ["find.10x.meme", "find-dev.10x.meme", "find-local.10x.meme"],
  million: ["million.10x.meme", "million-dev.10x.meme", "million-local.10x.meme"],
};

type EnvTier = "local" | "dev" | "prod";

function getEnvTier(hostname: string): EnvTier {
  const h = hostname.toLowerCase();
  if (h.includes("-local.")) return "local";
  if (h.includes("-dev.")) return "dev";
  return "prod";
}

const APP_URLS: Record<AppSlug, Record<EnvTier, string>> = {
  app: {
    prod: "https://app.10x.meme/",
    dev: "https://app-dev.10x.meme/",
    local: "https://app-local.10x.meme/",
  },
  drop: {
    prod: "https://drop.10x.meme/",
    dev: "https://drop-dev.10x.meme/",
    local: "https://drop-local.10x.meme/",
  },
  find: {
    prod: "https://find.10x.meme/",
    dev: "https://find-dev.10x.meme/",
    local: "https://find-local.10x.meme/",
  },
  million: {
    prod: "https://million.10x.meme/",
    dev: "https://million-dev.10x.meme/",
    local: "https://million-local.10x.meme/",
  },
};

function getAppUrl(appSlug: AppSlug): string {
  const tier = getEnvTier(window.location.hostname);
  return APP_URLS[appSlug][tier];
}

function getAppBasePath(appSlug: AppSlug, location: Location): string {
  if (HOSTS_BY_APP[appSlug].includes(location.hostname.toLowerCase())) {
    return "/";
  }

  return appSlug === "app" ? "/" : `/${appSlug}`;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function getMenuPath(appSlug: AppSlug, location: Location): string {
  const basePath = getAppBasePath(appSlug, location);
  return basePath === "/" ? "/menu" : `${basePath}/menu`;
}

function isMenuPath(appSlug: AppSlug, location: Location): boolean {
  return normalizePath(location.pathname) === normalizePath(getMenuPath(appSlug, location));
}

function getRootPath(appSlug: AppSlug, location: Location): string {
  return normalizePath(getAppBasePath(appSlug, location));
}

type MiniAppHistoryState = {
  miniAppChrome?: {
    appSlug: AppSlug;
    depth: number;
  };
};

function getMiniAppHistoryDepth(appSlug: AppSlug): number {
  if (typeof window === "undefined") return 0;
  const state = window.history.state as MiniAppHistoryState | null;
  const miniAppState = state?.miniAppChrome;
  if (miniAppState?.appSlug !== appSlug) return 0;
  return Number.isInteger(miniAppState.depth) && miniAppState.depth > 0 ? miniAppState.depth : 0;
}

function markCurrentHistoryEntry(appSlug: AppSlug, rootPath: string, depth = 0) {
  if (typeof window === "undefined") return;
  const state = (window.history.state ?? {}) as MiniAppHistoryState;
  const isRootPath = normalizePath(window.location.pathname) === normalizePath(rootPath);
  if (state.miniAppChrome?.appSlug === appSlug && !isRootPath) return;

  window.history.replaceState(
    {
      ...state,
      miniAppChrome: {
        appSlug,
        depth,
      },
    },
    "",
    window.location.href
  );
}

function pushMiniAppRoute(appSlug: AppSlug, path: string) {
  const depth = getMiniAppHistoryDepth(appSlug) + 1;
  window.history.pushState(
    {
      ...(window.history.state ?? {}),
      miniAppChrome: {
        appSlug,
        depth,
      },
    },
    "",
    path
  );
}

function getCanGoBack(appSlug: AppSlug): boolean {
  return getMiniAppHistoryDepth(appSlug) > 0;
}

function notifyLocationChange() {
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function openApp(appSlug: AppSlug) {
  const url = getAppUrl(appSlug);

  try {
    await sdk.actions.openMiniApp({ url });
    return;
  } catch {
    window.location.href = url;
  }
}

async function runMenuCardAction(card: MenuCard) {
  if (card.disabled) return;
  void hapticTap();
  void hapticSelectionChanged();

  if (card.kind === "miniapp" && card.appSlug) {
    await openApp(card.appSlug);
    return;
  }

  if (card.kind === "viewProfile" && typeof card.fid === "number") {
    await sdk.actions.viewProfile({ fid: card.fid });
    return;
  }

  if (card.kind === "openUrl" && card.href) {
    await sdk.actions.openUrl(card.href);
  }
}


export function useMiniAppChrome(appSlug: AppSlug) {
  const [isMenuRoute, setIsMenuRoute] = useState(() => isMenuPath(appSlug, window.location));
  const [canGoBack, setCanGoBack] = useState(() => getCanGoBack(appSlug));

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const syncRouteState = () => {
      setIsMenuRoute(isMenuPath(appSlug, window.location));
      setCanGoBack(getCanGoBack(appSlug));
    };

    const initBack = async () => {
      try {
        const inMiniApp = typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;
        if (!inMiniApp) return;
        await sdk.back.enableWebNavigation();
        cleanup = () => {
          sdk.back.disableWebNavigation().catch(() => {});
        };
      } catch {
        // Ignore header back wiring outside mini app runtime.
      }
    };

    const navigation = (window as Window & {
      navigation?: {
        addEventListener?: (event: string, listener: EventListener) => void;
        removeEventListener?: (event: string, listener: EventListener) => void;
      };
    }).navigation;

    markCurrentHistoryEntry(appSlug, getRootPath(appSlug, window.location));
    syncRouteState();
    initBack();

    window.addEventListener("popstate", syncRouteState);
    navigation?.addEventListener?.("navigatesuccess", syncRouteState);

    return () => {
      window.removeEventListener("popstate", syncRouteState);
      navigation?.removeEventListener?.("navigatesuccess", syncRouteState);
      cleanup?.();
    };
  }, [appSlug]);

  const actions = useMemo(() => ({
    goBack: () => {
      if (getCanGoBack(appSlug)) {
        window.history.back();
        return;
      }

      const rootPath = getRootPath(appSlug, window.location);
      if (normalizePath(window.location.pathname) !== normalizePath(rootPath)) {
        window.history.replaceState(
          {
            ...(window.history.state ?? {}),
            miniAppChrome: {
              appSlug,
              depth: 0,
            },
          },
          "",
          rootPath
        );
        notifyLocationChange();
      }
    },
    openMenu: () => {
      const menuPath = getMenuPath(appSlug, window.location);
      if (normalizePath(window.location.pathname) === normalizePath(menuPath)) {
        if (getCanGoBack(appSlug)) {
          window.history.back();
        }
        return;
      }
      pushMiniAppRoute(appSlug, menuPath);
      notifyLocationChange();
    },
    goToCurrentRoot: () => {
      const rootPath = getRootPath(appSlug, window.location);
      if (normalizePath(window.location.pathname) === normalizePath(rootPath)) return;
      pushMiniAppRoute(appSlug, rootPath);
      notifyLocationChange();
    },
    openHubRoot: async () => {
      if (appSlug === "app") {
        const rootPath = getRootPath("app", window.location);
        if (normalizePath(window.location.pathname) !== normalizePath(rootPath)) {
          pushMiniAppRoute("app", rootPath);
          notifyLocationChange();
        }
        return;
      }

      await openApp("app");
    },
  }), [appSlug]);

  return {
    isMenuRoute,
    canGoBack,
    actions,
  };
}

function HeaderActionButton({
  label,
  ariaLabel,
  onClick,
  className,
  children,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => {
        void hapticTap();
        onClick();
      }}
      className={`header-action-button${className ? ` ${className}` : ""}`}
      title={label}
    >
      {children}
      <span className="header-sr-only">{label}</span>
    </button>
  );
}

export function MiniAppHeader({
  appSlug,
  title,
  canGoBack,
  onBack,
  onLogo,
  onMenu,
}: {
  appSlug: AppSlug;
  title: string;
  canGoBack: boolean;
  onBack: () => void;
  onLogo: () => void;
  onMenu: () => void;
}) {
  const logoLabel = appSlug === "app" ? "Open 10X home" : "Open 10X hub";

  return (
    <header id="header" className="miniapp-header">
      <div className="miniapp-header__side miniapp-header__side--left">
        {canGoBack ? (
          <HeaderActionButton
            label="Back"
            ariaLabel="Go back"
            onClick={onBack}
          >
            <svg
              className="header-icon-chevron"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M14.5 5L8 12L14.5 19"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </HeaderActionButton>
        ) : (
          <button
            type="button"
            className="miniapp-header__logo-link"
            aria-label={logoLabel}
            title={logoLabel}
            onClick={() => {
              void hapticTap();
              onLogo();
            }}
          >
            <img src="/icon.png" alt="10X" className="miniapp-header__logo" loading="eager" />
          </button>
        )}
      </div>

      <div className="miniapp-header__center">
        <div className="miniapp-header__title-wrap">
          <span className="miniapp-header__title-badge" title={title}>
            {title}
          </span>
        </div>
      </div>

      <div className="miniapp-header__side miniapp-header__side--right">
        <HeaderActionButton
          label="Menu"
          ariaLabel="Open menu"
          onClick={onMenu}
          className="header-action-button--menu"
        >
          <span className="header-icon-hamburger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </HeaderActionButton>
      </div>
    </header>
  );
}

function MenuSection({
  title,
  cards,
}: {
  title: string;
  cards: MenuCard[];
}) {
  return (
    <section className="menu-section" aria-labelledby={`menu-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <Text id={`menu-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="menu-section__title">
        {title}
      </Text>
      <div className="menu-section__grid">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`menu-card ${card.disabled ? "menu-card--disabled" : ""}`}
            onClick={() => {
              runMenuCardAction(card).catch((error) => {
                console.error(`Failed menu action for ${card.id}:`, error);
              });
            }}
            disabled={card.disabled}
            title={card.title}
          >
            <img
              src={card.imageUrl}
              alt={card.title}
              className="menu-card__image"
              loading="eager"
            />
            <div className="menu-card__body">
              <span className={`menu-card__cta ${card.disabled ? "menu-card__cta--disabled" : ""}`}>
                {card.ctaLabel}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function MiniAppMenuPage({ appSlug }: { appSlug: AppSlug }) {
  const miniAppCards: MenuCard[] = ["app", "drop"].map((slug) => {
    const config = APP_CONFIGS[slug as AppSlug];
    const isCurrent = appSlug === config.slug;
    return {
      id: `miniapp-${config.slug}`,
      title: config.appName,
      description:
        config.slug === "app"
          ? "Hub mini app for 10X Network navigation and launches."
          : config.slug === "drop"
            ? "Buy, claim, and share your Warplet inside Farcaster."
            : config.slug === "million"
              ? "Dedicated mission for the $1M Warplet campaign."
              : "Find rare Warplets faster once discovery tools go live.",
      imageUrl: config.slug === "app" ? "/menu/menu-10x-app.png" : "/menu/menu-drop-app.jpg",
      ctaLabel: isCurrent ? "You are here!" : config.slug === "drop" ? "10X Warplet Drop" : config.ctaLabel,
      kind: "miniapp",
      appSlug: config.slug,
      disabled: isCurrent || !config.available,
    } satisfies MenuCard;
  });

  const socialCards: MenuCard[] = [
    {
      id: "fc-10xmeme",
      title: "Farcaster 10X Meme",
      description: "Follow the 10X Meme account on Farcaster.",
      imageUrl: "/menu/menu-farcaster-10xmeme.jpg",
      ctaLabel: "Follow @10XMeme.eth",
      kind: "viewProfile",
      fid: 1313340,
    },
    {
      id: "fc-10xchris",
      title: "Farcaster 10X Chris",
      description: "Follow Chris on Farcaster for launches and updates.",
      imageUrl: "/menu/menu-farcaster-10xchris.jpg",
      ctaLabel: "Follow @10XChris.eth",
      kind: "viewProfile",
      fid: 1129138,
    },
    {
      id: "x-10xmeme",
      title: "Twitter 10X Meme",
      description: "Follow @10XMemeX on X.",
      imageUrl: "/menu/menu-twitter-10xmeme.jpg",
      ctaLabel: "Follow @10XMemeX",
      kind: "openUrl",
      href: "https://twitter.com/intent/follow?user_id=3275559396",
    },
    {
      id: "x-10xchris",
      title: "Twitter 10X Chris",
      description: "Follow @10XChrisX on X.",
      imageUrl: "/menu/menu-twitter-10xchris.jpg",
      ctaLabel: "Follow @10XChrisX",
      kind: "openUrl",
      href: "https://twitter.com/intent/follow?user_id=18302782",
    },
    {
      id: "fc-channel",
      title: "Farcaster Channel",
      description: "Join the 10X Meme Farcaster channel.",
      imageUrl: "/menu/menu-farcaster-channels.jpg",
      ctaLabel: "Join Farcaster Channel",
      kind: "openUrl",
      href: "https://farcaster.xyz/~/channel/10xmeme",
    },
    {
      id: "telegram",
      title: "Telegram",
      description: "Join the 10X Telegram community.",
      imageUrl: "/menu/menu-telegram-channel.jpg",
      ctaLabel: "Join Telegram Channel",
      kind: "openUrl",
      href: "https://t.me/X10XMeme",
    },
  ];

  const linkCards: MenuCard[] = [
    {
      id: "opensea-10x",
      title: "OpenSea 10X Warplets",
      description: "View the 10X Warplets collection on OpenSea.",
      imageUrl: "/menu/menu-opensea-10xwarplets.jpg",
      ctaLabel: "OpenSea 10X Warplets",
      kind: "openUrl",
      href: "https://link.10x.meme/10xwarplets",
    },
    {
      id: "opensea-1m",
      title: "OpenSea $1M Warplet",
      description: "View the $1M Warplet collection on OpenSea.",
      imageUrl: "/menu/menu-opensea-1mwarplet.jpg",
      ctaLabel: "OpenSea $1M Warplet",
      kind: "openUrl",
      href: "https://link.10x.meme/1mwarplet",
    },
    {
      id: "site-10x",
      title: "10X Website",
      description: "Visit the main 10X website.",
      imageUrl: "/menu/menu-10x-website.png",
      ctaLabel: "Visit 10x.meme",
      kind: "openUrl",
      href: "https://10x.meme/",
    },
    {
      id: "site-warplets",
      title: "The Warplets (Original)",
      description: "Visit the original Warplets project by @SayAngel.",
      imageUrl: "/menu/menu-warplets-website.jpg",
      ctaLabel: "Visit warplets.ai",
      kind: "openUrl",
      href: "https://www.warplets.ai/",
    },
  ];

  return (
    <div className="miniapp-menu-page">
      <MenuSection title="Mini Apps" cards={miniAppCards} />
      <MenuSection title="Social" cards={socialCards} />
      <MenuSection title="Links" cards={linkCards} />
    </div>
  );
}

export function getHeaderTitle(appSlug: AppSlug, isMenuRoute: boolean): string {
  return isMenuRoute ? "Menu" : APP_CONFIGS[appSlug].headerTitle;
}
