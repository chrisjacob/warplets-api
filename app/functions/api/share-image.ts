const ALLOWED_IMAGE_HOSTS = new Set([
  "warplets.10x.meme",
  "i.seadn.io",
  "openseauserdata.com",
]);
const ALLOWED_IMAGE_HOST_SUFFIXES = [".seadn.io", ".openseauserdata.com"];

const MAX_REDIRECTS = 3;
const MAX_DECLARED_BYTES = 25 * 1024 * 1024;

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function parseAllowedImageUrl(rawUrl: string | null): URL | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const allowedHost = ALLOWED_IMAGE_HOSTS.has(hostname)
      || ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !allowedHost
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function fetchAllowedImage(url: URL, redirects = 0): Promise<Response> {
  const response = await fetch(url.href, {
    redirect: "manual",
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
      "user-agent": "10X-Share-Clipboard/1.0",
    },
  });

  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error("The image redirected too many times.");
    const location = response.headers.get("location");
    const redirectedUrl = location ? parseAllowedImageUrl(new URL(location, url).href) : null;
    if (!redirectedUrl) throw new Error("The image redirected to an unsupported host.");
    return fetchAllowedImage(redirectedUrl, redirects + 1);
  }

  return response;
}

export const onRequestGet: PagesFunction = async (context) => {
  const requestUrl = new URL(context.request.url);
  const imageUrl = parseAllowedImageUrl(requestUrl.searchParams.get("url"));
  if (!imageUrl) return errorResponse("Unsupported share image URL.", 400);

  try {
    const upstream = await fetchAllowedImage(imageUrl);
    if (!upstream.ok || !upstream.body) return errorResponse("The share image could not be loaded.", 502);

    const contentType = upstream.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) return errorResponse("The upstream response was not an image.", 502);

    const declaredLength = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DECLARED_BYTES) {
      return errorResponse("The share image is too large.", 413);
    }

    return new Response(upstream.body, {
      headers: {
        "cache-control": "public, max-age=86400, s-maxage=86400",
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.warn("Share image proxy failed", error);
    return errorResponse("The share image could not be loaded.", 502);
  }
};
