import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VITE_PORT = 5178;
const API_PORT = 8793;
const PREVIEW_PORT = 8794;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../app");

const PUBLIC_URL = "https://social-local.10x.meme";
const LOCAL_APP_SESSION_SECRET =
  process.env.APP_SESSION_SECRET || randomBytes(48).toString("hex");
const LOCAL_ACTION_SESSION_SECRET =
  process.env.ACTION_SESSION_SECRET || randomBytes(48).toString("hex");
const SOCIAL_TUNNEL = process.env.SOCIAL_TUNNEL_ID?.trim() || "social-local";
const SOCIAL_TUNNEL_CREDENTIALS_FILE =
  process.env.SOCIAL_TUNNEL_CREDENTIALS_FILE?.trim() || "";

function applyLocalMigrations() {
  console.log("Applying pending local D1 migrations...");
  const result = spawnSync(
    process.execPath,
    [
      path.join(appDir, "node_modules/wrangler/bin/wrangler.js"),
      "d1",
      "migrations",
      "apply",
      "warplets",
      "--local",
    ],
    {
      cwd: appDir,
      shell: false,
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Local D1 migrations failed (${result.status ?? result.signal ?? "unknown"})`,
    );
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
  if (!(await isPortAvailable(port))) {
    throw new Error(
      `${label} port ${port} is already in use. Stop the conflicting process and retry.`,
    );
  }
}

function spawnViteDev() {
  return spawn(
    process.execPath,
    [
      path.join(appDir, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(VITE_PORT),
      "--strictPort",
    ],
    {
      cwd: appDir,
      shell: false,
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_MINIAPP_BASE_URL: PUBLIC_URL,
        VITE_LOCAL_API_TARGET: `http://127.0.0.1:${API_PORT}`,
      },
    },
  );
}

function spawnApiWorker() {
  const args = [
    path.join(appDir, "node_modules/wrangler/bin/wrangler.js"),
    "pages",
    "dev",
    "dist",
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
  const accountAssociation =
    process.env.SOCIAL_ACCOUNT_ASSOCIATION_JSON?.trim();
  if (accountAssociation) {
    args.push(
      "--binding",
      `SOCIAL_ACCOUNT_ASSOCIATION_JSON=${accountAssociation}`,
    );
  }
  for (const name of [
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ]) {
    const value = process.env[name]?.trim();
    if (value) args.push("--binding", `${name}=${value}`);
  }
  return spawn(process.execPath, args, {
    cwd: appDir,
    shell: false,
    stdio: "inherit",
    env: process.env,
  });
}

function spawnCloudflared() {
  const executable =
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
      : "cloudflared";
  const args = ["tunnel", "run"];
  if (SOCIAL_TUNNEL_CREDENTIALS_FILE) {
    args.push("--credentials-file", SOCIAL_TUNNEL_CREDENTIALS_FILE);
  }
  args.push("--url", `http://127.0.0.1:${PREVIEW_PORT}`, SOCIAL_TUNNEL);
  return spawn(executable, args, {
    shell: false,
    stdio: "inherit",
    env: process.env,
  });
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
  throw new Error(
    `${label} did not start within ${Math.round(timeoutMs / 1000)}s`,
  );
}

async function smokeTest() {
  const response = await fetch(
    `http://127.0.0.1:${API_PORT}/api/social/config`,
  );
  if (!response.ok)
    throw new Error(`Social API readiness failed (${response.status})`);
  console.log("Social API ready; Base mainnet is used for check-ins.");
}

async function main() {
  await ensurePortAvailable(VITE_PORT, "Vite");
  await ensurePortAvailable(API_PORT, "API");
  await ensurePortAvailable(PREVIEW_PORT, "Compiled preview");
  const build = spawnSync(
    process.execPath,
    [path.join(appDir, "node_modules/vite/bin/vite.js"), "build"],
    { cwd: appDir, stdio: "inherit", shell: false },
  );
  if (build.status !== 0)
    throw new Error("Compile the app before exposing the preview");
  applyLocalMigrations();

  console.log(`Tunnel URL:    ${PUBLIC_URL}`);
  console.log(`Local app:    http://localhost:${VITE_PORT}/social`);
  console.log(`Local API:    http://localhost:${API_PORT}`);
  console.log(
    "Notifications and live email audience mutations are disabled locally.",
  );

  let shuttingDown = false;
  let apiRestartTimer;
  let api;
  const startApi = () => {
    api = spawnApiWorker();
    api.on("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(
        `API worker exited (${signal ?? code ?? "unknown"}); restarting in 1 second...`,
      );
      apiRestartTimer = setTimeout(startApi, 1_000);
    });
  };

  startApi();
  const vite = spawnViteDev();
  const preview = spawn(
    process.execPath,
    [path.join(__dirname, "social-preview.mjs")],
    { cwd: appDir, shell: false, stdio: "inherit" },
  );
  const tunnel = spawnCloudflared();

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (apiRestartTimer) clearTimeout(apiRestartTimer);
    api?.kill();
    vite.kill();
    preview.kill();
    tunnel.kill();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", shutdown);
  vite.on("exit", shutdown);
  preview.on("exit", shutdown);

  try {
    await waitFor(
      `http://127.0.0.1:${API_PORT}/api/social/config`,
      "Pages Functions",
    );
    await waitFor(`http://127.0.0.1:${VITE_PORT}/social`, "Vite");
    await smokeTest();
    console.log(
      `OK Restricted compiled preview ${PUBLIC_URL} -> http://127.0.0.1:${PREVIEW_PORT}. Vite remains private on ${VITE_PORT}.`,
    );
  } catch (error) {
    console.error("X", error instanceof Error ? error.message : String(error));
    shutdown();
    process.exit(1);
  }
}

main();
