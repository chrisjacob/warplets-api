const FC_MINIAPP_META_REGEX = /<meta\s+name="fc:miniapp"[^>]*>/i;
const TITLE_REGEX = /<title>[\s\S]*?<\/title>/i;
import { applySecurityHeaders } from "./_lib/security.js";

type PagesEnv = {
  WARPLETS?: D1Database;
};

const DROP_SHARE_TITLE = "10X Warplets (10K NFT Drop)";
const DROP_SHARE_DESCRIPTION =
  "Price increases 10 USD every 10 days. Private supply goes public every 10 days. Don't miss out. ";
const DEFAULT_DROP_SHARE_IMAGE_URL = "https://warplets.10x.meme/760.gif";
const DROP_ICON_URL = "https://drop.10x.meme/icon_drop.png";
const DROP_SPLASH_URL = "https://drop.10x.meme/splash_drop.png";
const DROP_EMBED_URL = "https://drop.10x.meme/embed_drop.png";
const DROP_HERO_URL = "https://drop.10x.meme/hero_drop.png";
const STOP_SHARE_TITLE = "@Mention Settings";
const STOP_SHARE_DESCRIPTION = "Opt out of 10X outreach mentions in the Farcaster Mini App.";
const STOP_IMAGE_URL = "https://warplets.10x.meme/3081.png";

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

function buildFarcasterManifest(hostname: string) {
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
        buttonTitle: "Claim Your Warplet",
        splashImageUrl: DROP_SPLASH_URL,
        splashBackgroundColor: "#000000",
        webhookUrl: "https://app.10x.meme/webhook/drop",
        castShareUrl: `https://${hostname}`,
        subtitle: "Don't miss out.",
        description: DROP_SHARE_DESCRIPTION,
        primaryCategory: "social",
        screenshotUrls: [
          "https://drop.10x.meme/screenshots/1.jpg",
          "https://drop.10x.meme/screenshots/2.jpg",
          "https://drop.10x.meme/screenshots/3.jpg",
        ],
        tags: ["10x", "warplets", "farcaster", "nft", "drop"],
        tagline: "Take the green pill.",
        ogTitle: DROP_SHARE_TITLE,
        ogDescription: DROP_SHARE_DESCRIPTION,
        ogImageUrl: DEFAULT_DROP_SHARE_IMAGE_URL,
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
      description: "10X Network. 10X Warplets. 10X Memecoins.",
      primaryCategory: "social",
      screenshotUrls: [
        "https://app.10x.meme/screenshots/1.jpg",
        "https://app.10x.meme/screenshots/2.jpg",
        "https://app.10x.meme/screenshots/3.jpg",
      ],
      tags: ["10x", "warplets", "farcaster", "nft", "memecoins"],
      tagline: "Don't miss out.",
      ogTitle: "10X",
      ogDescription: "Builders, capital and signal - aligned.",
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

type RouteKey = "root" | "drop" | "find" | "million" | "stop" | "unsubscribe";

function matchesHost(hostname: string, ...candidates: string[]): boolean {
  return candidates.includes(hostname);
}

function getRouteKey(hostname: string, pathname: string): RouteKey {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  if (matchesHost(hostname, "drop.10x.meme", "drop-dev.10x.meme", "drop-local.10x.meme")) return "drop";
  if (matchesHost(hostname, "find.10x.meme", "find-dev.10x.meme", "find-local.10x.meme")) return "find";
  if (matchesHost(hostname, "million.10x.meme", "million-dev.10x.meme", "million-local.10x.meme")) return "million";
  if (cleanPath === "/drop" || cleanPath.startsWith("/drop/")) return "drop";
  if (cleanPath === "/find" || cleanPath.startsWith("/find/")) return "find";
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

  if (routeKey === "find") {
    return {
      title: "Open 10X Warplets Find",
      name: "10X Warplets Find",
      path: "/find",
    };
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

async function getDropShareImageUrl(
  env: PagesEnv,
  searchParams: URLSearchParams,
): Promise<string> {
  const fid = getReferralFid(searchParams);
  if (!fid || !env.WARPLETS) return DEFAULT_DROP_SHARE_IMAGE_URL;

  try {
    const row = await env.WARPLETS.prepare(
      "SELECT token_id FROM warplets_metadata WHERE fid_value = ? LIMIT 1",
    )
      .bind(fid)
      .first<{ token_id: number | null }>();

    return typeof row?.token_id === "number" && Number.isInteger(row.token_id)
      ? `https://warplets.10x.meme/${row.token_id}.gif`
      : DEFAULT_DROP_SHARE_IMAGE_URL;
  } catch {
    return DEFAULT_DROP_SHARE_IMAGE_URL;
  }
}

function getLaunchPath(routeKey: RouteKey, hostname: string): string {
  if (
    matchesHost(
      hostname,
      "drop.10x.meme",
      "drop-dev.10x.meme",
      "drop-local.10x.meme",
      "find.10x.meme",
      "find-dev.10x.meme",
      "find-local.10x.meme",
      "million.10x.meme",
      "million-dev.10x.meme",
      "million-local.10x.meme"
    )
  ) {
    return "/";
  }

  if (routeKey === "drop") return "/drop";
  if (routeKey === "find") return "/find";
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
): string {
  const base = normalizeBase(origin);
  const hostname = new URL(origin).hostname;
  const routeKey = getRouteKey(hostname, pathname);
  const config = getMiniAppConfig(routeKey);
  const launchPath = getLaunchPath(routeKey, hostname);
  const launchBase = launchPath === "/" ? `${base}/` : `${base}${launchPath}`;
  const launchUrl = `${launchBase}${search}`;
  const splashImageUrl =
    routeKey === "drop" ? `${base}/splash_drop.png` : `${base}/splash.png`;

  return JSON.stringify({
    version: "1",
    imageUrl: imageUrl ?? `${base}/embed.png`,
    button: {
      title: config.title,
      action: {
        type: "launch_miniapp",
        name: config.name,
        url: launchUrl,
        splashImageUrl,
        splashBackgroundColor: "#000000",
      },
    },
  });
}

function buildDropOpenGraphTags(imageUrl: string, pageUrl: string): string {
  const title = escapeHtmlAttr(DROP_SHARE_TITLE);
  const description = escapeHtmlAttr(DROP_SHARE_DESCRIPTION);
  const image = escapeHtmlAttr(imageUrl);
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
    `<meta name="twitter:image" content="${image}" />`,
  ].join("\n  ");
}

function buildStopOpenGraphTags(pageUrl: string): string {
  const title = escapeHtmlAttr(STOP_SHARE_TITLE);
  const description = escapeHtmlAttr(STOP_SHARE_DESCRIPTION);
  const image = escapeHtmlAttr(STOP_IMAGE_URL);
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
    `<meta name="twitter:image" content="${image}" />`,
  ].join("\n  ");
}

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const requestUrl = new URL(context.request.url);

  if (requestUrl.pathname === "/.well-known/farcaster.json") {
    return applySecurityHeaders(Response.json(buildFarcasterManifest(requestUrl.hostname), {
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
  const dropShareImageUrl =
    routeKey === "drop"
      ? await getDropShareImageUrl(context.env, requestUrl.searchParams)
      : undefined;
  const routeImageUrl = routeKey === "stop" ? STOP_IMAGE_URL : dropShareImageUrl;
  const metaContent = escapeHtmlAttr(
    buildMiniAppMetaContent(
      requestUrl.origin,
      requestUrl.pathname,
      requestUrl.search,
      routeImageUrl,
    )
  );
  const metaTag = `<meta name="fc:miniapp" content="${metaContent}" />`;

  let html = await response.text();
  if (FC_MINIAPP_META_REGEX.test(html)) {
    html = html.replace(FC_MINIAPP_META_REGEX, metaTag);
  } else {
    html = html.replace("</head>", `  ${metaTag}\n  </head>`);
  }

  if (routeKey === "drop" && dropShareImageUrl) {
    const titleTag = `<title>${escapeHtmlText(DROP_SHARE_TITLE)}</title>`;
    html = TITLE_REGEX.test(html)
      ? html.replace(TITLE_REGEX, titleTag)
      : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace("</head>", `  ${buildDropOpenGraphTags(dropShareImageUrl, requestUrl.href)}\n  </head>`);
  }

  if (routeKey === "stop") {
    const titleTag = `<title>${escapeHtmlText(STOP_SHARE_TITLE)}</title>`;
    html = TITLE_REGEX.test(html)
      ? html.replace(TITLE_REGEX, titleTag)
      : html.replace("</head>", `  ${titleTag}\n  </head>`);
    html = html.replace("</head>", `  ${buildStopOpenGraphTags(requestUrl.href)}\n  </head>`);
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
