import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

type RouteKey = "root" | "drop" | "find" | "million";

function getRouteKey(pathname: string): RouteKey {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
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

export default defineConfig({
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
        const routeKey = getRouteKey(reqPath);
        const config = getMiniAppConfig(routeKey);
        const launchBase = config.path === "/" ? `${baseUrl}/` : `${baseUrl}${config.path}`;

        const payload = {
          version: "1",
          imageUrl: `${baseUrl}/embed.png`,
          button: {
            title: config.title,
            action: {
              type: "launch_miniapp",
              name: config.name,
              url: `${launchBase}${query}`,
              splashImageUrl: `${baseUrl}/splash.png`,
              splashBackgroundColor: "#000000",
            },
          },
        };

        const escaped = JSON.stringify(payload).replace(/"/g, "&quot;");
        const dynamicMeta = `<meta name="fc:miniapp" content="${escaped}" />`;
        return html.replace(/<meta\s+name="fc:miniapp"[^>]*>/i, dynamicMeta);
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
