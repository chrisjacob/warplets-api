import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const appDir = resolve(repoRoot, "app");
const wranglerPath = resolve(appDir, "wrangler.toml");
const target = process.argv[2];

const targets = {
  dev: {
    projectName: "10x-app-dev",
    branch: "dev",
    databaseName: "warplets_preview",
    databaseId: "4ed108bd-9477-4109-930c-bc57b6c11b1f",
    kvNamespaceId: "bb4b4762d0de4266bcccb0b2e1bdedbc",
  },
  prod: {
    projectName: "10x-app",
    branch: "main",
    databaseName: "warplets",
    databaseId: "45a4cc4c-788e-48dd-89bf-7b504b17655d",
    kvNamespaceId: "3f55e9bea2534955b833521a2f5b55e7",
  },
};

if (!targets[target]) {
  console.error("Usage: node scripts/pages-deploy-app.mjs <dev|prod>");
  process.exit(1);
}

function buildWranglerConfig(config) {
  return `name = "${config.projectName}"
pages_build_output_dir = "dist"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
# Farcaster FID of each registered mini-app - used to scope notification tokens
# to the correct app_slug. Not sensitive (public Farcaster account IDs).
APP_APP_FID = "9152"
# DROP_APP_FID = "?????"    # add once observed in webhook events for Drop

[[kv_namespaces]]
binding = "WARPLETS_KV"
id = "${config.kvNamespaceId}"

[[d1_databases]]
binding       = "WARPLETS"
database_name = "${config.databaseName}"
database_id   = "${config.databaseId}"
migrations_dir = "../migrations"
`;
}

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const isWindows = process.platform === "win32";
    const child = spawn(isWindows ? (process.env.ComSpec ?? "cmd.exe") : command, isWindows ? ["/d", "/s", "/c", [command, ...args].map(quoteShellArg).join(" ")] : args, {
      cwd: appDir,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

const config = targets[target];
const original = await readFile(wranglerPath, "utf8");

try {
  await writeFile(wranglerPath, buildWranglerConfig(config), "utf8");
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  await run(pnpm, [
    "exec",
    "wrangler",
    "pages",
    "deploy",
    "dist",
    "--project-name",
    config.projectName,
    "--branch",
    config.branch,
  ]);
} finally {
  await writeFile(wranglerPath, original, "utf8");
}
