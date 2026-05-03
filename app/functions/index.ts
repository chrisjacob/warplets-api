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

function buildMiniAppMetaContent(origin: string, search: string): string {
  const base = normalizeBase(origin);
  const launchUrl = `${base}/${search}`;

  return JSON.stringify({
    version: "1",
    imageUrl: `${base}/embed.png`,
    button: {
      title: "Open 10X",
      action: {
        type: "launch_miniapp",
        name: "10X",
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
  const metaContent = escapeHtmlAttr(buildMiniAppMetaContent(url.origin, url.search));
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
