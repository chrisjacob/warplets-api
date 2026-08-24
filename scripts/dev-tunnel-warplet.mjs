import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VITE_PORT = 5175;
const API_PORT = 8790;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../app");

const PUBLIC_URL = "https://warplet-local.10x.meme";
const LOCAL_MINIAPP_BASE_URL = PUBLIC_URL;
const LOCAL_APP_SESSION_SECRET = "warplet-local-only-session-secret-do-not-use-live-v1";
const LOCAL_ACTION_SESSION_SECRET = "warplet-local-only-action-secret-do-not-use-live-v1";
const LOCAL_EMAIL_AUDIENCE_MUTATIONS_ENABLED = /^(1|true|yes)$/i.test(
  process.env.LOCAL_EMAIL_AUDIENCE_MUTATIONS?.trim() || "",
);
const WARPLETS_TUNNEL = process.env.WARPLETS_TUNNEL_ID?.trim() || "warplet-local";
const WARPLETS_TUNNEL_CREDENTIALS_FILE =
  process.env.WARPLETS_TUNNEL_CREDENTIALS_FILE?.trim() || "";

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
  const args = [
    "wrangler",
    "pages",
    "dev",
    ".",
    "--port",
    String(port),
    "--binding",
    `APP_SESSION_SECRET=${LOCAL_APP_SESSION_SECRET}`,
    "--binding",
    `ACTION_SESSION_SECRET=${LOCAL_ACTION_SESSION_SECRET}`,
    "--binding",
    `EMAIL_AUDIENCE_MUTATIONS_ENABLED=${LOCAL_EMAIL_AUDIENCE_MUTATIONS_ENABLED}`,
  ];
  const accountAssociation = process.env.WARPLETS_ACCOUNT_ASSOCIATION_JSON?.trim();
  if (accountAssociation) {
    args.push("--binding", `WARPLETS_ACCOUNT_ASSOCIATION_JSON=${accountAssociation}`);
  }
  for (const name of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    const value = process.env[name]?.trim();
    if (value) args.push("--binding", `${name}=${value}`);
  }
  return spawn(command, args, {
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

  const args = ["tunnel", "run"];
  if (WARPLETS_TUNNEL_CREDENTIALS_FILE) {
    args.push("--credentials-file", WARPLETS_TUNNEL_CREDENTIALS_FILE);
  }
  args.push("--url", `http://127.0.0.1:${port}`, WARPLETS_TUNNEL);

  return spawn(executable, args, {
    shell: false,
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
      const res = await fetch(`http://127.0.0.1:${port}/warplets`);
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
  console.log(`Local dev URL:  http://localhost:${VITE_PORT}/warplets`);
  console.log(`Local API URL:  http://localhost:${API_PORT}`);
  console.log(`Embed launch URL: ${LOCAL_MINIAPP_BASE_URL}`);
  console.log("Starting app API worker...");
  console.log(
    `Live Resend audience mutations: ${LOCAL_EMAIL_AUDIENCE_MUTATIONS_ENABLED ? "explicitly enabled" : "disabled (set LOCAL_EMAIL_AUDIENCE_MUTATIONS=true to opt in)"}`,
  );

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
  console.log(`Starting Cloudflare Tunnel ${WARPLETS_TUNNEL}...`);
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
