import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TITLE_REGEX = /<title>[\s\S]*?<\/title>/i;
const DROP_SHARE_TITLE = "🟢 10X Warplets (Private 10K NFT Drop)";
const DROP_SHARE_DESCRIPTION =
  "Price increases by $10 every 10 days. Private supply goes public every 10 days. Are you on the list? Don't miss out. ";
const DEFAULT_DROP_SHARE_IMAGE_URL = "https://warplets.10x.meme/760.gif";
const DROP_ICON_URL = "https://drop.10x.meme/icon_drop.png";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let localFidToTokenId: Map<string, string> | undefined;

type RouteKey = "root" | "drop" | "find" | "million";

function matchesHost(hostname: string, ...candidates: string[]): boolean {
  return candidates.includes(hostname);
}

function getRouteKey(pathname: string, hostname?: string): RouteKey {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  if (hostname && matchesHost(hostname, "drop-local.10x.meme", "drop-dev.10x.meme", "drop.10x.meme")) return "drop";
  if (hostname && matchesHost(hostname, "find-local.10x.meme", "find-dev.10x.meme", "find.10x.meme")) return "find";
  if (hostname && matchesHost(hostname, "million-local.10x.meme", "million-dev.10x.meme", "million.10x.meme")) return "million";
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

function getLocalDropShareImageUrl(query: string): string {
  const fid = getReferralFid(query);
  if (!fid) return DEFAULT_DROP_SHARE_IMAGE_URL;

  const tokenId = getLocalFidToTokenId().get(fid);
  return tokenId
    ? `https://warplets.10x.meme/${tokenId}.gif`
    : DEFAULT_DROP_SHARE_IMAGE_URL;
}

function getLaunchPath(routeKey: RouteKey, hostname: string): string {
  if (
    matchesHost(
      hostname,
      "drop-local.10x.meme",
      "drop-dev.10x.meme",
      "drop.10x.meme",
      "find-local.10x.meme",
      "find-dev.10x.meme",
      "find.10x.meme",
      "million-local.10x.meme",
      "million-dev.10x.meme",
      "million.10x.meme",
    )
  ) {
    return "/";
  }

  if (routeKey === "drop") return "/drop";
  if (routeKey === "find") return "/find";
  if (routeKey === "million") return "/million";
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

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "miniapp-meta-query-pass-through",
      apply: "serve",
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
        const dropShareImageUrl =
          routeKey === "drop" ? getLocalDropShareImageUrl(query) : undefined;
        const splashImageUrl =
          routeKey === "drop" ? `${baseUrl}/splash_drop.png` : `${baseUrl}/splash.png`;

        const payload = {
          version: "1",
          imageUrl: dropShareImageUrl ?? `${baseUrl}/embed.png`,
          button: {
            title: config.title,
            action: {
              type: "launch_miniapp",
              name: config.name,
              url: `${launchBase}${query}`,
              splashImageUrl,
              splashBackgroundColor: "#000000",
            },
          },
        };

        const escaped = JSON.stringify(payload).replace(/"/g, "&quot;");
        const dynamicMeta = `<meta name="fc:miniapp" content="${escaped}" />`;
        let nextHtml = html.replace(/<meta\s+name="fc:miniapp"[^>]*>/i, dynamicMeta);

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

        return nextHtml;
      },
    },
  ],
  server: {
    allowedHosts: [
      "app-local.10x.meme",
      "drop-local.10x.meme",
      "find-local.10x.meme",
      "million-local.10x.meme",
    ],
    proxy: {
      // Proxy API calls to the deployed dev environment so functions work locally
      "/api": "https://app-dev.10x.meme",
    },
  },
});
