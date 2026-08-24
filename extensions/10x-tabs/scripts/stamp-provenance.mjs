import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const commit = process.env.SOURCE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("SOURCE_COMMIT must be a full Git commit SHA");
writeFileSync(resolve("provenance.json"), `${JSON.stringify({ sourceCommit: commit }, null, 2)}\n`, "utf8");
