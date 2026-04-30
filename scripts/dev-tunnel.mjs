import { spawn } from "node:child_process";
import process from "node:process";

const PORT = 8789;
const repoRoot = process.cwd();

function spawnWrangler() {
  const command = process.platform === "win32"
    ? `pnpm wrangler dev --env dev --port ${PORT}`
    : "pnpm";
  const args = process.platform === "win32"
    ? []
    : ["wrangler", "dev", "--env", "dev", "--port", String(PORT)];

  return spawn(command, args, {
    cwd: repoRoot,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function spawnCloudflared() {
  const executable = process.platform === "win32"
    ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
    : "cloudflared";
  const command = process.platform === "win32"
    ? `\"${executable}\" tunnel run --url http://127.0.0.1:${PORT} api-dev`
    : executable;
  const args = process.platform === "win32"
    ? []
    : ["tunnel", "run", "--url", `http://127.0.0.1:${PORT}`, "api-dev"];

  return spawn(command, args, {
    cwd: repoRoot,
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
}

function spawnLocalflare() {
  return spawn("pnpm", ["localflare", "--port", "8790"], {
    cwd: repoRoot,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  console.log("Stable dev URL:  https://api-dev.10x.meme");
  console.log("Local dashboard API: http://localhost:8790");
  console.log("Local dashboard UI:  https://studio.localflare.dev?port=8790");
  console.log("Starting wrangler dev --env dev...");

  const wrangler = spawnWrangler();
  console.log("Starting Cloudflare Tunnel api-dev...");
  const tunnel = spawnCloudflared();
  console.log("Starting Localflare dashboard on :8790...");
  const localflare = spawnLocalflare();

  const shutdown = () => {
    wrangler.kill();
    tunnel.kill();
    localflare.kill();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  tunnel.on("exit", () => wrangler.kill());

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
