import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const ROOT = path.resolve(SCRIPT_DIR, "..");
const files = [path.join(ROOT, "wrangler.toml"), path.join(ROOT, "app", "wrangler.toml")];
const require = createRequire(import.meta.url);
const {
  ADVISORY_URL,
  BLOCKED_IOC_STRINGS,
  BLOCKED_PACKAGE_VERSIONS,
  getBlockedManifestReasons,
} = require("./security/blocked-npm-packages.cjs");

const npmSecurityFiles = [
  path.join(ROOT, "package.json"),
  path.join(ROOT, "pnpm-lock.yaml"),
  path.join(ROOT, "app", "package.json"),
  path.join(ROOT, "app", "pnpm-lock.yaml"),
  path.join(ROOT, "web", "package.json"),
  path.join(ROOT, "web", "pnpm-lock.yaml"),
];

const requiredSecrets = [
  "ACTION_SESSION_SECRET",
  "ADMIN_API_KEYS_JSON",
  "NEYNAR_API_KEY",
  "RESEND_API_KEY",
];

function parseBindings(content) {
  const ids = [...content.matchAll(/^\s*id\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  const dbIds = [...content.matchAll(/^\s*database_id\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  return { ids, dbIds };
}

function hasPlaceholder(values) {
  return values.some((value) => value.startsWith("REPLACE_WITH_"));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanNpmSecurityFile(file) {
  if (!fs.existsSync(file)) {
    return [];
  }

  const relativeFile = path.relative(ROOT, file);
  const content = fs.readFileSync(file, "utf8");
  const contentWithoutAllowedHardeningMetadata = content.replace(
    /^ignoredOptionalDependencies:\r?\n(?:\s+-\s+.*\r?\n)+/gm,
    "",
  );
  const findings = [];

  if (path.basename(file) === "package.json") {
    const pkg = JSON.parse(content);
    for (const reason of getBlockedManifestReasons(pkg)) {
      findings.push(`${relativeFile}: ${reason}`);
    }
  }

  for (const [name, versions] of Object.entries(BLOCKED_PACKAGE_VERSIONS)) {
    const escapedName = escapeRegex(name);
    for (const version of versions) {
      const escapedVersion = escapeRegex(version);
      const lockfilePattern = new RegExp(`${escapedName}@[^\\s:]*${escapedVersion}(?:\\)|:|\\s|$)`);
      const manifestPattern = new RegExp(`"${escapedName}"\\s*:\\s*"[^"]*\\b${escapedVersion}\\b[^"]*"`);
      if (lockfilePattern.test(content) || manifestPattern.test(content)) {
        findings.push(`${relativeFile}: blocked package ${name}@${version} from ${ADVISORY_URL}`);
      }
    }
  }

  for (const marker of BLOCKED_IOC_STRINGS) {
    if (contentWithoutAllowedHardeningMetadata.includes(marker)) {
      findings.push(`${relativeFile}: blocked Mini Shai-Hulud IoC marker "${marker}" from ${ADVISORY_URL}`);
    }
  }

  return findings;
}

let failed = false;

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const { ids, dbIds } = parseBindings(content);
  if (hasPlaceholder([...ids, ...dbIds])) {
    failed = true;
    console.error(`[security-preflight] Placeholder binding ID found in ${path.relative(ROOT, file)}.`);
  }
}

const appWrangler = fs.readFileSync(path.join(ROOT, "app", "wrangler.toml"), "utf8");
const appBindings = parseBindings(appWrangler);
if (new Set(appBindings.ids).size !== appBindings.ids.length) {
  failed = true;
  console.error("[security-preflight] Duplicate KV namespace IDs detected in app/wrangler.toml.");
}
if (new Set(appBindings.dbIds).size !== appBindings.dbIds.length) {
  failed = true;
  console.error("[security-preflight] Duplicate D1 database IDs detected in app/wrangler.toml.");
}

console.log("[security-preflight] Required environment secrets:");
for (const secret of requiredSecrets) {
  console.log(` - ${secret}`);
}
console.log("[security-preflight] Ensure each secret is scoped per environment (prod/preview/dev).");

for (const file of npmSecurityFiles) {
  const findings = scanNpmSecurityFile(file);
  for (const finding of findings) {
    failed = true;
    console.error(`[security-preflight] ${finding}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("[security-preflight] Passed.");
