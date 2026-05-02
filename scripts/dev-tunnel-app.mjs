import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PORT = 5173;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../app");

const PUBLIC_URL = "https://app-local.10x.meme";
const LOCAL_MINIAPP_BASE_URL = PUBLIC_URL;

function spawnViteDev() {
  const command = process.platform === "win32" ? "pnpm" : "pnpm";
  return spawn(command, ["vite", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: appDir,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_MINIAPP_BASE_URL: LOCAL_MINIAPP_BASE_URL,
    },
  });
}

function spawnCloudflared() {
  const executable =
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
      : "cloudflared";

  const command = process.platform === "win32"
    ? `"${executable}" tunnel run --url http://127.0.0.1:${PORT} app-local`
    : executable;
  const args = process.platform === "win32"
    ? []
    : ["tunnel", "run", "--url", `http://127.0.0.1:${PORT}`, "app-local"];

  return spawn(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok || res.status === 304) return;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new Error(`Vite did not start on port ${PORT} within 30s`);
}

async function main() {
  console.log(`Stable dev URL: ${PUBLIC_URL}`);
  console.log(`Local dev URL:  http://localhost:${PORT}`);
  console.log(`Embed launch URL: ${LOCAL_MINIAPP_BASE_URL}`);
  console.log("Starting vite dev...");

  const vite = spawnViteDev();
  console.log("Starting Cloudflare Tunnel app-local...");
  const tunnel = spawnCloudflared();

  const shutdown = () => {
    vite.kill();
    tunnel.kill();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", () => vite.kill());

  try {
    await waitForVite();
    console.log(`✓ Vite is up. Tunnel routing ${PUBLIC_URL} → http://localhost:${PORT}`);
  } catch (error) {
    console.error("✗", error.message);
  }
}

main();
