"use strict";

const { ADVISORY_URL, getBlockedManifestReasons } = require("./scripts/security/blocked-npm-packages.cjs");

function assertAllowedPackage(pkg) {
  const reasons = getBlockedManifestReasons(pkg);
  if (reasons.length > 0) {
    throw new Error(
      [
        "Blocked npm package from Mini Shai-Hulud advisory.",
        ...reasons.map((reason) => ` - ${reason}`),
        `Advisory: ${ADVISORY_URL}`,
      ].join("\n"),
    );
  }
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      assertAllowedPackage(pkg);
      return pkg;
    },
  },
};
