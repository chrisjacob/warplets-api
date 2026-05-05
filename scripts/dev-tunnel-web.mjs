import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4174;
const PUBLIC_URL = "https://web-local.10x.meme";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "../web");

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

function spawnWebDev(port) {
  const command = process.platform === "win32" ? "pnpm" : "pnpm";
  return spawn(
    command,
    ["dlx", "wrangler", "pages", "dev", ".", "--port", String(port)],
    {
      cwd: webDir,
      shell: process.platform === "win32",
      stdio: "inherit",
      env: process.env,
    }
  );
}

function spawnCloudflared(port) {
  const executable =
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
      : "cloudflared";

  const command =
    process.platform === "win32"
      ? `"${executable}" tunnel run --url http://127.0.0.1:${port} web-local`
      : executable;

  const args =
    process.platform === "win32"
      ? []
      : ["tunnel", "run", "--url", `http://127.0.0.1:${port}`, "web-local"];

  return spawn(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  const port = await findAvailablePort(DEFAULT_PORT);

  console.log(`Stable dev URL: ${PUBLIC_URL}`);
  console.log(`Local dev URL:  http://localhost:${port}`);
  console.log("Starting web dev server...");

  const web = spawnWebDev(port);
  console.log("Starting Cloudflare Tunnel web-local...");
  const tunnel = spawnCloudflared(port);

  const shutdown = () => {
    web.kill();
    tunnel.kill();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", () => web.kill());
}

main();
