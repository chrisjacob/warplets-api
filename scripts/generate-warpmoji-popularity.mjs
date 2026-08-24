import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_URL = "https://www.unicode.org/emoji/frequency.html";
const OUTPUT = resolve(import.meta.dirname, "..", "migrations", "0056_warpmoji_review_workflow.sql");

const NAMED_ENTITIES = new Map([
  ["clubs", "♣"],
  ["diams", "♦"],
  ["harr", "↔"],
  ["hearts", "♥"],
  ["hellip", "…"],
  ["spades", "♠"],
  ["zwj", "\u200D"],
]);

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES.get(name.toLowerCase()) ?? match)
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

function canonicalizeEmoji(emoji) {
  return [...emoji.normalize("NFC")]
    .filter((part) => {
      const codepoint = part.codePointAt(0);
      return codepoint !== 0xfe0f && !(codepoint >= 0x1f3fb && codepoint <= 0x1f3ff);
    })
    .join("");
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Unicode frequency download failed (${response.status})`);
const html = await response.text();
const start = html.indexOf("Ranked Order by Median Frequency");
if (start < 0) throw new Error("Unicode frequency ranking table was not found");

const ranked = [];
const seen = new Set();
const rowPattern = /<tr>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
for (const match of html.slice(start).matchAll(rowPattern)) {
  const cell = decodeHtml(match[1]);
  for (const rawEmoji of cell.split(/\s+/u)) {
    const withoutEllipsis = rawEmoji.replaceAll("…", "");
    if (!withoutEllipsis) continue;
    const emoji = canonicalizeEmoji(withoutEllipsis);
    if (!emoji || seen.has(emoji)) continue;
    seen.add(emoji);
    ranked.push(emoji);
  }
}
if (ranked.length < 500) throw new Error(`Unicode frequency parsing returned only ${ranked.length} canonical emoji`);

const output = [
  "-- Adds an explicit review order from Unicode's ranked median emoji frequency table.",
  `-- Source: ${SOURCE_URL}`,
  "-- Re-run with: pnpm warpmoji:popularity",
  "ALTER TABLE warpmoji_emoji_groups ADD COLUMN popularity_rank INTEGER NOT NULL DEFAULT 1000000;",
  "CREATE INDEX IF NOT EXISTS idx_warpmoji_groups_popularity ON warpmoji_emoji_groups(popularity_rank, cldr_name);",
  ...ranked.map((emoji, index) => `UPDATE warpmoji_emoji_groups SET popularity_rank = ${index + 1} WHERE canonical_emoji = ${sql(emoji)};`),
  "",
];
writeFileSync(OUTPUT, output.join("\n"));
console.log(`Generated ${OUTPUT} with ${ranked.length.toLocaleString()} ranked canonical emoji.`);
