import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ["app-local.10x.meme"],
    proxy: {
      // Proxy API calls to the deployed dev environment so functions work locally
      "/api": "https://app-dev.10x.meme",
    },
  },
});
