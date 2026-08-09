import { brotliDecompressSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EMOJI_TEST_URL = "https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt";
const EMOJI_CACHE = join(ROOT, "tmp", "emoji-test-17.0.txt");
const FTS_DB = join(ROOT, "app", "public", "db", "warplets.v1.fts.sqlite.br");
const OUTPUT = join(ROOT, "migrations", "0052_warpmoji_catalog.sql");
const VERSION = "warpmoji-v1";
const MIN_SCORE = 0.55;

const SEMANTIC = {
  happy: ["happy", "smile", "smiling", "joy", "cheerful", "grin", "laugh"],
  sad: ["sad", "cry", "crying", "tear", "unhappy", "sorrow"],
  angry: ["angry", "rage", "mad", "furious", "annoyed"],
  love: ["love", "heart", "loving", "romance", "kiss"],
  cool: ["cool", "sunglasses", "shades", "confident"],
  nerd: ["nerd", "glasses", "smart", "brain", "geek"],
  money: ["money", "rich", "dollar", "cash", "gold", "wealth"],
  fire: ["fire", "flame", "hot", "burning"],
  fear: ["fear", "scared", "afraid", "scream", "shock"],
  sick: ["sick", "ill", "nausea", "vomit", "medical"],
  sleep: ["sleep", "sleepy", "tired", "dream", "bed"],
  party: ["party", "celebrate", "confetti", "birthday"],
  strong: ["strong", "muscle", "power", "fitness"],
  magic: ["magic", "wizard", "witch", "sparkle", "mystic"],
};

const COLOURS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "black", "white", "grey", "gray"];
const CONFLICTS = {
  happy: ["sad", "crying", "angry"], sad: ["happy", "smiling"],
  hot: ["cold", "ice"], cold: ["hot", "fire"],
  angel: ["devil", "demon"], devil: ["angel"],
};

function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function words(value) {
  return [...new Set(String(value).toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) ?? [])]
    .filter((word) => word.length > 1);
}
function canonicalizeEmoji(emoji) {
  return [...emoji.normalize("NFC")]
    .filter((part) => {
      const cp = part.codePointAt(0);
      return cp !== 0xfe0f && !(cp >= 0x1f3fb && cp <= 0x1f3ff);
    }).join("");
}
function codepoints(emoji) { return [...emoji].map((part) => part.codePointAt(0).toString(16).toUpperCase()).join("-"); }

async function emojiSource() {
  if (existsSync(EMOJI_CACHE)) return readFileSync(EMOJI_CACHE, "utf8");
  const response = await fetch(EMOJI_TEST_URL);
  if (!response.ok) throw new Error(`Unicode download failed (${response.status})`);
  const source = await response.text();
  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  writeFileSync(EMOJI_CACHE, source);
  return source;
}

function parseEmojiTest(source) {
  const groups = new Map();
  const rgiAliases = new Set();
  for (const line of source.split(/\r?\n/)) {
    if (!/;\s*(?:fully-qualified|component)\s*#/.test(line)) continue;
    const match = line.match(/^([0-9A-F ]+)\s*;\s*(fully-qualified|component)\s*#\s*(\S+)\s+E[0-9.]+\s+(.+)$/);
    if (!match) continue;
    const status = match[2];
    const emoji = match[3];
    rgiAliases.add(emoji);
    const canonical = canonicalizeEmoji(emoji) || emoji;
    const name = match[4].replace(/: (light|medium-light|medium|medium-dark|dark) skin tone(?:, )?/g, ": ").replace(/,? (light|medium-light|medium|medium-dark|dark) skin tone/g, "");
    const group = groups.get(canonical) ?? { canonical, name, aliases: new Set(), terms: new Set(), matchable: status !== "component" };
    group.aliases.add(emoji);
    group.aliases.add(emoji.replaceAll("\uFE0F", ""));
    for (const term of words(name)) group.terms.add(term);
    groups.set(canonical, group);
  }
  const parsed = [...groups.values()];
  const imported = new Set(parsed.flatMap((group) => [...group.aliases]));
  const missing = [...rgiAliases].filter((alias) => !imported.has(alias));
  if (missing.length) throw new Error(`Unicode catalog validation failed: ${missing.length} RGI aliases were omitted`);
  return { groups: parsed, rgiCount: rgiAliases.size };
}

function semanticTerms(baseTerms) {
  const result = new Set(baseTerms);
  for (const terms of Object.values(SEMANTIC)) {
    if (terms.some((term) => result.has(term))) for (const term of terms) result.add(term);
  }
  return [...result];
}

function scoreCandidate(row, terms, ftsRank) {
  const searchable = words([row.description, row.warplet_keywords, row.warplet_traits, row.warplet_colours].join(" "));
  const haystack = new Set(searchable);
  const direct = terms.filter((term) => haystack.has(term));
  const exact = Math.min(1, direct.length / Math.max(1, Math.min(3, terms.length)));
  const normalizedFts = Math.min(1, 1 / (1 + Math.abs(Number(ftsRank) || 0)) * 2);
  const semantic = Math.min(1, semanticTerms(terms).filter((term) => haystack.has(term)).length / 3);
  const hintTerms = terms.filter((term) => COLOURS.includes(term) || term.length >= 4);
  const hints = Math.min(1, hintTerms.filter((term) => haystack.has(term)).length / Math.max(1, Math.min(2, hintTerms.length)));
  let conflict = 0;
  for (const term of terms) {
    const opposites = CONFLICTS[term] ?? [];
    if (opposites.some((opposite) => haystack.has(opposite))) conflict = Math.max(conflict, 0.3);
  }
  const score = Math.max(0, Math.min(1, exact * 0.4 + normalizedFts * 0.3 + semantic * 0.2 + hints * 0.1 - conflict));
  const reasons = [
    ...direct.slice(0, 5).map((term) => `exact:${term}`),
    ...(semantic > exact ? ["semantic-synonym"] : []),
    ...(hints > 0 ? ["colour-or-object-hint"] : []),
    ...(conflict > 0 ? ["semantic-conflict"] : []),
  ];
  return { score, exact, normalizedFts, semantic, hints, conflict, reasons };
}

const source = await emojiSource();
const parsedEmoji = parseEmojiTest(source);
const groups = parsedEmoji.groups;
const tempDb = join(tmpdir(), `warpmoji-${process.pid}.sqlite`);
writeFileSync(tempDb, brotliDecompressSync(readFileSync(FTS_DB)));
const db = new DatabaseSync(tempDb, { readOnly: true });
const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
if (!table.includes("warplets") || !table.includes("warplets_fts")) throw new Error("Expected Warplets FTS tables were not found");

const fts = db.prepare(`SELECT w.id, w.description, w.warplet_keywords, w.warplet_traits, w.warplet_colours,
                              bm25(warplets_fts) AS fts_rank
                         FROM warplets_fts JOIN warplets w ON w.id = warplets_fts.rowid
                        WHERE warplets_fts MATCH ? ORDER BY fts_rank LIMIT 120`);
const output = [
  "-- Generated from Unicode Emoji 17.0 and app/public/db/warplets.v1.fts.sqlite.br.",
  "-- Re-run with: node scripts/generate-warpmoji-data.mjs", "PRAGMA foreign_keys = ON;",
];
const candidatesByGroup = new Map();
for (const group of groups) {
  const baseTerms = [...group.terms].filter((term) => !["face", "with", "and", "the", "button", "flag"].includes(term));
  output.push(`INSERT OR REPLACE INTO warpmoji_emoji_groups (canonical_emoji, cldr_name, keywords_json, unicode_version, updated_at) VALUES (${sql(group.canonical)}, ${sql(group.name)}, ${sql(JSON.stringify(semanticTerms(baseTerms)))}, '17.0', CURRENT_TIMESTAMP);`);
  for (const alias of group.aliases) {
    output.push(`INSERT OR REPLACE INTO warpmoji_emoji_aliases (alias, canonical_emoji, codepoints, is_rgi) VALUES (${sql(alias)}, ${sql(group.canonical)}, ${sql(codepoints(alias))}, 1);`);
  }
  if (!baseTerms.length || !group.matchable) continue;
  const query = baseTerms.slice(0, 8).map((term) => `\"${term}\"`).join(" OR ");
  let rows = [];
  try { rows = fts.all(query); } catch { rows = []; }
  const scored = rows.map((row) => ({ row, ...scoreCandidate(row, baseTerms, row.fts_rank) }))
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || Number(a.row.id) - Number(b.row.id))
    .slice(0, 30);
  candidatesByGroup.set(group.canonical, scored);
}

const primary = new Map();
const all = [...candidatesByGroup.entries()].flatMap(([emoji, list]) => list.map((candidate) => ({ emoji, ...candidate })))
  .sort((a, b) => b.score - a.score);
for (const candidate of all) if (!primary.has(candidate.row.id)) primary.set(candidate.row.id, candidate.emoji);

const secondaryCounts = new Map();
for (const [emoji, list] of candidatesByGroup) {
  let count = 0;
  for (const candidate of list) {
    const primaryEmoji = primary.get(candidate.row.id);
    const assignment = primaryEmoji === emoji ? "primary" : "secondary";
    const primaryScore = all.find((item) => item.row.id === candidate.row.id && item.emoji === primaryEmoji)?.score ?? 1;
    if (assignment === "secondary" && (count >= 10 || candidate.score < primaryScore * 0.9 || (secondaryCounts.get(candidate.row.id) ?? 0) >= 2)) continue;
    output.push(`INSERT OR REPLACE INTO warpmoji_candidates (canonical_emoji, token_id, score, exact_score, fts_score, semantic_score, hint_score, conflict_penalty, reasons_json, status, assignment, scoring_version, updated_at) VALUES (${sql(emoji)}, ${Number(candidate.row.id)}, ${candidate.score.toFixed(4)}, ${candidate.exact.toFixed(4)}, ${candidate.normalizedFts.toFixed(4)}, ${candidate.semantic.toFixed(4)}, ${candidate.hints.toFixed(4)}, ${candidate.conflict.toFixed(4)}, ${sql(JSON.stringify(candidate.reasons))}, 'suggested', ${sql(assignment)}, '${VERSION}', CURRENT_TIMESTAMP);`);
    count += 1;
    if (assignment === "secondary") secondaryCounts.set(candidate.row.id, (secondaryCounts.get(candidate.row.id) ?? 0) + 1);
  }
  output.push(`UPDATE warpmoji_emoji_groups SET candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ${sql(emoji)}), approved_count = (SELECT COUNT(*) FROM warpmoji_candidates WHERE canonical_emoji = ${sql(emoji)} AND status = 'approved') WHERE canonical_emoji = ${sql(emoji)};`);
}
output.push("");
db.close();
unlinkSync(tempDb);
writeFileSync(OUTPUT, output.join("\n"));
console.log(`Generated ${OUTPUT} with all ${parsedEmoji.rgiCount.toLocaleString()} RGI aliases, ${groups.length} canonical pools and ${output.length.toLocaleString()} statements.`);
