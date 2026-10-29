import { afterEach, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { LOCAL_PRIVATE_FILES, localPreviewSecurity, privatePreviewRequest } from "./localPreviewSecurity";

let server: ViteDevServer | undefined, fixture: string | undefined;
// /tmp is intentionally private to the preview guard. Use a public fixture
// location on Linux rather than weakening that guard to make the test pass.
const fixtureParent = process.env.RUNNER_TEMP ?? (/(?:^|[\\/])(?:tmp|\.tmp)(?:[\\/]|$)/i.test(tmpdir()) ? homedir() : tmpdir());
afterEach(async () => {
  await server?.close(); server = undefined;
  if (fixture) {
    const target = realpathSync(fixture), allowed = realpathSync(fixtureParent);
    if (dirname(target) !== allowed || !basename(target).startsWith("tenx-security-")) throw Error("Unsafe temporary fixture cleanup");
    rmSync(target, { recursive: true }); fixture = undefined;
  }
});
it("recognizes private files across encodings, case, separators and query variants", () => {
  for (const path of ["/.dev.vars", "/.DEV.VARS.local", "/.env", "/@fs/C:/repo/.tmp/private.json?raw", "/@fs/C:/repo/.wrangler/state/local.sqlite?url", "/public/.dev.vars?import", "/%2edev.vars", "/%252edev.vars", "/%2525252edev.vars", "/@fs/C:%5crepo%5c.dev.vars", "/repo/keys/private.pem", "/.git/config", "/private.db-wal", "/bad%zz", "/.dev.vars::$DATA", "/.dev.vars%20", "/.wrangler%20/state", "/@fs/C:/repo/DEV~1.VAR", "/null%00file"]) expect(privatePreviewRequest(path)).toBe(true);
  for (const path of ["/discover", "/backing", "/src/main.tsx", "/@fs/C:/repo/discovery/src/model.ts", "/@id/virtual:client-module", "/api/10x/identity/session", "/api/10x/admin/jobs", "/token/solana/mint?file=.dev.vars", "/src/private-model.ts"]) expect(privatePreviewRequest(path)).toBe(false);
});
it("blocks real HTTP reads of workspace and public private files while shared source still loads", async () => {
  fixture = mkdtempSync(join(fixtureParent, "tenx-security-"));
  const root = join(fixture, "app"), outside = join(fixture, "discovery");
  for (const directory of [join(root, "src"), join(root, "public"), outside, join(fixture, ".tmp"), join(fixture, ".wrangler")]) mkdirSync(directory, { recursive: true });
  const marker = "synthetic-private-value-never-serve";
  writeFileSync(join(root, "index.html"), "<h1>Public local preview</h1>");
  writeFileSync(join(root, "src/main.js"), 'export const publicSource = "readable";');
  writeFileSync(join(outside, "model.js"), 'export const sharedContract = true;');
  writeFileSync(join(outside, ".dev.vars"), `TENX_ADMIN_TOKEN=${marker}`);
  writeFileSync(join(root, ".env.local"), `SECRET=${marker}`);
  writeFileSync(join(root, "public/.dev.vars"), `SECRET=${marker}`);
  writeFileSync(join(fixture, ".tmp/private.json"), JSON.stringify({ private: marker }));
  writeFileSync(join(fixture, ".wrangler/state.sqlite"), marker);
  server = await createServer({ configFile: false, root, logLevel: "silent", plugins: [localPreviewSecurity()], optimizeDeps: { noDiscovery: true, include: [] }, server: { host: "127.0.0.1", port: 0, fs: { strict: true, allow: [fixture], deny: LOCAL_PRIVATE_FILES } } });
  await server.listen();
  const address = server.httpServer!.address(); if (!address || typeof address === "string") throw Error("Missing test port");
  const base = `http://127.0.0.1:${address.port}`, fsRoot = fixture.replaceAll("\\", "/");
  for (const path of ["/", "/src/main.js", `/@fs/${fsRoot}/discovery/model.js`]) expect((await fetch(base + path)).status).toBe(200);
  for (const path of ["/.dev.vars", "/.env.local", "/%2edev.vars", "/%252edev.vars", "/.dev.vars::$DATA", "/.dev.vars%20", "/__open-in-editor", `/@fs/${fsRoot}/discovery/.dev.vars`, `/@fs/${fsRoot}/discovery/.DEV.VARS`, `/@fs/${fsRoot}/.tmp/private.json`, `/@fs/${fsRoot}/.wrangler/state.sqlite`]) {
    for (const query of ["", "?raw", "?import", "?url", "?raw??", "?import&raw"]) {
      const r = await fetch(base + path + query); expect(r.status).toBe(403);
      const text = await r.text(); expect(text).not.toContain(marker); expect(text).not.toContain(fsRoot);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  }
});
