const FC_MINIAPP_META_REGEX = /<meta\s+name="fc:miniapp"[^>]*>/i;

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

function getRouteKey(hostname: string, pathname: string): RouteKey {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  if (hostname === "drop.10x.meme") return "drop";
  if (hostname === "find.10x.meme") return "find";
  if (hostname === "million.10x.meme") return "million";
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
  if (hostname === "drop.10x.meme" || hostname === "find.10x.meme" || hostname === "million.10x.meme") {
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
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return response;
  }

  const url = new URL(context.request.url);
  const metaContent = escapeHtmlAttr(buildMiniAppMetaContent(url.origin, url.pathname, url.search));
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
