import { jsonSecure } from "../_lib/security.js";

interface Env {
  WARPLETS_KV?: KVNamespace;
}

interface CachedOpenGraphImage {
  imageUrl: string;
  sourceUrl: string;
  fetchedAt: string;
}

const CACHE_TTL_SECONDS = 60 * 60;
const OPENSEA_HOST = "opensea.io";
const COLLECTION_PATH = "/collection/10xwarplets";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";

function withCacheHeaders(response: Response): Response {
  response.headers.set("cache-control", `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`);
  return response;
}

function normalizeOpenSeaUrl(rawUrl: string | null): URL | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function isAllowedOpenSeaUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== OPENSEA_HOST) return false;

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === COLLECTION_PATH) return true;

  const parts = path.split("/").filter(Boolean);
  return (
    parts.length === 4 &&
    parts[0] === "item" &&
    parts[1] === "base" &&
    parts[2].toLowerCase() === COLLECTION_CONTRACT &&
    /^\d+$/.test(parts[3])
  );
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getAttributeValue(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeHtmlAttribute(match[1]) : null;
}

function extractOpenGraphImage(html: string, sourceUrl: URL): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const key = getAttributeValue(tag, "property") ?? getAttributeValue(tag, "name");
    if (key !== "og:image" && key !== "og:image:secure_url" && key !== "twitter:image") continue;

    const content = getAttributeValue(tag, "content");
    if (!content) continue;

    try {
      const imageUrl = new URL(content, sourceUrl);
      if (imageUrl.protocol === "https:" || imageUrl.protocol === "http:") {
        return imageUrl.href;
      }
    } catch {
      // Try the next image candidate.
    }
  }

  return null;
}

async function fetchOpenSeaOpenGraphImage(sourceUrl: URL): Promise<CachedOpenGraphImage> {
  const response = await fetch(sourceUrl.href, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "10X Warplets OpenGraph Preview (+https://10x.meme)",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenSea returned HTTP ${response.status}`);
  }

  const finalUrl = new URL(response.url);
  if (finalUrl.hostname.toLowerCase() !== OPENSEA_HOST) {
    throw new Error("OpenSea redirected to an unexpected host");
  }

  const html = await response.text();
  const imageUrl = extractOpenGraphImage(html, sourceUrl);
  if (!imageUrl) {
    throw new Error("OpenSea page did not include an OpenGraph image");
  }

  return {
    imageUrl,
    sourceUrl: sourceUrl.href,
    fetchedAt: new Date().toISOString(),
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const requestUrl = new URL(context.request.url);
  const sourceUrl = normalizeOpenSeaUrl(requestUrl.searchParams.get("url"));
  if (!sourceUrl || !isAllowedOpenSeaUrl(sourceUrl)) {
    return jsonSecure({ error: "valid OpenSea collection or Warplet item URL is required" }, { status: 400 });
  }

  const cacheKey = `opengraph-image:v1:${sourceUrl.href}`;
  const cached = await context.env.WARPLETS_KV?.get<CachedOpenGraphImage>(cacheKey, "json");
  if (cached?.imageUrl) {
    return withCacheHeaders(jsonSecure({ ...cached, cached: true }));
  }

  try {
    const result = await fetchOpenSeaOpenGraphImage(sourceUrl);
    await context.env.WARPLETS_KV?.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
    return withCacheHeaders(jsonSecure({ ...result, cached: false }));
  } catch (error) {
    return jsonSecure(
      {
        error: error instanceof Error ? error.message : "Failed to fetch OpenSea OpenGraph image",
      },
      { status: 502 },
    );
  }
};
