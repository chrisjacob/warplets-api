import { ed25519 } from "@noble/curves/ed25519.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function fromBase58(value: string, maxBytes = 2048): Uint8Array {
  if (!value || value.length > maxBytes * 2) throw new Error("invalid_base58");
  let n = 0n;
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("invalid_base58");
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.push(Number(n & 255n)); n >>= 8n; }
  for (const char of value) { if (char !== "1") break; bytes.push(0); }
  if (bytes.length > maxBytes) throw new Error("base58_too_large");
  return Uint8Array.from(bytes.reverse());
}
export function toBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let result = "";
  while (n > 0n) { result = ALPHABET[Number(n % 58n)] + result; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = "1" + result; }
  return result;
}
export function publicKey(value: string): Uint8Array {
  const bytes = fromBase58(value, 32);
  if (bytes.length !== 32) throw new Error("invalid_public_key");
  return bytes;
}
export function validAddress(value: string): boolean {
  try { publicKey(value); return true; } catch { return false; }
}
export function bytesEqual(a: Uint8Array, b: readonly number[]): boolean {
  return a.length >= b.length && b.every((v, i) => a[i] === v);
}
export function base64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
}
export async function hashJson(value: unknown): Promise<string> {
  return hashBytes(new TextEncoder().encode(JSON.stringify(value)));
}
export async function findPda(program: string, seeds: Uint8Array[]): Promise<string> {
  if (seeds.length > 15 || seeds.some(seed => seed.length > 32)) throw new Error("invalid_pda_seeds");
  const programBytes = publicKey(program);
  const marker = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const input = Uint8Array.from([...seeds.flatMap(s => Array.from(s)), bump, ...programBytes, ...marker]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    try { ed25519.Point.fromBytes(digest, true); } catch { return toBase58(digest); }
  }
  throw new Error("pda_not_found");
}
export const seed = (value: string) => new TextEncoder().encode(value);

export class Reader {
  offset: number;
  constructor(readonly bytes: Uint8Array, offset = 0) { this.offset = offset; }
  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length || length < 0) throw new Error("truncated_account");
    const result = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return result;
  }
  u8(): number { return this.take(1)[0]!; }
  u16(): number { const b = this.take(2); return b[0]! + b[1]! * 256; }
  u32(): number { const b = this.take(4); return new DataView(b.buffer).getUint32(0, true); }
  u64(): bigint { const b = this.take(8); return new DataView(b.buffer).getBigUint64(0, true); }
  key(): string { return toBase58(this.take(32)); }
  bool(): boolean { const v = this.u8(); if (v > 1) throw new Error("invalid_bool"); return v === 1; }
  string(max = 512): string {
    const length = this.u32(); if (length > max) throw new Error("metadata_too_large");
    return new TextDecoder("utf-8", { fatal: true }).decode(this.take(length)).replace(/[\u0000-\u001f\u007f]/g, "");
  }
}
