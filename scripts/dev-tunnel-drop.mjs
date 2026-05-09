import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VITE_PORT = 5174;
const API_PORT = 8789;
const LOCALFLARE_PORT = 8890;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../app");

const PUBLIC_URL = "https://drop-local.10x.meme";
const LOCAL_MINIAPP_BASE_URL = PUBLIC_URL;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function ensurePortAvailable(port, label) {
  const available = await isPortAvailable(port);
  if (!available) {
    throw new Error(`${label} port ${port} is already in use. Stop the conflicting process and retry.`);
  }
}

function spawnViteDev(port, apiPort) {
  const command = process.platform === "win32" ? "pnpm" : "pnpm";
  return spawn(command, ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: appDir,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_MINIAPP_BASE_URL: LOCAL_MINIAPP_BASE_URL,
      VITE_LOCAL_API_TARGET: `http://127.0.0.1:${apiPort}`,
    },
  });
}

function spawnApiWorker(port) {
  const command = process.platform === "win32" ? "pnpm" : "pnpm";
  return spawn(command, ["wrangler", "pages", "dev", ".", "--port", String(port)], {
    cwd: appDir,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function spawnLocalflare() {
  const command = process.platform === "win32" ? "pnpm" : "pnpm";
  return spawn(command, ["exec", "localflare", "--port", String(LOCALFLARE_PORT)], {
    cwd: path.resolve(appDir, ".."),
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function spawnCloudflared(port) {
  const executable =
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
      : "cloudflared";

  const command = process.platform === "win32"
    ? `"${executable}" tunnel run --url http://127.0.0.1:${port} drop-local`
    : executable;
  const args = process.platform === "win32"
    ? []
    : ["tunnel", "run", "--url", `http://127.0.0.1:${port}`, "drop-local"];

  return spawn(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVite(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok || res.status === 304) return;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new Error(`Vite did not start on port ${port} within 30s`);
}

async function waitForApi(port) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/actions`);
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new Error(`API worker did not start on port ${port} within 45s`);
}

async function main() {
  await ensurePortAvailable(VITE_PORT, "Vite");
  await ensurePortAvailable(API_PORT, "API");
  await ensurePortAvailable(LOCALFLARE_PORT, "Localflare");

  console.log(`Stable dev URL: ${PUBLIC_URL}`);
  console.log(`Local dev URL:  http://localhost:${VITE_PORT}`);
  console.log(`Local API URL:  http://localhost:${API_PORT}`);
  console.log(`Localflare UI:  https://studio.localflare.dev?port=${LOCALFLARE_PORT}`);
  console.log(`Embed launch URL: ${LOCAL_MINIAPP_BASE_URL}`);
  console.log("Starting app API worker...");

  const api = spawnApiWorker(API_PORT);
  console.log(`Starting Localflare on :${LOCALFLARE_PORT}...`);
  const localflare = spawnLocalflare();
  console.log("Starting vite dev...");
  const vite = spawnViteDev(VITE_PORT, API_PORT);
  console.log("Starting Cloudflare Tunnel drop-local...");
  const tunnel = spawnCloudflared(VITE_PORT);

  const shutdown = () => {
    api.kill();
    localflare.kill();
    vite.kill();
    tunnel.kill();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", shutdown);
  api.on("exit", shutdown);

  try {
    await waitForApi(API_PORT);
    await waitForVite(VITE_PORT);
    console.log(`OK Vite is up. Tunnel routing ${PUBLIC_URL} -> http://localhost:${VITE_PORT}`);
    console.log(`OK API worker is up on http://localhost:${API_PORT} and proxied from Vite /api`);
  } catch (error) {
    console.error("X", error.message);
    shutdown();
    process.exit(1);
  }
}

main();
