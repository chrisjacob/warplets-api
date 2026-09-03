import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VITE_PORT = 5177;
const API_PORT = 8792;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../app");

const PUBLIC_URL = "https://stonklet-local.10x.meme";
const LOCAL_APP_SESSION_SECRET = "stonklet-local-only-session-secret-do-not-use-live-v1";
const LOCAL_ACTION_SESSION_SECRET = "stonklet-local-only-action-secret-do-not-use-live-v1";
const STONKLETS_TUNNEL = process.env.STONKLETS_TUNNEL_ID?.trim() || "stonklet-local";
const STONKLETS_TUNNEL_CREDENTIALS_FILE =
  process.env.STONKLETS_TUNNEL_CREDENTIALS_FILE?.trim() || "";

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
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function ensurePortAvailable(port, label) {
  if (!await isPortAvailable(port)) {
    throw new Error(`${label} port ${port} is already in use. Stop the conflicting process and retry.`);
  }
}

function spawnViteDev() {
  return spawn("pnpm", ["vite", "--host", "127.0.0.1", "--port", String(VITE_PORT), "--strictPort"], {
    cwd: appDir,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_MINIAPP_BASE_URL: PUBLIC_URL,
      VITE_LOCAL_API_TARGET: `http://127.0.0.1:${API_PORT}`,
    },
  });
}

function spawnApiWorker() {
  const args = [
    "wrangler",
    "pages",
    "dev",
    ".",
    "--port",
    String(API_PORT),
    "--binding",
    `APP_SESSION_SECRET=${LOCAL_APP_SESSION_SECRET}`,
    "--binding",
    `ACTION_SESSION_SECRET=${LOCAL_ACTION_SESSION_SECRET}`,
    "--binding",
    "BASE_NOTIFICATIONS_ENABLED=false",
    "--binding",
    "EMAIL_AUDIENCE_MUTATIONS_ENABLED=false",
    "--binding",
    "RESEND_ONBOARDING_ENABLED=false",
  ];
  const accountAssociation = process.env.STONKLETS_ACCOUNT_ASSOCIATION_JSON?.trim();
  if (accountAssociation) {
    args.push("--binding", `STONKLETS_ACCOUNT_ASSOCIATION_JSON=${accountAssociation}`);
  }
  for (const name of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    const value = process.env[name]?.trim();
    if (value) args.push("--binding", `${name}=${value}`);
  }
  return spawn("pnpm", args, {
    cwd: appDir,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function spawnCloudflared() {
  const executable = process.platform === "win32"
    ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
    : "cloudflared";
  const args = ["tunnel", "run"];
  if (STONKLETS_TUNNEL_CREDENTIALS_FILE) {
    args.push("--credentials-file", STONKLETS_TUNNEL_CREDENTIALS_FILE);
  }
  args.push("--url", `http://127.0.0.1:${VITE_PORT}`, STONKLETS_TUNNEL);
  return spawn(executable, args, { shell: false, stdio: "inherit", env: process.env });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // The local service is still starting.
    }
    await sleep(500);
  }
  throw new Error(`${label} did not start within ${Math.round(timeoutMs / 1000)}s`);
}

async function smokeTest() {
  const marketResponse = await fetch(`http://127.0.0.1:${API_PORT}/api/stonklets/market`);
  const market = await marketResponse.json();
  const favouritesResponse = await fetch(`http://127.0.0.1:${API_PORT}/api/stonklet-favourites`);
  console.log(
    `OK Local smoke: market=${marketResponse.status} entries=${Array.isArray(market.entries) ? market.entries.length : 0}, favourites=${favouritesResponse.status}`,
  );
}

async function main() {
  await ensurePortAvailable(VITE_PORT, "Vite");
  await ensurePortAvailable(API_PORT, "API");
  applyLocalMigrations();

  console.log(`Tunnel URL:    ${PUBLIC_URL}`);
  console.log(`Local app:    http://localhost:${VITE_PORT}/stonklets`);
  console.log(`Local API:    http://localhost:${API_PORT}`);
  console.log("Notifications and live email audience mutations are disabled locally.");

  let shuttingDown = false;
  let apiRestartTimer;
  let api;
  const startApi = () => {
    api = spawnApiWorker();
    api.on("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(`API worker exited (${signal ?? code ?? "unknown"}); restarting in 1 second...`);
      apiRestartTimer = setTimeout(startApi, 1_000);
    });
  };

  startApi();
  const vite = spawnViteDev();
  const tunnel = spawnCloudflared();

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
    await waitFor(`http://127.0.0.1:${API_PORT}/api/stonklets/market`, "Pages Functions");
    await waitFor(`http://127.0.0.1:${VITE_PORT}/stonklets`, "Vite");
    await smokeTest();
    console.log(`OK Tunnel routing ${PUBLIC_URL} -> http://127.0.0.1:${VITE_PORT}`);
  } catch (error) {
    console.error("X", error instanceof Error ? error.message : String(error));
    shutdown();
    process.exit(1);
  }
}

main();
