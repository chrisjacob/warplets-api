import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WARPLETS_APP_HOSTS,
  WARPLETS_APP_PATH,
  WARPLETS_PUBLIC_NAME,
  isWarpletsAppHostname,
} from "./shared/warpletsApp";

const TITLE_REGEX = /<title>[\s\S]*?<\/title>/i;
const DROP_SHARE_TITLE = "🟢 10X Warplets (Private 10K NFT Drop)";
const DROP_SHARE_DESCRIPTION =
  "Price increases by $10 every 10 days. Private supply goes public every 10 days. Are you on the list? Don't miss out. ";
const DEFAULT_DROP_SHARE_IMAGE_URL = "https://warplets.10x.meme/1391.gif";
const DROP_ICON_URL = "https://drop.10x.meme/icon_drop2.png";
const DROP_SPLASH_BACKGROUND_COLOR = "#849fa6";
const STOP_SHARE_TITLE = "@Mention Settings";
const STOP_SHARE_DESCRIPTION = "Opt out of 10X outreach mentions in the Farcaster Mini App.";
const STOP_IMAGE_URL = "https://warplets.10x.meme/3081.png";
const WARPLETS_SPLASH_BACKGROUND_COLOR = "#004100";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

type AccountAssociation = {
  header: string;
  payload: string;
  signature: string;
};

function parseWarpletsAccountAssociation(hostname: string): AccountAssociation | null {
  const raw = process.env.WARPLETS_ACCOUNT_ASSOCIATION_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AccountAssociation>;
    if (!parsed.header || !parsed.payload || !parsed.signature) return null;
    const decoded = JSON.parse(
      Buffer.from(parsed.payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { domain?: unknown };
    return decoded.domain === hostname ? parsed as AccountAssociation : null;
  } catch {
    return null;
  }
}

function buildLocalWarpletsManifest(
  hostname: string,
  accountAssociation?: AccountAssociation | null,
) {
  const origin = `https://${hostname}`;
  return {
    ...(accountAssociation ? { accountAssociation } : {}),
    miniapp: {
      version: "1",
      name: WARPLETS_PUBLIC_NAME,
      canonicalDomain: hostname,
      homeUrl: origin,
      iconUrl: `${origin}/icon_search.png`,
      imageUrl: `${origin}/embed_search.png`,
      heroImageUrl: `${origin}/hero_search.png`,
      buttonTitle: "Open 10X Warplets",
      splashImageUrl: `${origin}/splash_search.png`,
      splashBackgroundColor: WARPLETS_SPLASH_BACKGROUND_COLOR,
      webhookUrl: `${origin}/webhook/warplets`,
      castShareUrl: origin,
      subtitle: "Find your Warplet.",
      description: "Search, filter, trade, favourite, and share 10X Warplets.",
      primaryCategory: "social",
      screenshotUrls: [1, 2, 3].map((index) => `${origin}/screenshots/search_${index}.jpg`),
      tags: ["10x", "warplets", "farcaster", "nft", "search"],
      tagline: "Take the green pill.",
      ogTitle: WARPLETS_PUBLIC_NAME,
      ogDescription: "Search, filter, trade, favourite, and share 10X Warplets.",
      ogImageUrl: `${origin}/hero_search.png`,
    },
  };
}

let localFidToTokenId: Map<string, string> | undefined;

type RouteKey = "root" | "drop" | "warplets" | "million" | "stop" | "unsubscribe";

function matchesHost(hostname: string, ...candidates: string[]): boolean {
  return candidates.includes(hostname);
}

function getRouteKey(pathname: string, hostname?: string): RouteKey {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  if (hostname && matchesHost(hostname, "drop-local.10x.meme", "drop-dev.10x.meme", "drop.10x.meme")) return "drop";
  if (hostname && isWarpletsAppHostname(hostname)) return "warplets";
  if (hostname && matchesHost(hostname, "million-local.10x.meme", "million-dev.10x.meme", "million.10x.meme")) return "million";
  if (cleanPath === "/drop" || cleanPath.startsWith("/drop/")) return "drop";
  if (cleanPath === WARPLETS_APP_PATH || cleanPath.startsWith(`${WARPLETS_APP_PATH}/`)) return "warplets";
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

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  values.push(value);
  return values;
}

function getLocalFidToTokenId(): Map<string, string> {
  if (localFidToTokenId) return localFidToTokenId;

  const csvPath = path.join(repoRoot, "10x-warplets-metadata.csv");
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/);
  const headers = parseCsvLine(lines[0] ?? "");
  const nameIndex = headers.indexOf("Name");
  const fidIndex = headers.indexOf("FID Value");
  const map = new Map<string, string>();

  if (nameIndex === -1 || fidIndex === -1) {
    localFidToTokenId = map;
    return map;
  }

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const columns = parseCsvLine(line);
    const fid = columns[fidIndex]?.trim();
    const name = columns[nameIndex]?.trim();
    const tokenId = name?.match(/#(\d+)$/)?.[1];
    if (fid && tokenId) map.set(fid, tokenId);
  }

  localFidToTokenId = map;
  return map;
}

function getReferralFid(query: string): string | undefined {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const fid = params.get("fid")?.trim();
  return fid && /^\d+$/.test(fid) ? fid : undefined;
}

function getWarpletTokenId(query: string): string | undefined {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const tokenId = (params.get("warplet") ?? params.get("tokenId"))?.trim();
  return tokenId && /^\d+$/.test(tokenId) ? tokenId : undefined;
}

function getFirstWarpletTokenId(query: string): string | undefined {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const tokenId = (params.get("first") ?? params.get("First"))?.trim();
  return tokenId && /^\d+$/.test(tokenId) ? tokenId : undefined;
}

function getSearchResultsShareTitle(query: string): string | undefined {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  if (!getFirstWarpletTokenId(query)) return undefined;

  const rawCount = params.get("count")?.trim();
  const count = rawCount && /^\d+$/.test(rawCount) ? Number.parseInt(rawCount, 10) : undefined;
  const countText = count && Number.isSafeInteger(count) && count > 0
    ? count.toLocaleString("en-US")
    : undefined;
  const label = (
    params.get("search") ??
    params.get("q") ??
    params.get("random") ??
    "Filtered"
  ).trim() || "Filtered";

  return countText ? `${countText} ${label} Warplets...` : `${label} Warplets...`;
}

function getLocalDropShareImageUrl(query: string): string {
  void query;
  return DEFAULT_DROP_SHARE_IMAGE_URL;
}

function getLaunchPath(routeKey: RouteKey, hostname: string): string {
  if (
    matchesHost(
      hostname,
      "drop-local.10x.meme",
      "drop-dev.10x.meme",
      "drop.10x.meme",
      ...WARPLETS_APP_HOSTS,
      "million-local.10x.meme",
      "million-dev.10x.meme",
      "million.10x.meme",
    )
  ) {
    return "/";
  }

  if (routeKey === "drop") return "/drop";
  if (routeKey === "warplets") return WARPLETS_APP_PATH;
  if (routeKey === "million") return "/million";
  if (routeKey === "stop") return "/stop";
  if (routeKey === "unsubscribe") return "/unsubscribe";
  return "/";
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
  ].join("\n    ");
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
  ].join("\n    ");
}

function buildSearchOpenGraphTags(titleText: string, imageUrl: string, pageUrl: string): string {
  const title = escapeHtmlAttr(titleText);
  const description = escapeHtmlAttr("Search, filter, and share 10X Warplets.");
  const image = escapeHtmlAttr(imageUrl);
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
  ].join("\n    ");
}

const localApiTarget = process.env.VITE_LOCAL_API_TARGET?.trim() || "http://127.0.0.1:8789";
const MINIAPP_FRAME_ANCESTORS = [
  "'self'",
  "https://farcaster.xyz",
  "https://*.farcaster.xyz",
  "https://warpcast.com",
  "https://*.warpcast.com",
].join(" ");

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
  },
  optimizeDeps: {
    // Stats charts are lazy-loaded. Pre-bundle Recharts at startup so the first
    // chart request through a local tunnel cannot invalidate Vite's dependency hash.
    include: ["recharts"],
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "miniapp-meta-query-pass-through",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const hostname = (req.headers.host ?? "").split(":")[0].toLowerCase();
          const pathname = (req.url ?? "/").split("?")[0];
          if (pathname === "/.well-known/farcaster.json" && isWarpletsAppHostname(hostname)) {
            const association = parseWarpletsAccountAssociation(hostname);
            res.statusCode = 200;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.setHeader("cache-control", "no-store");
            res.end(JSON.stringify(buildLocalWarpletsManifest(hostname, association)));
            return;
          }
          res.removeHeader("x-frame-options");
          res.removeHeader("X-Frame-Options");
          const originalWriteHead = res.writeHead;
          res.writeHead = function writeHeadWithoutXFrameOptions(...args: Parameters<typeof originalWriteHead>) {
            res.removeHeader("x-frame-options");
            res.removeHeader("X-Frame-Options");
            res.setHeader("content-security-policy", `frame-ancestors ${MINIAPP_FRAME_ANCESTORS}`);
            return originalWriteHead.apply(this, args);
          };
          next();
        });
      },
      transformIndexHtml(html, ctx) {
        const reqUrl = ctx?.originalUrl ?? ctx?.path ?? "/";
        const reqPath = reqUrl.includes("?") ? reqUrl.slice(0, reqUrl.indexOf("?")) : reqUrl;
        const query = reqUrl.includes("?") ? reqUrl.slice(reqUrl.indexOf("?")) : "";
        const baseUrl = process.env.VITE_MINIAPP_BASE_URL?.replace(/\/$/, "") || "";
        if (!baseUrl) return html;
        const baseHostname = new URL(baseUrl).hostname;
        const routeKey = getRouteKey(reqPath, baseHostname);
        const config = getMiniAppConfig(routeKey);
        const launchPath = getLaunchPath(routeKey, baseHostname);
        const launchBase = launchPath === "/" ? `${baseUrl}/` : `${baseUrl}${launchPath}`;
        const searchWarpletTokenId = routeKey === "warplets" ? getWarpletTokenId(query) : undefined;
        const searchFirstWarpletTokenId =
          routeKey === "warplets" && !searchWarpletTokenId ? getFirstWarpletTokenId(query) : undefined;
        const searchWarpletTitle = searchWarpletTokenId ? `10X Warplet #${searchWarpletTokenId}` : undefined;
        const searchResultsTitle = searchFirstWarpletTokenId ? getSearchResultsShareTitle(query) : undefined;
        const searchShareTitle = searchWarpletTitle ?? searchResultsTitle;
        const searchWarpletImageUrl = searchWarpletTokenId
          ? `https://warplets.10x.meme/${searchWarpletTokenId}.gif`
          : undefined;
        const searchResultsImageUrl = searchFirstWarpletTokenId
          ? `https://warplets.10x.meme/${searchFirstWarpletTokenId}.gif`
          : undefined;
        const dropShareImageUrl =
          routeKey === "drop" ? getLocalDropShareImageUrl(query) : undefined;
        const searchShareImageUrl = searchWarpletImageUrl ?? searchResultsImageUrl;
        const routeImageUrl = routeKey === "stop" ? STOP_IMAGE_URL : searchShareImageUrl ?? dropShareImageUrl;
        const splashImageUrl = routeKey === "drop"
          ? `${baseUrl}/splash_drop2.png`
          : routeKey === "warplets"
            ? `${baseUrl}/splash_search.png`
            : `${baseUrl}/splash.png`;
        const defaultEmbedImageUrl = routeKey === "warplets" ? `${baseUrl}/embed_search.png` : `${baseUrl}/embed.png`;

        const payload = {
          version: "1",
          imageUrl: routeImageUrl ?? defaultEmbedImageUrl,
          button: {
            title: searchShareTitle ?? config.title,
            action: {
              type: "launch_miniapp",
              name: searchShareTitle ?? config.name,
              url: `${launchBase}${query}`,
              splashImageUrl,
              splashBackgroundColor: routeKey === "drop"
                ? DROP_SPLASH_BACKGROUND_COLOR
                : routeKey === "warplets"
                  ? WARPLETS_SPLASH_BACKGROUND_COLOR
                  : "#000000",
            },
          },
        };

        const escaped = JSON.stringify(payload).replace(/"/g, "&quot;");
        const dynamicMeta = `<meta name="fc:miniapp" content="${escaped}" />`;
        let nextHtml = html.replace(/<meta\s+name="fc:miniapp"[^>]*>/i, dynamicMeta);
        if (routeKey === "drop") {
          nextHtml = nextHtml.replace(/<link\s+rel="manifest"[^>]*>/i, '<link rel="manifest" href="/manifest-drop.webmanifest" />');
          nextHtml = nextHtml.replace(/<link\s+rel="icon"[^>]*>/i, '<link rel="icon" type="image/png" href="/icon_drop2.png" />');
          nextHtml = nextHtml.replace(/<link\s+rel="apple-touch-icon"[^>]*>/i, '<link rel="apple-touch-icon" href="/icon_drop2.png" />');
        } else if (routeKey === "warplets") {
          nextHtml = nextHtml.replace(/<link\s+rel="icon"[^>]*>/i, '<link rel="icon" type="image/png" href="/icon_search.png" />');
          nextHtml = nextHtml.replace(/<link\s+rel="apple-touch-icon"[^>]*>/i, '<link rel="apple-touch-icon" href="/icon_search.png" />');
        }

        if (routeKey === "drop" && dropShareImageUrl) {
          const titleTag = `<title>${escapeHtmlText(DROP_SHARE_TITLE)}</title>`;
          nextHtml = TITLE_REGEX.test(nextHtml)
            ? nextHtml.replace(TITLE_REGEX, titleTag)
            : nextHtml.replace("</head>", `    ${titleTag}\n  </head>`);
          nextHtml = nextHtml.replace(
            "</head>",
            `    ${buildDropOpenGraphTags(dropShareImageUrl, `${baseUrl}${reqUrl}`)}\n  </head>`,
          );
        }

        if (routeKey === "stop") {
          const titleTag = `<title>${escapeHtmlText(STOP_SHARE_TITLE)}</title>`;
          nextHtml = TITLE_REGEX.test(nextHtml)
            ? nextHtml.replace(TITLE_REGEX, titleTag)
            : nextHtml.replace("</head>", `    ${titleTag}\n  </head>`);
          nextHtml = nextHtml.replace(
            "</head>",
            `    ${buildStopOpenGraphTags(`${baseUrl}${reqUrl}`)}\n  </head>`,
          );
        }

        if (routeKey === "warplets") {
          const routeTitle = searchShareTitle ?? WARPLETS_PUBLIC_NAME;
          const routeShareImageUrl = searchShareImageUrl ?? `${baseUrl}/embed_search.png`;
          const titleTag = `<title>${escapeHtmlText(routeTitle)}</title>`;
          nextHtml = TITLE_REGEX.test(nextHtml)
            ? nextHtml.replace(TITLE_REGEX, titleTag)
            : nextHtml.replace("</head>", `    ${titleTag}\n  </head>`);
          nextHtml = nextHtml.replace(
            "</head>",
            `    ${buildSearchOpenGraphTags(routeTitle, routeShareImageUrl, `${baseUrl}${reqUrl}`)}\n  </head>`,
          );
        }

        return nextHtml;
      },
    },
  ],
  server: {
    allowedHosts: [
      "app-local.10x.meme",
      "drop-local.10x.meme",
      WARPLETS_APP_HOSTS[0],
      "million-local.10x.meme",
    ],
    proxy: {
      // In local tunnel mode, route API to local worker so D1/KV are local.
      "/api": {
        target: localApiTarget,
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, request) => {
            const requestHost = (request.headers.host ?? "").split(":")[0].toLowerCase();
            const origin = request.headers.origin;
            if (origin) {
              try {
                const publicUrl = new URL(origin);
                proxyRequest.setHeader("host", publicUrl.host);
                proxyRequest.setHeader("origin", `http://${publicUrl.host}`);
                if (publicUrl.protocol === "https:") {
                  proxyRequest.setHeader("x-10x-public-origin", publicUrl.origin);
                }
                return;
              } catch {
                // Leave malformed origins untouched so the API rejects them.
              }
            }
            if (requestHost === WARPLETS_APP_HOSTS[0]) {
              proxyRequest.setHeader("x-10x-public-origin", `https://${requestHost}`);
            }
          });
        },
      },
      "/webhook": {
        target: localApiTarget,
        changeOrigin: false,
      },
      "/__adminhidden": {
        target: localApiTarget,
        changeOrigin: true,
      },
      "/__admin": {
        target: localApiTarget,
        changeOrigin: true,
      },
    },
  },
});
