const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function encode58(bytes: Uint8Array) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b) break;
    out = "1" + out;
  }
  return out;
}
export function decode58(value: string, length?: number) {
  if (value.length > 128 || !value) throw Error("Invalid base58");
  let n = 0n;
  for (const c of value) {
    const i = alphabet.indexOf(c);
    if (i < 0) throw Error("Invalid base58");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of value) {
    if (c !== "1") break;
    out.unshift(0);
  }
  const bytes = Uint8Array.from(out);
  if (length && bytes.length !== length) throw Error("Invalid key length");
  if (encode58(bytes) !== value) throw Error("Non-canonical base58");
  return bytes;
}
