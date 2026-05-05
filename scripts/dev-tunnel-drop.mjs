import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 5174;
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

async function findAvailablePort(startPort) {
  let port = startPort;
  while (port < startPort + 100) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port);
    if (available) return port;
    port += 1;
  }

  throw new Error(`Could not find an available port starting at ${startPort}`);
}

function spawnViteDev(port) {
  const command = process.platform === "win32" ? "pnpm" : "pnpm";
  return spawn(command, ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: appDir,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_MINIAPP_BASE_URL: LOCAL_MINIAPP_BASE_URL,
    },
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

async function main() {
  const port = await findAvailablePort(DEFAULT_PORT);

  console.log(`Stable dev URL: ${PUBLIC_URL}`);
  console.log(`Local dev URL:  http://localhost:${port}`);
  console.log(`Embed launch URL: ${LOCAL_MINIAPP_BASE_URL}`);
  console.log("Starting vite dev...");

  const vite = spawnViteDev(port);
  console.log("Starting Cloudflare Tunnel drop-local...");
  const tunnel = spawnCloudflared(port);

  const shutdown = () => {
    vite.kill();
    tunnel.kill();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", () => vite.kill());

  try {
    await waitForVite(port);
    console.log(`✓ Vite is up. Tunnel routing ${PUBLIC_URL} → http://localhost:${port}`);
  } catch (error) {
    console.error("✗", error.message);
  }
}

main();
