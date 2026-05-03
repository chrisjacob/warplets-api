import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "miniapp-meta-query-pass-through",
      apply: "serve",
      transformIndexHtml(html, ctx) {
        const reqUrl = ctx?.originalUrl ?? ctx?.path ?? "/";
        const query = reqUrl.includes("?") ? reqUrl.slice(reqUrl.indexOf("?")) : "";
        const baseUrl = process.env.VITE_MINIAPP_BASE_URL?.replace(/\/$/, "") || "";
        if (!baseUrl) return html;

        const payload = {
          version: "1",
          imageUrl: `${baseUrl}/embed.png`,
          button: {
            title: "Open 10X",
            action: {
              type: "launch_miniapp",
              name: "10X",
              url: `${baseUrl}/${query}`,
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
    allowedHosts: ["app-local.10x.meme"],
    proxy: {
      // Proxy API calls to the deployed dev environment so functions work locally
      "/api": "https://app-dev.10x.meme",
    },
  },
});
