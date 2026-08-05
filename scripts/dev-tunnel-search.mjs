import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VITE_PORT = 5175;
const API_PORT = 8790;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../app");

const PUBLIC_URL = "https://search-local.10x.meme";
const LOCAL_MINIAPP_BASE_URL = PUBLIC_URL;
const LOCAL_APP_SESSION_SECRET = "search-local-only-session-secret-do-not-use-live-v1";

function applyLocalMigrations() {
  console.log("Applying pending local D1 migrations...");
  const result = spawnSync(
    "pnpm",
    ["wrangler", "d1", "migrations", "apply", "warplets", "--local"],
    {
      cwd: appDir,
      shell: process.platform === "win32",
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Local D1 migrations failed (${result.status ?? result.signal ?? "unknown"})`);
  }
}

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
  const command = "pnpm";
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
  const command = "pnpm";
  return spawn(command, [
    "wrangler",
    "pages",
    "dev",
    ".",
    "--port",
    String(port),
    "--binding",
    `APP_SESSION_SECRET=${LOCAL_APP_SESSION_SECRET}`,
  ], {
    cwd: appDir,
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
    ? `"${executable}" tunnel run --url http://127.0.0.1:${port} search-local`
    : executable;
  const args = process.platform === "win32"
    ? []
    : ["tunnel", "run", "--url", `http://127.0.0.1:${port}`, "search-local"];

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
      const res = await fetch(`http://127.0.0.1:${port}/search`);
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

async function warmStatsRoutes(port) {
  const routes = [
    "/api/stats/overview?range=all",
    "/api/stats/market?range=30d",
    "/api/stats/social?range=30d",
    "/api/stats/holders?limit=100",
  ];
  const results = await Promise.all(routes.map(async (route) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      return `${route} ${response.status}`;
    } catch (error) {
      return `${route} ${error instanceof Error ? error.message : String(error)}`;
    }
  }));
  console.log(`Stats routes warmed: ${results.join(", ")}`);
}

async function main() {
  await ensurePortAvailable(VITE_PORT, "Vite");
  await ensurePortAvailable(API_PORT, "API");
  applyLocalMigrations();

  console.log(`Stable dev URL: ${PUBLIC_URL}`);
  console.log(`Local dev URL:  http://localhost:${VITE_PORT}/search`);
  console.log(`Local API URL:  http://localhost:${API_PORT}`);
  console.log(`Embed launch URL: ${LOCAL_MINIAPP_BASE_URL}`);
  console.log("Starting app API worker...");

  let shuttingDown = false;
  let apiRestartTimer = null;
  let api;
  const startApi = () => {
    api = spawnApiWorker(API_PORT);
    api.on("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(`API worker exited unexpectedly (${signal ?? code ?? "unknown"}); restarting in 1 second...`);
      apiRestartTimer = setTimeout(startApi, 1_000);
    });
  };
  startApi();
  console.log("Starting vite dev...");
  const vite = spawnViteDev(VITE_PORT, API_PORT);
  console.log("Starting Cloudflare Tunnel search-local...");
  const tunnel = spawnCloudflared(VITE_PORT);

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (apiRestartTimer) clearTimeout(apiRestartTimer);
    api?.kill();
    vite.kill();
    tunnel.kill();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", shutdown);
  vite.on("exit", shutdown);

  try {
    await waitForApi(API_PORT);
    await waitForVite(VITE_PORT);
    await warmStatsRoutes(API_PORT);
    console.log(`OK Vite is up. Tunnel routing ${PUBLIC_URL} -> http://localhost:${VITE_PORT}`);
    console.log(`OK API worker is up on http://localhost:${API_PORT} and proxied from Vite /api`);
  } catch (error) {
    console.error("X", error.message);
    shutdown();
    process.exit(1);
  }
}

main();
