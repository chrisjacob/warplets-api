import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function loopback(url) {
  const u = new URL(url);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password) throw Error('Local simulator endpoint required');
  return u;
}
export async function boundedJson(response, maxBytes = 1024 * 1024) {
  if (!response.ok || !response.body) throw Error('Source unavailable');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { await reader.cancel(); throw Error('Source response exceeds limit'); } chunks.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function rpc(url, method, params = []) {
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const data = await boundedJson(response, 16 * 1024 * 1024);
  if (data.error || !Object.hasOwn(data, 'result')) throw Error('RPC request failed: ' + method);
  return data.result;
}
export function validateEvidenceCapture(manifest) {
  if (manifest.version !== 1 || !['base-mainnet', 'solana-mainnet'].includes(manifest.network) || !Number.isSafeInteger(manifest.context) || manifest.context < 1 || !Number.isFinite(Date.parse(manifest.capturedAt)) || !Array.isArray(manifest.accounts) || !manifest.accounts.length) throw Error('Incomplete source provenance');
  const ids = new Set();
  for (const a of manifest.accounts) {
    if (ids.has(a.address) || !a.address || !a.owner || !/^[a-f0-9]{64}$/.test(a.sha256) || a.sha256 !== hash(Buffer.from(a.data, 'base64'))) throw Error('Invalid or conflicting captured account');
    ids.add(a.address);
  }
  return manifest;
}
