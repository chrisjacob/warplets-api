#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { officialProfile } from './feasibility-lib.mjs';

// Supplementary investigation, deliberately separate from the 100-wallet probe
// so checking another source never repeats paid balance collection.
if (!process.argv.includes('--live')) {
  console.log('Usage: node scripts/network/official-profile-probe.mjs --live\nReads 100 public early-FID profiles from the official client; saves aggregate-only results.');
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const startedAt = new Date().toISOString();
const observations = [], failures = {};
// Serial requests: bounded to 100, no retries, no cookies/authentication.
for (let fid = 1; fid <= 100; fid++) {
  try {
    const response = await fetch(`https://client.farcaster.xyz/v2/user?fid=${fid}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; 10XNetworkFeasibility/1.0)' },
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const code = `HTTP_${response.status}`;
      failures[code] = (failures[code] ?? 0) + 1;
      await response.body?.cancel();
      if (response.status === 429) break;
      continue;
    }
    if (!response.body) throw new Error('Empty response');
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 256_000) throw new Error('Response cap');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const parsed = officialProfile(JSON.parse(Buffer.concat(chunks).toString('utf8')), fid);
    if (!parsed) throw new Error('Unexpected identity/schema');
    observations.push(parsed);
  } catch {
    failures.requestOrSchema = (failures.requestOrSchema ?? 0) + 1;
  }
  if (fid % 20 === 0) console.log(`Checked ${fid}/100 official-client profiles.`);
  await new Promise(r => setTimeout(r, 300));
}
const tally = field => Object.fromEntries([...new Set(observations.map(p => p[field]))].map(value => [value, observations.filter(p => p[field] === value).length]));
const countryGroups = [...new Set(observations.map(p => p.country ?? 'UNKNOWN_OR_UNNORMALIZED'))].map(code => {
  const rows = observations.filter(p => (p.country ?? 'UNKNOWN_OR_UNNORMALIZED') === code);
  if (rows.length < 10) return null;
  const voteStatuses = {};
  for (const status of ['opted_in', 'opted_out', 'pending', 'moderated_out', 'unavailable']) {
    const count = rows.filter(p => p.voteStatus === status).length;
    voteStatuses[status] = count >= 10 ? count : null;
  }
  // Cell values/complements can reveal small sensitive groups; withhold the
  // complete status breakdown whenever any positive cell is below threshold.
  const sensitiveSuppressed = ['opted_in', 'opted_out', 'pending', 'moderated_out', 'unavailable'].some(s => {
      const count = rows.filter(p => p.voteStatus === s).length;
      return count > 0 && count < 10;
    });
  const assigned = rows.filter(p => p.tokenStatus === 'assigned').length;
  return { country: code, population: rows.length, officialStatusBreakdown: sensitiveSuppressed ? null : voteStatuses,
    assignedTokenProfiles: assigned >= 10 && (rows.length - assigned === 0 || rows.length - assigned >= 10) ? assigned : null,
    walletValueUsd: null };
}).filter(Boolean);
const known = observations.filter(p => p.country).length;
const result = {
  schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
  purpose: 'Internal source validation, not public network totals',
  source: 'https://client.farcaster.xyz/v2/user?fid={fid}',
  policy: 'FID 1 through 100; intentionally biased early-account sample. No cookies, credentials, account mutations, or individual data retained.',
  requestedMaximum: 100, retrieved: observations.length, failures,
  locations: { canonicalCountries: known, unknownOrUnnormalized: observations.length - known,
    descriptionsReturned: observations.filter(p => p.locationReturned).length,
    denominatorReconciles: known + observations.filter(p => !p.country).length === observations.length },
  tokens: { statuses: tally('tokenStatus'), distinctCanonicalAssets: new Set(observations.map(p => p.token).filter(Boolean)).size },
  currentStatus: { fieldAvailable: observations.filter(p => p.voteStatus !== 'unavailable').length,
    chainReconciled: false, rejectionEvidenceSemanticsVerified: false,
    note: 'Official application status is observable. It is not independently reconciled onchain voting evidence; moderated_out is never classified as No.' },
  countrySample: countryGroups,
  limitations: [
    'This client endpoint is not a verified supported bulk data/indexer contract.',
    'Permitted full-network request volume and incremental refresh access are unverified.',
    'Missing profileToken is retained as not_returned until absence semantics are verified.',
    'Wallet valuations require the same complete FID cohort and timestamped source snapshots; omitted here.',
  ],
};
await mkdir(resolve(root, 'docs/network'), { recursive: true });
await writeFile(resolve(root, 'docs/network/official-profile-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log('Saved docs/network/official-profile-results.json (aggregate evidence only).');
