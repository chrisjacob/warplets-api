import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
const root = resolve(import.meta.dirname, "..");
function check(directory, packageRoot) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      check(file, packageRoot);
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g,
    )) {
      const specifier = match[1];
      if (/(?:^|\/)(?:discovery|network)(?:\/|$)/.test(specifier))
        throw Error(`Archived/analytics runtime import in ${file}`);
      if (
        specifier.startsWith(".") &&
        !resolve(dirname(file), specifier).startsWith(packageRoot + sep)
      )
        throw Error(`Relative import escapes its reviewed package: ${file}`);
    }
  }
}
check(resolve(root, "src"), root);
const connectRoot = resolve(root, "../packages/connect");
check(resolve(connectRoot, "src"), connectRoot);
console.log(
  "Launchpad and shared Connect imports stay inside their reviewed package boundaries.",
);
