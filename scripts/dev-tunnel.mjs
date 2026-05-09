import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const WRANGLER_PORT = 9789;
const LOCALFLARE_PORT = 8890;
const repoRoot = process.cwd();
const PUBLIC_HEALTH_URL = "https://api-dev.10x.meme/__dev/health";
const STARTUP_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readHealthToken(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }

  const body = await res.json();
  if (!body || typeof body !== "object" || typeof body.token !== "string") {
    throw new Error(`${url} returned an invalid health payload`);
  }

  return body.token;
}

/** Wait until the local Wrangler health endpoint is up, then return its token. */
async function waitForLocalHealth(port) {
  const localHealthUrl = `http://127.0.0.1:${port}/__dev/health`;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await readHealthToken(localHealthUrl);
    } catch (error) {
      lastError = error;
      await sleep(RETRY_DELAY_MS);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Local Wrangler did not start on port ${port} within ${STARTUP_TIMEOUT_MS / 1000}s. ${detail}`,
  );
}

/** Verify the public hostname returns the same token as the local instance. */
async function waitForPublicHealthMatch(localToken) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const publicToken = await readHealthToken(PUBLIC_HEALTH_URL);
      if (publicToken === localToken) {
        return;
      }
      throw new Error(
        `api-dev.10x.meme is routing to a different Worker instance (token mismatch) — a deployed worker may be intercepting traffic`,
      );
    } catch (error) {
      lastError = error;
      await sleep(RETRY_DELAY_MS);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `api-dev.10x.meme did not match local Wrangler within ${STARTUP_TIMEOUT_MS / 1000}s. ${detail}`,
  );
}

function spawnWrangler(port) {
  const command = process.platform === "win32"
    ? `pnpm wrangler dev --env dev --port ${port}`
    : "pnpm";
  const args = process.platform === "win32"
    ? []
    : ["wrangler", "dev", "--env", "dev", "--port", String(port)];

  return spawn(command, args, {
    cwd: repoRoot,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function spawnCloudflared(port) {
  const executable = process.platform === "win32"
    ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
    : "cloudflared";
  const command = process.platform === "win32"
    ? `\"${executable}\" tunnel run --url http://127.0.0.1:${port} api-dev`
    : executable;
  const args = process.platform === "win32"
    ? []
    : ["tunnel", "run", "--url", `http://127.0.0.1:${port}`, "api-dev"];

  return spawn(command, args, {
    cwd: repoRoot,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function spawnLocalflare() {
  return spawn("pnpm", ["exec", "localflare", "--port", String(LOCALFLARE_PORT)], {
    cwd: repoRoot,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  await ensurePortAvailable(WRANGLER_PORT, "Wrangler");
  await ensurePortAvailable(LOCALFLARE_PORT, "Localflare");
  const port = WRANGLER_PORT;
  console.log("Stable dev URL:  https://api-dev.10x.meme");
  console.log(`Local Worker URL: http://127.0.0.1:${port}`);
  console.log(`Local dashboard API: http://localhost:${LOCALFLARE_PORT}`);
  console.log(`Local dashboard UI:  https://studio.localflare.dev?port=${LOCALFLARE_PORT}`);
  console.log(`Starting wrangler dev --env dev on :${port}...`);

  const wrangler = spawnWrangler(port);
  console.log("Starting Cloudflare Tunnel api-dev...");
  const tunnel = spawnCloudflared(port);
  console.log(`Starting Localflare dashboard on :${LOCALFLARE_PORT}...`);
  const localflare = spawnLocalflare();

  const shutdown = () => {
    wrangler.kill();
    tunnel.kill();
    localflare.kill();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", () => wrangler.kill());

  try {
    console.log("Waiting for local Wrangler to start...");
    const localToken = await waitForLocalHealth(port);
    console.log("Local Wrangler is up. Verifying tunnel routes to this instance...");
    await waitForPublicHealthMatch(localToken);
    console.log("✓ Tunnel check passed: api-dev.10x.meme is serving the local Wrangler instance.");
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    shutdown();
    process.exit(1);
  }

  wrangler.on("exit", (code) => {
    tunnel.kill();
    localflare.kill();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
