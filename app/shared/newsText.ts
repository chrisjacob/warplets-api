/** Extract display text, never HTML. Decode entities exactly once. */
export function newsText(value: string): string {
  const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, key: string) => {
      if (!key.startsWith('#')) return names[key.toLowerCase()] ?? entity;
      const code = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/[<>\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
