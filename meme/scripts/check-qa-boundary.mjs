import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
const directory = resolve(import.meta.dirname, "../dist/assets");
const forbidden = [
  "tenx-ui-seed-v1",
  "2000000001",
  "Preparing your QA world",
  "meme_qa_session",
  "Simulate buy",
  "Demo clock paused",
  "QA backend unavailable",
  "QA share preview",
  "Connect · fixture",
  "A daily ritual.",
];
for (const name of readdirSync(directory).filter((name) =>
  name.endsWith(".js"),
)) {
  const data = readFileSync(join(directory, name), "utf8");
  for (const needle of forbidden)
    if (data.includes(needle))
      throw Error(
        "QA simulator entered production bundle: " + name + " (" + needle + ")",
      );
}
console.log(
  "Seed data, demo accounts and simulation UI are excluded from production JavaScript.",
);
