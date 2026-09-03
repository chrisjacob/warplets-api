const FC_MINIAPP_META_REGEX = /<meta\s+name="fc:miniapp"[^>]*>/i;
const FC_FRAME_META_REGEX = /<meta\s+name="fc:frame"[^>]*>/i;
const TITLE_REGEX = /<title>[\s\S]*?<\/title>/i;
const MANIFEST_LINK_REGEX = /<link\s+rel="manifest"[^>]*>/i;
const CANONICAL_LINK_REGEX = /<link\s+rel="canonical"[^>]*>/i;
const FAVICON_LINKS_REGEX = /<link\s+rel="icon"[^>]*>\s*(?:<link\s+rel="shortcut icon"[^>]*>\s*)?/i;
const APPLE_TOUCH_ICON_LINK_REGEX = /<link\s+rel="apple-touch-icon"[^>]*>/i;
const APPLICATION_NAME_META_REGEX = /<meta\s+name="application-name"[^>]*>/i;
const APPLE_APP_TITLE_META_REGEX = /<meta\s+name="apple-mobile-web-app-title"[^>]*>/i;
const BASE_APP_ID_META_REGEX = /<meta\s+name="base:app_id"[^>]*>/i;
import { applySecurityHeaders } from "./_lib/security.js";
import { resolveStatsFriendFilterFid } from "./_lib/stats.js";
import {
  ensureStatsShareSnapshot,
  loadLatestStatsShareSnapshotByLaunchPath,
  loadStatsShareSnapshot,
  renderStatsShareOgImage,
  type StatsSharesEnv,
} from "./_lib/statsShares.js";
import {
  STATS_SHARE_OG_HEIGHT,
  STATS_SHARE_OG_WIDTH,
  getStatsShareRequestFromLaunchUrl,
  type StatsShareSnapshot,
} from "../src/statsShare.js";
import { getPerksShareContentFromPath, getPerksShareImageUrl } from "../src/perksShareContent.js";
import {
  WARPLETS_APP_HOSTS,
  WARPLETS_APP_PATH,
  WARPLETS_PUBLIC_NAME,
  isWarpletsAppHostname,
} from "../shared/warpletsApp.js";
import {
  STONKLETS_APP_HOSTS,
  STONKLETS_APP_PATH,
  STONKLETS_PUBLIC_NAME,
  isStonkletsAppHostname,
} from "../shared/stonkletsApp.js";
import { APP_FAVICONS, buildFaviconLinks, getHostnameFaviconKey } from "../shared/favicons.js";
import { getTwitterCardImageUrl } from "../shared/twitterCardImage.js";

type PagesEnv = StatsSharesEnv & {
  ASSETS: Fetcher;
  WARPLETS_ACCOUNT_ASSOCIATION_JSON?: string;
  STONKLETS_ACCOUNT_ASSOCIATION_JSON?: string;
};

const DROP_SHARE_TITLE = "10X Warplets (10K NFT Drop)";
const DROP_SHARE_DESCRIPTION =
  "10X Warplets airdropped to 10,000 diamond hands.";
const DEFAULT_DROP_SHARE_IMAGE_URL = "https://warplets.10x.meme/1391.gif";
const DROP_ICON_URL = "https://drop.10x.meme/icon_drop2.png";
const DROP_SPLASH_URL = "https://drop.10x.meme/splash_drop2.png";
const DROP_EMBED_URL = "https://drop.10x.meme/embed_drop2.png";
const DROP_HERO_URL = "https://drop.10x.meme/hero_drop2.png";
const DROP_SPLASH_BACKGROUND_COLOR = "#849fa6";
const WARPLETS_SHARE_TITLE = WARPLETS_PUBLIC_NAME;
const WARPLETS_SHARE_DESCRIPTION = "Search, filter, trade, favourite, and share 10X Warplets.";
const WARPLETS_SPLASH_BACKGROUND_COLOR = "#004100";
const STONKLETS_SHARE_TITLE = STONKLETS_PUBLIC_NAME;
const STONKLETS_SHARE_DESCRIPTION = "Track paired bStocks and vote for the Stonklets you want launched first.";
const STONKLETS_SPLASH_BACKGROUND_COLOR = "#001400";
export const APP_SHARE_TITLE = "10X.MEME 🟢 You're Just One Trade Away...";
export const APP_SHARE_DESCRIPTION = "10X Memes, RWAs, NFTs, AI, Attention & Alpha.";
export const APP_MINIAPP_TITLE = "You're Just One Trade Away...";
export const APP_MINIAPP_DESCRIPTION = "10X Memes, RWAs, NFTs, AI, Attention and Alpha.";
const STOP_SHARE_TITLE = "@Mention Settings";
const STOP_SHARE_DESCRIPTION = "Opt out of 10X outreach mentions in the Farcaster Mini App.";
const STOP_IMAGE_URL = "https://warplets.10x.meme/3081.png";
const BASE_APP_IDS: Readonly<Record<string, string>> = {
  "app.10x.meme": "6a8e3af7164a4b20f8b98f3a",
  "warplet.10x.meme": "6a8dba294f7ceaca3bfa774f",
};

const APP_ASSOCIATION = {
  header:
    "eyJmaWQiOjExMjkxMzgsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg0NzA5YTRCMTJEQWYwZUVEYUUwZWY0OEEyOGEwNTY2NDBEZWUwODQ2In0",
  payload: "eyJkb21haW4iOiJhcHAuMTB4Lm1lbWUifQ",
  signature:
    "JstfeHToe/7YhAoEZbwRmzOcwWnH5F1muSdJ+n4q0fB4JrJOtwN61xpIszl2XzbC9bQZd8+oOnUI2CchshE9XRs=",
};

const DROP_ASSOCIATION = {
  header:
    "eyJmaWQiOjExMjkxMzgsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg0NzA5YTRCMTJEQWYwZUVEYUUwZWY0OEEyOGEwNTY2NDBEZWUwODQ2In0",
  payload: "eyJkb21haW4iOiJkcm9wLjEweC5tZW1lIn0",
  signature: "EYVGQ7agQ+KoXvdu9vu4zsrEXk97yRwrMIeeVr9DqW11L748hmLKwCRMLL91N8nFOZRPQHr4dcQ52HM0Ds9yixw=",
};

type AccountAssociation = {
  header: string;
  payload: string;
  signature: string;
};

function parseAccountAssociation(rawValue: string | undefined, hostname: string): AccountAssociation | null {
  const raw = rawValue?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AccountAssociation>;
    if (!parsed.header || !parsed.payload || !parsed.signature) return null;
    const paddedPayload = parsed.payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parsed.payload.length / 4) * 4, "=");
    const associationPayload = JSON.parse(atob(paddedPayload)) as { domain?: unknown };
    if (associationPayload.domain !== hostname) return null;
    return parsed as AccountAssociation;
  } catch {
    return null;
  }
}

function parseWarpletsAccountAssociation(env: PagesEnv, hostname: string): AccountAssociation | null {
  return parseAccountAssociation(env.WARPLETS_ACCOUNT_ASSOCIATION_JSON, hostname);
}

export function buildFarcasterManifest(hostname: string, warpletsAssociation?: AccountAssociation | null, stonkletsAssociation?: AccountAssociation | null) {
  if (hostname === "drop.10x.meme" || hostname === "drop-dev.10x.meme") {
    return {
      accountAssociation: DROP_ASSOCIATION,
      miniapp: {
        version: "1",
        name: "10X Warplets Drop",
        canonicalDomain: hostname,
        homeUrl: `https://${hostname}`,
        iconUrl: DROP_ICON_URL,
        imageUrl: DROP_EMBED_URL,
        heroImageUrl: DROP_HERO_URL,
        buttonTitle: "Drop Has Finished",
        splashImageUrl: DROP_SPLASH_URL,
        splashBackgroundColor: DROP_SPLASH_BACKGROUND_COLOR,
        webhookUrl: "https://app.10x.meme/webhook/drop",
        castShareUrl: `https://${hostname}`,
        subtitle: "Did you get the free airdrop?",
        description: DROP_SHARE_DESCRIPTION,
        primaryCategory: "social",
        screenshotUrls: [
          "https://drop.10x.meme/screenshots/drop_1.jpg",
        ],
        tags: ["10x", "warplets", "farcaster", "nft", "drop"],
        tagline: "Take the green pill.",
        ogTitle: DROP_SHARE_TITLE,
        ogDescription: DROP_SHARE_DESCRIPTION,
        ogImageUrl: DEFAULT_DROP_SHARE_IMAGE_URL,
      },
    };
  }

  if (isWarpletsAppHostname(hostname)) {
    return {
      ...(warpletsAssociation
        ? { accountAssociation: warpletsAssociation }
        : {}),
      miniapp: {
        version: "1",
        name: WARPLETS_PUBLIC_NAME,
        canonicalDomain: hostname,
        homeUrl: `https://${hostname}`,
        iconUrl: `https://${hostname}/icon_search.png`,
        imageUrl: `https://${hostname}/embed_search.png`,
        heroImageUrl: `https://${hostname}/hero_search.png`,
        buttonTitle: "Open 10X Warplets",
        splashImageUrl: `https://${hostname}/splash_search.png`,
        splashBackgroundColor: WARPLETS_SPLASH_BACKGROUND_COLOR,
        webhookUrl: `https://${hostname}/webhook/warplets`,
        castShareUrl: `https://${hostname}`,
        subtitle: "Find your Warplet.",
        description: WARPLETS_SHARE_DESCRIPTION,
        primaryCategory: "social",
        screenshotUrls: [
          `https://${hostname}/screenshots/search_1.jpg`,
          `https://${hostname}/screenshots/search_2.jpg`,
          `https://${hostname}/screenshots/search_3.jpg`,
        ],
        tags: ["10x", "warplets", "farcaster", "nft", "search"],
        tagline: "Take the green pill.",
        ogTitle: WARPLETS_SHARE_TITLE,
        ogDescription: WARPLETS_SHARE_DESCRIPTION,
        ogImageUrl: `https://${hostname}/hero_search.png`,
      },
    };
  }

  if (isStonkletsAppHostname(hostname)) {
    return {
      ...(stonkletsAssociation ? { accountAssociation: stonkletsAssociation } : {}),
      miniapp: {
        version: "1",
        name: STONKLETS_PUBLIC_NAME,
        canonicalDomain: hostname,
        homeUrl: `https://${hostname}`,
        iconUrl: `https://${hostname}/stonklets/chip.png`,
        imageUrl: `https://${hostname}/stonklets/chip.png`,
        heroImageUrl: `https://${hostname}/stonklets/chip.png`,
        buttonTitle: "Open 10X Stonklets",
        splashImageUrl: `https://${hostname}/stonklets/chip.png`,
        splashBackgroundColor: STONKLETS_SPLASH_BACKGROUND_COLOR,
        webhookUrl: `https://${hostname}/webhook/stonklets`,
        castShareUrl: `https://${hostname}`,
        subtitle: "Vote for the next launch.",
        description: STONKLETS_SHARE_DESCRIPTION,
        primaryCategory: "finance",
        screenshotUrls: [`https://${hostname}/stonklets/chip.png`],
        tags: ["10x", "stonklets", "bnb", "rwa", "memecoins"],
        tagline: "Real assets. Unreal characters.",
        ogTitle: STONKLETS_SHARE_TITLE,
        ogDescription: STONKLETS_SHARE_DESCRIPTION,
        ogImageUrl: `https://${hostname}/stonklets/chip.png`,
      },
    };
  }

  return {
    accountAssociation: APP_ASSOCIATION,
    miniapp: {
      version: "1",
      name: "10X",
      canonicalDomain: "app.10x.meme",
      homeUrl: "https://app.10x.meme",
      iconUrl: "https://app.10x.meme/icon.png",
      imageUrl: "https://app.10x.meme/embed.png",
      heroImageUrl: "https://app.10x.meme/hero.png",
      buttonTitle: "Open 10X",
      splashImageUrl: "https://app.10x.meme/splash.png",
      splashBackgroundColor: "#000000",
      webhookUrl: "https://app.10x.meme/webhook/app",
      castShareUrl: "https://app.10x.meme",
      subtitle: "Don't miss out.",
      description: APP_MINIAPP_DESCRIPTION,
      primaryCategory: "social",
      screenshotUrls: [
        "https://app.10x.meme/screenshots/app_1v2.jpg",
      ],
      tags: ["10x", "warplets", "farcaster", "nft", "memecoins"],
      tagline: "Don't miss out.",
      ogTitle: APP_MINIAPP_TITLE,
      ogDescription: APP_MINIAPP_DESCRIPTION,
      ogImageUrl: "https://app.10x.meme/embed.png",
    },
  };
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeBase(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

type RouteKey = "root" | "drop" | "warplets" | "stonklets" | "million" | "stop" | "unsubscribe";

function matchesHost(hostname: string, ...candidates: string[]): boolean {
  return candidates.includes(hostname);
}

function getRouteKey(hostname: string, pathname: string): RouteKey {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  if (matchesHost(hostname, "drop.10x.meme", "drop-dev.10x.meme", "drop-local.10x.meme")) return "drop";
  if (isWarpletsAppHostname(hostname)) return "warplets";
  if (isStonkletsAppHostname(hostname)) return "stonklets";
  if (matchesHost(hostname, "million.10x.meme", "million-dev.10x.meme", "million-local.10x.meme")) return "million";
  if (cleanPath === "/drop" || cleanPath.startsWith("/drop/")) return "drop";
  if (cleanPath === WARPLETS_APP_PATH || cleanPath.startsWith(`${WARPLETS_APP_PATH}/`)) return "warplets";
  if (cleanPath === STONKLETS_APP_PATH || cleanPath.startsWith(`${STONKLETS_APP_PATH}/`)) return "stonklets";
  if (cleanPath === "/million" || cleanPath.startsWith("/million/")) return "million";
  if (cleanPath === "/stop" || cleanPath.startsWith("/stop/")) return "stop";
  if (cleanPath === "/unsubscribe" || cleanPath.startsWith("/unsubscribe/")) return "unsubscribe";
  return "root";
}

function getMiniAppConfig(routeKey: RouteKey): { title: string; name: string; path: string } {
  if (routeKey === "drop") {
    return {
      title: "Open 10X Warplets Drop",
      name: "10X Warplets Drop",
      path: "/drop",
    };
  }

  if (routeKey === "warplets") {
    return {
      title: "Open 10X Warplets",
      name: WARPLETS_PUBLIC_NAME,
      path: WARPLETS_APP_PATH,
    };
  }
  if (routeKey === "stonklets") {
    return { title: "Open 10X Stonklets", name: STONKLETS_PUBLIC_NAME, path: STONKLETS_APP_PATH };
  }

  if (routeKey === "million") {
    return {
      title: "Open $1M Warplet",
      name: "$1M Warplet",
      path: "/million",
    };
  }

  if (routeKey === "stop") {
    return {
      title: "Open 10X",
      name: "10X",
      path: "/stop",
    };
  }

  if (routeKey === "unsubscribe") {
    return {
      title: "Open 10X",
      name: "10X",
      path: "/unsubscribe",
    };
  }

  return {
    title: "Open 10X",
    name: "10X",
    path: "/",
  };
}

function getReferralFid(searchParams: URLSearchParams): number | undefined {
  const rawFid = searchParams.get("fid")?.trim();
  if (!rawFid || !/^\d+$/.test(rawFid)) return undefined;

  const fid = Number.parseInt(rawFid, 10);
  return Number.isSafeInteger(fid) && fid > 0 ? fid : undefined;
}

function getWarpletTokenId(searchParams: URLSearchParams): number | undefined {
  const rawTokenId = (searchParams.get("warplet") ?? searchParams.get("tokenId"))?.trim();
  if (!rawTokenId || !/^\d+$/.test(rawTokenId)) return undefined;

  const tokenId = Number.parseInt(rawTokenId, 10);
  return Number.isSafeInteger(tokenId) && tokenId > 0 ? tokenId : undefined;
}

export function buildCanonicalUrl(requestUrl: URL): string {
  const canonicalUrl = new URL(requestUrl.origin);
  canonicalUrl.pathname = requestUrl.pathname === "/"
    ? "/"
    : requestUrl.pathname.replace(/\/+$/, "");

  if (getRouteKey(requestUrl.hostname, requestUrl.pathname) === "warplets") {
    const tokenId = getWarpletTokenId(requestUrl.searchParams);
    if (tokenId) canonicalUrl.searchParams.set("warplet", String(tokenId));
    if (canonicalUrl.pathname === "/stats/holders/top10friends") {
      const fid = getReferralFid(requestUrl.searchParams);
      const wallet = requestUrl.searchParams.get("wallet")?.trim().toLowerCase();
      if (fid) canonicalUrl.searchParams.set("fid", String(fid));
      else if (wallet && /^0x[a-f0-9]{40}$/.test(wallet)) canonicalUrl.searchParams.set("wallet", wallet);
    }
  }
  if (getRouteKey(requestUrl.hostname, requestUrl.pathname) === "stonklets") {
    for (const key of ["q", "market", "order", "dir", "change", "layout", "favourites", "pair", "asset"]) {
      const value = requestUrl.searchParams.get(key)?.trim();
      if (value && value.length <= 100) canonicalUrl.searchParams.set(key, value);
    }
  }

  return canonicalUrl.href;
}

export function getPublicPageRequestUrl(request: Request): URL {
  const current = new URL(request.url);
  const forwardedOrigin = request.headers.get("x-10x-public-origin")?.trim();
  if (current.protocol !== "http:" || (!isWarpletsAppHostname(current.hostname) && !isStonkletsAppHostname(current.hostname))) {
    return current;
  }
  const forwardedProto = request.headers.get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") {
    current.protocol = "https:";
    return current;
  }
  if (!forwardedOrigin) return current;
  try {
    const candidate = new URL(forwardedOrigin);
    if (candidate.protocol !== "https:" || candidate.hostname !== current.hostname) return current;
    return new URL(`${current.pathname}${current.search}`, candidate.origin);
  } catch {
    return current;
  }
}

const VITE_REACT_PREAMBLE = `<script type="module">
import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
</script>`;

export function injectLocalViteReactPreamble(html: string, hostname: string): string {
  if (
    hostname.toLowerCase() !== WARPLETS_APP_HOSTS[0]
    && hostname.toLowerCase() !== STONKLETS_APP_HOSTS[0]
    || !html.includes('<script type="module" src="/src/main.tsx"></script>')
    || html.includes('from "/@react-refresh"')
  ) {
    return html;
  }
  return html.replace("</head>", `  ${VITE_REACT_PREAMBLE}\n  </head>`);
}

export function getBaseAppId(hostname: string): string | null {
  return BASE_APP_IDS[hostname.toLowerCase()] ?? null;
}

function getFirstWarpletTokenId(searchParams: URLSearchParams): number | undefined {
  const rawTokenId = (searchParams.get("first") ?? searchParams.get("First"))?.trim();
  if (!rawTokenId || !/^\d+$/.test(rawTokenId)) return undefined;

  const tokenId = Number.parseInt(rawTokenId, 10);
  return Number.isSafeInteger(tokenId) && tokenId > 0 ? tokenId : undefined;
}

function getSearchResultsShareTitle(searchParams: URLSearchParams): string | undefined {
  if (!getFirstWarpletTokenId(searchParams)) return undefined;

  const rawCount = searchParams.get("count")?.trim();
  const count = rawCount && /^\d+$/.test(rawCount) ? Number.parseInt(rawCount, 10) : undefined;
  const countText = count && Number.isSafeInteger(count) && count > 0
    ? count.toLocaleString("en-US")
    : undefined;
  const label = (
    searchParams.get("search") ??
    searchParams.get("q") ??
    searchParams.get("random") ??
    "Filtered"
  ).trim() || "Filtered";

  return countText ? `${countText} ${label} Warplets...` : `${label} Warplets...`;
}

function getDropShareImageUrl(): string {
  return DEFAULT_DROP_SHARE_IMAGE_URL;
}

function getLaunchPath(routeKey: RouteKey, hostname: string): string {
  if (
    matchesHost(
      hostname,
      "drop.10x.meme",
      "drop-dev.10x.meme",
      "drop-local.10x.meme",
      ...WARPLETS_APP_HOSTS,
      ...STONKLETS_APP_HOSTS,
      "million.10x.meme",
      "million-dev.10x.meme",
      "million-local.10x.meme"
    )
  ) {
    return "/";
  }

  if (routeKey === "drop") return "/drop";
  if (routeKey === "warplets") return WARPLETS_APP_PATH;
  if (routeKey === "stonklets") return STONKLETS_APP_PATH;
  if (routeKey === "million") return "/million";
  if (routeKey === "stop") return "/stop";
  if (routeKey === "unsubscribe") return "/unsubscribe";
  return "/";
}

function buildMiniAppMetaContent(
  origin: string,
  pathname: string,
  search: string,
  imageUrl?: string,
  buttonTitle?: string,
  actionName?: string,
  actionUrl?: string,
): string {
  const base = normalizeBase(origin);
  const hostname = new URL(origin).hostname;
  const routeKey = getRouteKey(hostname, pathname);
  const config = getMiniAppConfig(routeKey);
  const launchPath = getLaunchPath(routeKey, hostname);
  const launchBase = launchPath === "/" ? `${base}/` : `${base}${launchPath}`;
  const launchUrl = actionUrl ?? `${launchBase}${search}`;
  const splashImageUrl = routeKey === "drop"
    ? `${base}/splash_drop2.png`
    : routeKey === "warplets"
      ? `${base}/splash_search.png`
      : routeKey === "stonklets"
        ? `${base}/stonklets/chip.png`
      : `${base}/splash.png`;
  const defaultEmbedImageUrl = routeKey === "warplets"
    ? `${base}/embed_search.png`
    : routeKey === "stonklets"
      ? `${base}/stonklets/chip.png`
      : `${base}/embed.png`;

  return JSON.stringify({
    version: "1",
    imageUrl: imageUrl ?? defaultEmbedImageUrl,
    button: {
      title: buttonTitle ?? config.title,
      action: {
        type: "launch_miniapp",
        name: actionName ?? config.name,
        url: launchUrl,
        splashImageUrl,
        splashBackgroundColor: routeKey === "drop"
          ? DROP_SPLASH_BACKGROUND_COLOR
          : routeKey === "warplets"
            ? WARPLETS_SPLASH_BACKGROUND_COLOR
            : routeKey === "stonklets"
              ? STONKLETS_SPLASH_BACKGROUND_COLOR
            : "#000000",
      },
    },
  });
}

function buildDropOpenGraphTags(imageUrl: string, pageUrl: string): string {
  const title = escapeHtmlAttr(DROP_SHARE_TITLE);
  const description = escapeHtmlAttr(DROP_SHARE_DESCRIPTION);
  const image = escapeHtmlAttr(imageUrl);
  const twitterImage = escapeHtmlAttr(getTwitterCardImageUrl(imageUrl));
  const url = escapeHtmlAttr(pageUrl);
  const logo = escapeHtmlAttr(DROP_ICON_URL);

  return [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:logo" content="${logo}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${twitterImage}" />`,
  ].join("\n  ");
}

function buildAppOpenGraphTags(pageUrl: string): string {
  const title = escapeHtmlAttr(APP_SHARE_TITLE);
  const description = escapeHtmlAttr(APP_SHARE_DESCRIPTION);
  const image = escapeHtmlAttr("https://app.10x.meme/embed.png");
  const twitterImage = escapeHtmlAttr(getTwitterCardImageUrl("https://app.10x.meme/embed.png"));
  const url = escapeHtmlAttr(pageUrl);

  return [
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${twitterImage}" />`,
  ].join("\n  ");
}

function buildStopOpenGraphTags(pageUrl: string): string {
  const title = escapeHtmlAttr(STOP_SHARE_TITLE);
  const description = escapeHtmlAttr(STOP_SHARE_DESCRIPTION);
  const image = escapeHtmlAttr(STOP_IMAGE_URL);
  const twitterImage = escapeHtmlAttr(getTwitterCardImageUrl(STOP_IMAGE_URL));
  const url = escapeHtmlAttr(pageUrl);

  return [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${twitterImage}" />`,
  ].join("\n  ");
}

function buildSearchOpenGraphTags(titleText: string, imageUrl: string, pageUrl: string, descriptionText = "Search, filter, and share 10X Warplets."): string {
  const title = escapeHtmlAttr(titleText);
  const description = escapeHtmlAttr(descriptionText);
  const image = escapeHtmlAttr(imageUrl);
  const twitterImage = escapeHtmlAttr(getTwitterCardImageUrl(imageUrl));
  const url = escapeHtmlAttr(pageUrl);

  return [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${twitterImage}" />`,
  ].join("\n  ");
}

function buildStatsShareOpenGraphTags(titleText: string, descriptionText: string, imageUrl: string, pageUrl: string): string {
  const title = escapeHtmlAttr(titleText);
  const description = escapeHtmlAttr(descriptionText);
  const image = escapeHtmlAttr(imageUrl);
  const twitterImage = escapeHtmlAttr(getTwitterCardImageUrl(imageUrl));
  const url = escapeHtmlAttr(pageUrl);
  return [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta property="og:image:width" content="${STATS_SHARE_OG_WIDTH}" />`,
    `<meta property="og:image:height" content="${STATS_SHARE_OG_HEIGHT}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${twitterImage}" />`,
  ].join("\n  ");
}

export function getStatsLaunchLookupPath(url: URL): string | null {
  if (/^\/stats\/(?:overview\/(?:collection|launch)|market\/(?:7d|30d|90d|1y|all)(?:\/(?:price|floor-price|volume|listings|offers|sales))?|activity\/(?:7d|30d|90d|1y|all)\/(?:sales|listings|offers|sends)|holders(?:\/top10|\/top10friends)?)\/?$/i.test(url.pathname)) {
    const path = url.pathname.replace(/\/$/, "") || "/";
    const wallet = url.searchParams.get("wallet")?.trim().toLowerCase();
    const validWallet = wallet && /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
    if (path === "/stats/holders/top10friends") {
      const fid = getReferralFid(url.searchParams);
      if (fid) return `${path}?fid=${fid}`;
      return validWallet ? `${path}?wallet=${validWallet}` : path;
    }
    return path === "/stats/holders" && validWallet ? `${path}?wallet=${validWallet}` : path;
  }
  const tokenId = url.searchParams.get("warplet")?.trim();
  const range = url.searchParams.get("range")?.trim();
  const event = url.searchParams.get("event")?.trim();
  if (url.pathname === "/" && url.searchParams.get("activity") === "1" && tokenId && /^\d+$/.test(tokenId)
    && /^(7d|30d|90d|1y|all)$/.test(range ?? "") && /^(sale|listing|offer|send)$/.test(event ?? "")) {
    return `/?warplet=${tokenId}&activity=1&range=${range}&event=${event}`;
  }
  return null;
}

function getStatsDeepLinkButtonTitle(url: URL): string | null {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/stats/overview/collection") return "View NFT Collection Stats";
  if (path === "/stats/overview/launch") return "View Fair Launch Stats";

  const market = path.match(/^\/stats\/market\/(?:7d|30d|90d|1y|all)(?:\/([^/]+))?$/i);
  if (market) {
    const labels: Readonly<Record<string, string>> = {
      price: "Price",
      "floor-price": "Floor Price",
      volume: "Volume",
      listings: "Listings",
      offers: "Offers",
      sales: "Sales",
    };
    return market[1] ? `View ${labels[market[1].toLowerCase()] ?? "Market Stats"}` : "View All Market Stats";
  }

  if (/^\/stats\/activity\/(?:7d|30d|90d|1y|all)\/(?:sales|listings|offers|sends)$/i.test(path)) {
    return "View Activity";
  }
  if (path === "/stats/holders") return "View Your Rank";
  if (path === "/stats/holders/top10") return "View Top 10 Holders";
  if (path === "/stats/holders/top10friends") return "View Top 10 Friends";

  const tokenId = url.searchParams.get("warplet")?.trim();
  if (path === "/" && url.searchParams.get("activity") === "1" && tokenId && /^\d+$/.test(tokenId)) {
    return `View Item #${tokenId} Activity`;
  }
  return null;
}

function getViewButtonTitle(title: string): string {
  const normalized = title.trim();
  return /^Share(?:\s|$)/i.test(normalized)
    ? normalized.replace(/^Share/i, "View")
    : `View ${normalized}`;
}

function getStatsSnapshotIdentity(snapshot: StatsShareSnapshot): string | null {
  if (!snapshot.data || typeof snapshot.data !== "object" || Array.isArray(snapshot.data)) return null;
  const data = snapshot.data as Record<string, unknown>;
  const candidate = snapshot.kind === "holder-rank" ? data.row : data.viewer;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const row = candidate as Record<string, unknown>;
  for (const username of [row.username, row.xUsername]) {
    if (typeof username === "string" && username.trim()) return `@${username.trim().replace(/^@/, "")}`;
  }
  if (typeof row.displayName === "string" && row.displayName.trim()) return row.displayName.trim();
  if (typeof row.wallet === "string" && row.wallet.length > 12) return `${row.wallet.slice(0, 6)}...${row.wallet.slice(-4)}`;
  return null;
}

function getStatsSnapshotMeta(snapshot: StatsShareSnapshot): { title: string; description: string } {
  const identity = getStatsSnapshotIdentity(snapshot);
  const title = snapshot.kind === "holder-rank" && identity
    ? `${identity}'s 10X Warplets Holder Rank`
    : snapshot.kind === "holders-top10-friends" && identity
      ? `${identity}'s Top Ranked Warplet Friends`
      : snapshot.kind === "holders-top10"
        ? "10X Warplets Top 10 Holders"
        : snapshot.farcasterText.split("\n")[0] || snapshot.title;
  return {
    title,
    description: snapshot.twitterText.replace(/\s+/g, " ").trim(),
  };
}

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const requestUrl = getPublicPageRequestUrl(context.request);

  if (requestUrl.pathname === "/favicon.ico") {
    const favicon = APP_FAVICONS[getHostnameFaviconKey(requestUrl.hostname)];
    const assetResponse = await context.env.ASSETS.fetch(new Request(
      new URL(favicon.ico, requestUrl.origin),
      context.request,
    ));
    const headers = new Headers(assetResponse.headers);
    headers.set("cache-control", "public, max-age=14400, must-revalidate");
    headers.set("content-type", "image/x-icon");
    headers.set("x-content-type-options", "nosniff");
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  }

  if (requestUrl.pathname === "/.well-known/farcaster.json") {
    const manifest = buildFarcasterManifest(
      requestUrl.hostname,
      parseWarpletsAccountAssociation(context.env, requestUrl.hostname),
      parseAccountAssociation(context.env.STONKLETS_ACCOUNT_ASSOCIATION_JSON, requestUrl.hostname),
    );
    return applySecurityHeaders(Response.json(manifest, {
      headers: {
        "cache-control": "no-store",
      },
    }));
  }

  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return applySecurityHeaders(response);
  }

  const routeKey = getRouteKey(requestUrl.hostname, requestUrl.pathname);
  const statsShareId = requestUrl.pathname.match(/^\/stats\/share\/([a-f0-9]{32})\/?$/)?.[1];
  const versionedStatsShareId = requestUrl.searchParams.get("snapshot")?.trim().toLowerCase();
  const validVersionedStatsShareId = versionedStatsShareId && /^[a-f0-9]{32}$/.test(versionedStatsShareId)
    ? versionedStatsShareId
    : null;
  const statsLaunchLookupPath = getStatsLaunchLookupPath(requestUrl);
  let statsShareSnapshot = context.env.WARPLETS
    ? statsShareId
      ? await loadStatsShareSnapshot(context.env.WARPLETS, statsShareId).catch(() => null)
      : validVersionedStatsShareId
        ? await loadStatsShareSnapshot(context.env.WARPLETS, validVersionedStatsShareId).catch(() => null)
      : statsLaunchLookupPath
        ? await loadLatestStatsShareSnapshotByLaunchPath(context.env.WARPLETS, statsLaunchLookupPath).catch(() => null)
        : null
    : null;
  if (
    validVersionedStatsShareId
    && statsShareSnapshot
    && statsLaunchLookupPath !== getStatsLaunchLookupPath(new URL(statsShareSnapshot.launchPath, requestUrl.origin))
  ) {
    statsShareSnapshot = null;
  }
  if (
    !statsShareSnapshot
    && routeKey === "warplets"
    && statsLaunchLookupPath
    && context.env.WARPLETS
    && context.env.STATS_SHARE_BROWSER
    && context.env.STATS_SHARE_IMAGES
  ) {
    try {
      const wallet = requestUrl.searchParams.get("wallet")?.trim().toLowerCase();
      const isFriendLeaderboard = requestUrl.pathname.replace(/\/+$/, "") === "/stats/holders/top10friends";
      const launchFid = isFriendLeaderboard ? getReferralFid(requestUrl.searchParams) : undefined;
      const friendFilterFid = launchFid ?? (
        isFriendLeaderboard && wallet && /^0x[a-f0-9]{40}$/.test(wallet)
          ? await resolveStatsFriendFilterFid(context.env.WARPLETS, wallet)
          : null
      );
      const statsShareRequest = getStatsShareRequestFromLaunchUrl(requestUrl, friendFilterFid);
      if (statsShareRequest) {
        const generated = await ensureStatsShareSnapshot(
          context as EventContext<StatsSharesEnv, string, unknown>,
          statsShareRequest,
        );
        if (generated.renderError) {
          console.error("stats_share_metadata_render_failed", {
            launchPath: statsLaunchLookupPath,
            error: generated.renderError,
          });
        } else {
          statsShareSnapshot = generated.snapshot;
        }
      }
    } catch (error) {
      console.error("stats_share_metadata_generation_failed", {
        launchPath: statsLaunchLookupPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  let statsShareOgReady = false;
  if (statsShareSnapshot?.imageReady && context.env.STATS_SHARE_IMAGES) {
    const ogRenderError = await renderStatsShareOgImage(
      context as EventContext<StatsSharesEnv, string, unknown>,
      statsShareSnapshot,
    );
    if (ogRenderError) {
      console.error("stats_share_og_render_failed", {
        launchPath: statsShareSnapshot.launchPath,
        error: ogRenderError,
      });
    } else {
      statsShareOgReady = true;
    }
  }
  const statsShareOgImageUrl = statsShareSnapshot?.imageReady && statsShareOgReady
    ? `${requestUrl.origin}/api/stats/share-images/${statsShareSnapshot.id}/og`
    : undefined;
  const searchWarpletTokenId = routeKey === "warplets" ? getWarpletTokenId(requestUrl.searchParams) : undefined;
  const searchFirstWarpletTokenId =
    routeKey === "warplets" && !searchWarpletTokenId ? getFirstWarpletTokenId(requestUrl.searchParams) : undefined;
  const searchWarpletTitle = searchWarpletTokenId ? `10X Warplet #${searchWarpletTokenId}` : undefined;
  const requestedWarpmojiEmoji = requestUrl.searchParams.get("emoji")?.trim().normalize("NFC") ?? "";
  const validWarpmojiEmoji = searchWarpletTokenId && requestedWarpmojiEmoji && context.env.WARPLETS
    ? await context.env.WARPLETS.prepare(
      `SELECT a.alias FROM warpmoji_emoji_aliases a
        JOIN warpmoji_candidates c ON c.canonical_emoji = a.canonical_emoji
       WHERE a.alias = ? AND c.token_id = ? AND c.status = 'approved' LIMIT 1`,
    ).bind(requestedWarpmojiEmoji, searchWarpletTokenId).first<{ alias: string }>().then((row) => row?.alias).catch(() => undefined)
    : undefined;
  const warpmojiCtaTitle = validWarpmojiEmoji && searchWarpletTokenId
    ? `${validWarpmojiEmoji} 10X Warplet #${searchWarpletTokenId}`
    : undefined;
  const searchResultsTitle = searchFirstWarpletTokenId
    ? getSearchResultsShareTitle(requestUrl.searchParams)
    : undefined;
  const perksShareContent = routeKey === "warplets" ? getPerksShareContentFromPath(requestUrl.pathname) : null;
  const searchShareTitle = searchWarpletTitle ?? searchResultsTitle ?? (perksShareContent ? `10X Perks: ${perksShareContent.label}` : undefined);
  const searchWarpletImageUrl = searchWarpletTokenId
    ? `https://warplets.10x.meme/${searchWarpletTokenId}.gif`
    : undefined;
  const searchResultsImageUrl = searchFirstWarpletTokenId
    ? `https://warplets.10x.meme/${searchFirstWarpletTokenId}.gif`
    : undefined;
  const dropShareImageUrl =
    routeKey === "drop"
      ? getDropShareImageUrl()
      : undefined;
  const searchShareImageUrl = searchWarpletImageUrl ?? searchResultsImageUrl ?? (perksShareContent ? getPerksShareImageUrl(perksShareContent) : undefined);
  const routeImageUrl = statsShareOgImageUrl ?? (routeKey === "stop" ? STOP_IMAGE_URL : searchShareImageUrl ?? dropShareImageUrl);
  const isSharedContentDeepLink = Boolean(
    statsLaunchLookupPath ||
    searchWarpletTitle ||
    searchResultsTitle ||
    perksShareContent
  );
  const sharedContentSubject = warpmojiCtaTitle ?? searchShareTitle;
  const sharedContentButtonTitle = statsShareSnapshot?.title
    ? getViewButtonTitle(statsShareSnapshot.title)
    : getStatsDeepLinkButtonTitle(requestUrl)
      ?? (sharedContentSubject ? getViewButtonTitle(sharedContentSubject) : undefined);
  const metaContent = escapeHtmlAttr(
    buildMiniAppMetaContent(
      requestUrl.origin,
      requestUrl.pathname,
      requestUrl.search,
      routeImageUrl,
      isSharedContentDeepLink ? sharedContentButtonTitle : statsShareSnapshot?.title ?? warpmojiCtaTitle ?? searchShareTitle,
      isSharedContentDeepLink ? undefined : statsShareSnapshot?.title ?? warpmojiCtaTitle ?? searchShareTitle,
      statsLaunchLookupPath
        ? `${requestUrl.origin}${statsLaunchLookupPath}`
        : statsShareSnapshot
          ? `${requestUrl.origin}${statsShareSnapshot.launchPath}`
          : undefined,
    )
  );
  const metaTag = `<meta name="fc:miniapp" content="${metaContent}" />`;
  const frameMetaTag = `<meta name="fc:frame" content="${metaContent}" />`;

  let html = injectLocalViteReactPreamble(await response.text(), requestUrl.hostname);
  const baseAppId = getBaseAppId(requestUrl.hostname);
  if (baseAppId) {
    const baseAppIdTag = `<meta name="base:app_id" content="${baseAppId}" />`;
    html = BASE_APP_ID_META_REGEX.test(html)
      ? html.replace(BASE_APP_ID_META_REGEX, baseAppIdTag)
      : html.replace("</head>", `  ${baseAppIdTag}\n  </head>`);
  } else {
    html = html.replace(BASE_APP_ID_META_REGEX, "");
  }
  const canonicalTag = `<link rel="canonical" href="${escapeHtmlAttr(buildCanonicalUrl(requestUrl))}" />`;
  html = CANONICAL_LINK_REGEX.test(html)
    ? html.replace(CANONICAL_LINK_REGEX, canonicalTag)
    : html.replace("</head>", `  ${canonicalTag}\n  </head>`);
  if (routeKey === "root") {
    html = html.replace(MANIFEST_LINK_REGEX, '<link rel="manifest" href="/manifest-10x.webmanifest" />');
    html = html.replace(FAVICON_LINKS_REGEX, buildFaviconLinks("app"));
    html = html.replace(APPLICATION_NAME_META_REGEX, '<meta name="application-name" content="10X.MEME" />');
    html = html.replace(APPLE_APP_TITLE_META_REGEX, '<meta name="apple-mobile-web-app-title" content="10X.MEME" />');
  }
  if (routeKey === "drop") {
    html = html.replace(MANIFEST_LINK_REGEX, '<link rel="manifest" href="/manifest-drop.webmanifest" />');
    html = html.replace(FAVICON_LINKS_REGEX, buildFaviconLinks("drop"));
    html = html.replace(APPLE_TOUCH_ICON_LINK_REGEX, '<link rel="apple-touch-icon" href="/icon_drop2.png" />');
    html = html.replace(APPLICATION_NAME_META_REGEX, '<meta name="application-name" content="10X Warplets Drop" />');
    html = html.replace(APPLE_APP_TITLE_META_REGEX, '<meta name="apple-mobile-web-app-title" content="10X Warplets Drop" />');
  }
  if (routeKey === "warplets") {
    html = html.replace(FAVICON_LINKS_REGEX, buildFaviconLinks("warplets"));
    html = html.replace(APPLE_TOUCH_ICON_LINK_REGEX, '<link rel="apple-touch-icon" href="/icon_search.png" />');
  }
  if (routeKey === "stonklets") {
    html = html.replace(MANIFEST_LINK_REGEX, '<link rel="manifest" href="/manifest-stonklets.webmanifest" />');
    html = html.replace(FAVICON_LINKS_REGEX, buildFaviconLinks("stonklets"));
    html = html.replace(APPLE_TOUCH_ICON_LINK_REGEX, '<link rel="apple-touch-icon" href="/stonklets/chip.png" />');
    html = html.replace(APPLICATION_NAME_META_REGEX, '<meta name="application-name" content="10X Stonklets" />');
    html = html.replace(APPLE_APP_TITLE_META_REGEX, '<meta name="apple-mobile-web-app-title" content="10X Stonklets" />');
  }
  if (FC_MINIAPP_META_REGEX.test(html)) {
    html = html.replace(FC_MINIAPP_META_REGEX, metaTag);
  } else {
    html = html.replace("</head>", `  ${metaTag}\n  </head>`);
  }
  if (statsShareSnapshot) {
    if (FC_FRAME_META_REGEX.test(html)) html = html.replace(FC_FRAME_META_REGEX, frameMetaTag);
    else html = html.replace("</head>", `  ${frameMetaTag}\n  </head>`);
  }

  if (routeKey === "drop" && dropShareImageUrl) {
    const titleTag = `<title>${escapeHtmlText(DROP_SHARE_TITLE)}</title>`;
    html = TITLE_REGEX.test(html)
      ? html.replace(TITLE_REGEX, titleTag)
      : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace("</head>", `  ${buildDropOpenGraphTags(dropShareImageUrl, requestUrl.href)}\n  </head>`);
  }

  if (routeKey === "root") {
    const titleTag = `<title>${escapeHtmlText(APP_SHARE_TITLE)}</title>`;
    html = TITLE_REGEX.test(html)
      ? html.replace(TITLE_REGEX, titleTag)
      : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace("</head>", `  ${buildAppOpenGraphTags(requestUrl.href)}\n  </head>`);
  }

  if (routeKey === "stop") {
    const titleTag = `<title>${escapeHtmlText(STOP_SHARE_TITLE)}</title>`;
    html = TITLE_REGEX.test(html)
      ? html.replace(TITLE_REGEX, titleTag)
      : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace("</head>", `  ${buildStopOpenGraphTags(requestUrl.href)}\n  </head>`);
  }

  if (routeKey === "warplets" && !statsShareSnapshot && !statsLaunchLookupPath) {
    const routeTitle = searchShareTitle ?? WARPLETS_SHARE_TITLE;
    const routeShareImageUrl = searchShareImageUrl ?? `${requestUrl.origin}/embed_search.png`;
    const titleTag = `<title>${escapeHtmlText(routeTitle)}</title>`;
    html = TITLE_REGEX.test(html)
      ? html.replace(TITLE_REGEX, titleTag)
      : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace(
      "</head>",
      `  ${buildSearchOpenGraphTags(
        routeTitle,
        routeShareImageUrl,
        requestUrl.href,
      )}\n  </head>`,
    );
  }
  if (routeKey === "stonklets") {
    const titleTag = `<title>${escapeHtmlText(STONKLETS_SHARE_TITLE)}</title>`;
    html = TITLE_REGEX.test(html) ? html.replace(TITLE_REGEX, titleTag) : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace("</head>", `  ${buildSearchOpenGraphTags(STONKLETS_SHARE_TITLE, `${requestUrl.origin}/stonklets/chip.png`, requestUrl.href, STONKLETS_SHARE_DESCRIPTION)}\n  </head>`);
  }

  if (statsShareSnapshot && statsShareOgImageUrl) {
    const statsMeta = getStatsSnapshotMeta(statsShareSnapshot);
    const titleTag = `<title>${escapeHtmlText(statsMeta.title)}</title>`;
    html = TITLE_REGEX.test(html)
      ? html.replace(TITLE_REGEX, titleTag)
      : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace(
      "</head>",
      `  ${buildStatsShareOpenGraphTags(
        statsMeta.title,
        statsMeta.description,
        statsShareOgImageUrl,
        requestUrl.href,
      )}\n  </head>`,
    );
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");

  return applySecurityHeaders(new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }), { isHtml: true });
};
