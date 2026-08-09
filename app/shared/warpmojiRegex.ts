function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

type Trie = { terminal: boolean; children: Map<string, Trie> };

function triePattern(values: readonly string[]): string {
  const root: Trie = { terminal: false, children: new Map() };
  for (const value of values) {
    let node = root;
    for (const part of [...value]) {
      if (!node.children.has(part)) node.children.set(part, { terminal: false, children: new Map() });
      node = node.children.get(part)!;
    }
    node.terminal = true;
  }
  const render = (node: Trie): string => {
    const branches = [...node.children.entries()].map(([part, child]) => `${escapeRegex(part)}${render(child)}`);
    if (!branches.length) return "";
    const body = branches.length === 1 ? branches[0] : `(?:${branches.join("|")})`;
    return node.terminal ? `(?:${body})?` : body;
  };
  return render(root);
}

function singleCodepointPattern(values: readonly string[]): string | null {
  const points = [...new Set(values.map((value) => value.codePointAt(0)!))].sort((a, b) => a - b);
  if (!points.length) return null;
  const ranges: Array<[number, number]> = [];
  for (const point of points) {
    const last = ranges.at(-1);
    if (last && point === last[1] + 1) last[1] = point;
    else ranges.push([point, point]);
  }
  return `[${ranges.map(([start, end]) => start === end ? escapeRegex(String.fromCodePoint(start)) : `${escapeRegex(String.fromCodePoint(start))}-${escapeRegex(String.fromCodePoint(end))}`).join("")}]`;
}

export function buildWarpmojiRegexShards(aliases: readonly string[], size = 75): string[] {
  const unique = [...new Set(aliases.map((alias) => alias.trim().normalize("NFC")).filter(Boolean))]
    .sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)! || a.localeCompare(b));
  const shards: string[] = [];
  for (let offset = 0; offset < unique.length; offset += Math.max(1, Math.min(75, size))) {
    const slice = unique.slice(offset, offset + Math.max(1, Math.min(75, size)));
    const singles = slice.filter((alias) => [...alias].length === 1);
    const multi = slice.filter((alias) => [...alias].length > 1);
    const patterns = [singleCodepointPattern(singles), multi.length ? triePattern(multi) : null].filter(Boolean);
    shards.push(`^(?:${patterns.join("|")})$`);
  }
  return shards;
}

