const SHARE_FOOTER = "#10XWarplets via @10XMemeX";

function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.!?;:]+$/g, "");
}

function normalizeShareUrl(value: string): string {
  const trimmed = trimUrlPunctuation(value.trim());
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch {
    return trimmed;
  }
}

function urlsInText(text: string): Set<string> {
  return new Set(
    (text.match(/https?:\/\/[^\s<>]+/gi) ?? []).map(normalizeShareUrl),
  );
}

export function buildSharePostText(text: string, links: string[]): string {
  const body = text.trim();
  const seen = urlsInText(body);
  const uniqueLinks: string[] = [];

  for (const link of links) {
    const trimmed = link.trim();
    if (!trimmed) continue;
    const normalized = normalizeShareUrl(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueLinks.push(trimmed);
  }

  return [body, ...uniqueLinks].filter(Boolean).join("\n\n");
}

export function buildTwitterShareText(text: string, links: string[]): string {
  const post = buildSharePostText(text, links);
  return [post, SHARE_FOOTER].filter(Boolean).join("\n\n");
}
