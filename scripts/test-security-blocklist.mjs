import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  getBlockedManifestReasons,
  getBlockedPackageReason,
  getBlockedSpecifierReason,
} = require("./security/blocked-npm-packages.cjs");

assert.match(
  getBlockedPackageReason("@tanstack/react-router", "1.169.5") ?? "",
  /@tanstack\/react-router@1\.169\.5/,
);

assert.match(
  getBlockedSpecifierReason("@tanstack/setup", "github:tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c") ?? "",
  /blocked source marker|IoC package name/,
);

assert.deepEqual(
  getBlockedManifestReasons({
    name: "clean-fixture",
    version: "1.0.0",
    dependencies: { hono: "^4.12.12" },
  }),
  [],
);

assert.equal(getBlockedPackageReason("@tanstack/react-router", "1.169.6"), null);

console.log("[security-blocklist] Passed.");
