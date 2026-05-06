const FC_MINIAPP_META_REGEX = /<meta\s+name="fc:miniapp"[^>]*>/i;

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
        iconUrl: "https://drop.10x.meme/icon.png",
        imageUrl: "https://drop.10x.meme/embed.png",
        heroImageUrl: "https://drop.10x.meme/hero.png",
        buttonTitle: "Claim Your Warplet",
        splashImageUrl: "https://drop.10x.meme/splash.png",
        splashBackgroundColor: "#000000",
        webhookUrl: "https://app.10x.meme/webhook/drop",
        castShareUrl: `https://${hostname}`,
        subtitle: "Don't miss out.",
        description: "Claim your 10X Warplet NFT before it's gone.",
        primaryCategory: "social",
        tags: ["10x", "warplets", "farcaster", "nft", "drop"],
        tagline: "Your Warplet is waiting.",
        ogTitle: "10X Warplets Drop",
        ogDescription: "Claim your 10X Warplet NFT before it's gone.",
        ogImageUrl: "https://drop.10x.meme/embed.png",
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

function normalizeBase(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

type RouteKey = "root" | "drop" | "find" | "million";

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

  return {
    title: "Open 10X",
    name: "10X",
    path: "/",
  };
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
  return "/";
}

function buildMiniAppMetaContent(origin: string, pathname: string, search: string): string {
  const base = normalizeBase(origin);
  const hostname = new URL(origin).hostname;
  const routeKey = getRouteKey(hostname, pathname);
  const config = getMiniAppConfig(routeKey);
  const launchPath = getLaunchPath(routeKey, hostname);
  const launchBase = launchPath === "/" ? `${base}/` : `${base}${launchPath}`;
  const launchUrl = `${launchBase}${search}`;

  return JSON.stringify({
    version: "1",
    imageUrl: `${base}/embed.png`,
    button: {
      title: config.title,
      action: {
        type: "launch_miniapp",
        name: config.name,
        url: launchUrl,
        splashImageUrl: `${base}/splash.png`,
        splashBackgroundColor: "#000000",
      },
    },
  });
}

export const onRequestGet: PagesFunction = async (context) => {
  const requestUrl = new URL(context.request.url);

  if (requestUrl.pathname === "/.well-known/farcaster.json") {
    return Response.json(buildFarcasterManifest(requestUrl.hostname), {
      headers: {
        "cache-control": "no-store",
      },
    });
  }

  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return response;
  }

  const metaContent = escapeHtmlAttr(
    buildMiniAppMetaContent(requestUrl.origin, requestUrl.pathname, requestUrl.search)
  );
  const metaTag = `<meta name="fc:miniapp" content="${metaContent}" />`;

  let html = await response.text();
  if (FC_MINIAPP_META_REGEX.test(html)) {
    html = html.replace(FC_MINIAPP_META_REGEX, metaTag);
  } else {
    html = html.replace("</head>", `  ${metaTag}\n  </head>`);
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
