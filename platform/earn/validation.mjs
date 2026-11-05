export class EarnError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function requireValue(condition, message) {
  if (!condition) throw new EarnError(400,'invalid_input',message);
}
export function conflict(code, message) { throw new EarnError(409,code,message); }
export function name(value, field) {
  requireValue(typeof value==='string' && value.length>0 && value.length<=256 && value===value.trim(), `Invalid ${field}.`);
  return value;
}
export function nat(value, field) {
  requireValue(Number.isSafeInteger(value) && value>=0, `Invalid ${field}.`);
  return value;
}
export function decimal(value, field) {
  requireValue(typeof value==='string' && /^(0|[1-9][0-9]{0,79})$/.test(value), `Invalid ${field} base units.`);
  return BigInt(value);
}
export function canonicalContentUrl(text) {
  requireValue(typeof text==='string' && text.length<=2048, 'Provide one HTTPS content URL.');
  let url;
  try { url = new URL(text); } catch { throw new EarnError(400,'invalid_input','Invalid content URL.'); }
  requireValue(url.protocol==='https:' && !url.username && !url.password && !url.port
    && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}$/i.test(url.hostname)
    && !/\.(?:localhost|local|internal|lan|home)$/i.test(url.hostname), 'Use a public HTTPS content URL.');
  return url.href;
}
