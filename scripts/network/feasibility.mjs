#!/usr/bin/env node
// Bounded, read-only provider investigation. Writes aggregate evidence locally;
// never writes D1/KV, sends transactions, or treats samples as dashboard totals.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { country, tokenObservation, portfolio, walletOwners, reconcileCountries, estimateCalls, BASE_ASSETS } from './feasibility-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
if (!args.has('--live')) {
  console.log('Usage: node scripts/network/feasibility.mjs --live\nUses existing Neynar credentials for up to 360 read-only requests. Stores aggregate evidence in docs/network/feasibility-results.json.');
  process.exit(0);
}

const secrets = { ...process.env };
for (const filename of ['.dev.vars', 'app/.dev.vars']) {
  let contents;
  try { contents = await readFile(resolve(root, filename), 'utf8'); } catch { continue; }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match && !secrets[match[1]]) secrets[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
}
if (!secrets.NEYNAR_API_KEY) throw new Error('NEYNAR_API_KEY is not configured');

const evidence = {
  schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null,
  purpose: 'Internal feasibility sample; not public network statistics',
  samplePolicy: 'First and last page from every reported identity shard, plus three existing project FIDs. Non-random and not representative.',
  requestLimit: 360, requests: 0, providerRequests: {}, failures: {}, sources: {},
  gates: {},
};
const MAX_BYTES = 18_000_000;
let nextRequestAt = 0;
function failure(label, error) {
  // Do not log provider bodies, full URLs, request headers or Error.message.
  const code = /^HTTP_\d+$/.test(error?.code ?? '') ? error.code : error?.name === 'TimeoutError' ? 'TIMEOUT' : 'REQUEST_OR_SCHEMA_FAILED';
  evidence.failures[label] = code;
  return null;
}
async function request(label, url, { api = false, json = true } = {}) {
  if (evidence.requests >= evidence.requestLimit) throw Object.assign(new Error('Probe request cap'), { code: 'BUDGET_CAP' });
  const parsed = new URL(url);
  if (api && !['api.neynar.com', 'snapchain-api.neynar.com'].includes(parsed.hostname)) throw new Error('Credential host rejected');
  const start = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = start + 260; // At most ~231 request starts/minute, including failures.
  evidence.requests++;
  evidence.providerRequests[parsed.hostname] = (evidence.providerRequests[parsed.hostname] ?? 0) + 1;
  await new Promise(r => setTimeout(r, Math.max(0, start - Date.now())));
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; 10XNetworkFeasibility/1.0)', ...(api ? { 'x-api-key': secrets.NEYNAR_API_KEY } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('Provider HTTP failure'), { code: `HTTP_${response.status}` }); }
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Response size cap');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body = Buffer.concat(chunks).toString('utf8');
  return json ? JSON.parse(body) : body;
}
async function safe(label, url, options) {
  try { return await request(label, url, options); } catch (error) { return failure(label, error); }
}
async function pooled(values, fn, count = 3) {
  let index = 0;
  await Promise.all(Array.from({ length: count }, async () => { while (index < values.length) { const i = index++; await fn(values[i], i); } }));
}

console.log('Network feasibility: checking official vote configuration and network size…');
const officialPage = await safe('official_vote_page', 'https://farcaster.xyz/~/vote', { json: false });
const scriptPath = officialPage?.match(/<script[^>]+src="(\/assets\/index-[^"/]+\.js)"/)?.[1];
let officialBundle;
if (scriptPath) officialBundle = await safe('official_client_bundle', `https://farcaster.xyz${scriptPath}`, { json: false });
if (officialBundle) {
  const config = officialBundle.match(/networkSchoolOptInContract=\{address:"(0x[\da-fA-F]{40})",chainId:(\d+),domainName:"([^"]+)",domainVersion:"([^"]+)",primaryType:"([^"]+)",agreement:"([^"]+)"/);
  evidence.sources.officialVote = {
    page: 'https://farcaster.xyz/~/vote', bundle: `https://farcaster.xyz${scriptPath}`,
    bundleSha256: createHash('sha256').update(officialBundle).digest('hex'),
    contract: config?.[1]?.toLowerCase() ?? null, chainId: config ? Number(config[2]) : null,
    primaryType: config?.[5] ?? null, agreement: config?.[6] ?? null,
    fidInSignedMessage: officialBundle.includes('{name:"fid",type:"uint256"}'),
    leaveUsesApplicationApi: officialBundle.includes('this.post("/v2/opt-in/opt-out"'),
    currentDecisionCanChange: officialBundle.includes('change your vote at any time'),
    abiVerified: false, eligibilityVerified: false, publicRejectionSourceVerified: false,
  };
}
const tracker = await safe('reference_tracker', 'https://fc.dylanbrodeur.org/api/stats');
if (tracker) evidence.sources.referenceTracker = {
  url: 'https://fc.dylanbrodeur.org/api/stats', contract: tracker.contract,
  observedSigners: tracker.signers, observedMints: tracker.totalMinted,
  deployBlock: tracker.deployBlock, scannedToBlock: tracker.scannedToBlock,
  updatedAt: tracker.updatedAt, authoritativeCurrentFidStatus: false,
};
const info = await safe('snapchain_info', 'https://snapchain-api.neynar.com/v1/info', { api: true });
evidence.sources.registry = info ? {
  url: 'https://snapchain-api.neynar.com/v1/info', version: info.version,
  reportedRegistrations: info.dbStats?.numFidRegistrations ?? null,
  shardRegistrations: info.shardInfos?.filter(s => s.shardId > 0).map(s => ({ shardId: s.shardId, registrations: s.numFidRegistrations })),
  independentlyEnumerated: false,
} : null;

const fids = new Set([3, 9152, 1129138]);
for (const shard of info?.shardInfos?.filter(s => s.shardId > 0) ?? []) {
  for (const reverse of [false, true]) {
    const data = await safe(`fids_${shard.shardId}_${reverse}`, `https://snapchain-api.neynar.com/v1/fids?shard_id=${shard.shardId}&pageSize=100&reverse=${reverse}`, { api: true });
    for (const fid of data?.fids ?? []) if (Number.isSafeInteger(fid) && fid > 0) fids.add(fid);
  }
}
const users = [];
const fidList = [...fids];
for (let offset = 0; offset < fidList.length; offset += 100) {
  const data = await safe(`profiles_${offset}`, `https://api.neynar.com/v2/farcaster/user/bulk/?fids=${fidList.slice(offset, offset + 100).join(',')}`, { api: true });
  const requested = new Set(fidList.slice(offset, offset + 100));
  for (const user of data?.users ?? []) if (requested.has(user.fid)) users.push(user);
}
const uniqueUsers = [...new Map(users.map(u => [u.fid, u])).values()];
const geography = reconcileCountries(uniqueUsers);
const owners = walletOwners(uniqueUsers);
evidence.profiles = {
  requestedFids: fidList.length, retrievedFids: uniqueUsers.length,
  failedOrMissingFids: fidList.length - uniqueUsers.length,
  samplePopulation: geography.samplePopulation, countryAssignedFromHydratedData: geography.known,
  countryNotAssignableFromHydratedData: geography.unknown,
  locationAbsenceVerified: false,
  note: 'Missing hydrated location fields are source-unavailable, not verified unknown locations. Consult the separate official-client probe.',
  mappedPlusUnmappedReconciles: geography.known + geography.unknown === geography.samplePopulation,
  withVerifiedEvmWallets: uniqueUsers.filter(u => u.verified_addresses?.eth_addresses?.length).length,
  distinctVerifiedEvmWallets: owners.size,
  sharedWalletsWithinSample: [...owners.values()].filter(set => set.size > 1).length,
  hydratedProfileTokenFieldPresent: uniqueUsers.filter(u => Object.hasOwn(u, 'profile_token') || Object.hasOwn(u.profile ?? {}, 'profile_token')).length,
};
console.log(`Retrieved ${uniqueUsers.length} sample profiles; inspecting raw profile-token records…`);
const tokenCounts = {};
await pooled(uniqueUsers.slice(0, 24), async user => {
  const data = await safe(`userdata_${user.fid}`, `https://snapchain-api.neynar.com/v1/userDataByFid?fid=${user.fid}`, { api: true });
  const observation = tokenObservation(data);
  tokenCounts[observation.status] = (tokenCounts[observation.status] ?? 0) + 1;
});
evidence.profileTokens = { sampleFids: Math.min(24, uniqueUsers.length), observations: tokenCounts, productionAssignmentsVerified: (tokenCounts.assigned ?? 0) > 0 };

console.log('Checking up to 100 distinct verified Base wallets (maximum three pages each)…');
const measured = new Map();
let walletCompletions = 0, totalPages = 0;
await pooled([...owners.keys()].slice(0, 100), async address => {
  let cursor = '', complete = false;
  const balances = [], seenCursors = new Set();
  for (let page = 0; page < 3; page++) {
    const data = await safe(`wallet_${walletCompletions}_${page}`, `https://api.neynar.com/v2/onchain/token/balances?networks=base&address=${address}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { api: true });
    totalPages++;
    if (!Array.isArray(data?.balances) || !data.next || !Object.hasOwn(data.next, 'cursor')) break;
    balances.push(...data.balances);
    cursor = data.next.cursor;
    if (cursor === null || cursor === '') { complete = true; break; }
    if (typeof cursor !== 'string' || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }
  measured.set(address, portfolio(balances, complete));
  walletCompletions++;
  if (walletCompletions % 20 === 0) console.log(`Inspected ${walletCompletions} wallets; ${evidence.requests}/${evidence.requestLimit} request reservations used.`);
});
const observed = [...measured.values()].filter(p => p.status === 'observed');
const exclusions = {};
for (const p of observed) for (const [key, count] of Object.entries(p.exclusions)) exclusions[key] = (exclusions[key] ?? 0) + count;
evidence.economics = {
  chainId: 8453, walletScope: 'verified', attemptedWallets: measured.size, completeWallets: observed.length,
  unavailableWallets: measured.size - observed.length, zeroSupportedValueWallets: observed.filter(p => p.usd === 0n).length,
  balancePagesRequested: totalPages, excludedBalances: exclusions,
  supportedAssets: [...new Set([...BASE_ASSETS.values()].map(a => a.symbol))],
  provider: 'Neynar onchain token balances',
  quotePolicy: 'Allowlisted Base assets with explicit positive price_usd; balance_usd alone is rejected.',
  nativeCoverageVerified: false, blockTimestampVerified: false, priceTimestampVerified: false,
  reliableProductionValuationVerified: false,
};
// Country-level sample only. Do not persist individual wallet/profile/value joins.
const groups = new Map();
for (const user of uniqueUsers) {
  const code = country(user) ?? 'UNKNOWN';
  const group = groups.get(code) ?? { fids: 0, measuredFids: new Set(), wallets: new Set(), value: 0n };
  group.fids++;
  groups.set(code, group);
}
const byFid = new Map(uniqueUsers.map(u => [u.fid, u]));
let attributable = 0n, ambiguous = 0n;
for (const [address, p] of measured) {
  if (p.usd === null) continue;
  const links = owners.get(address);
  if (links.size !== 1) { ambiguous += p.usd; continue; }
  const fid = [...links][0];
  const code = country(byFid.get(fid)) ?? 'UNKNOWN';
  const group = groups.get(code);
  group.wallets.add(address); group.measuredFids.add(fid); group.value += p.usd;
  attributable += p.usd;
}
const sum = observed.reduce((total, p) => total + p.usd, 0n);
evidence.countrySample = {
  warning: 'Internal non-representative sample. Vote and token affiliation columns are unavailable; monetary values are withheld pending timestamp/native-coverage validation.',
  rows: [...groups].filter(([, g]) => g.fids >= 10).map(([code, g]) => ({
    country: code === 'UNKNOWN' ? 'UNMAPPED_OR_SOURCE_UNAVAILABLE' : code, population: g.fids, measuredFids: g.measuredFids.size >= 25 ? g.measuredFids.size : null,
    yes: null, no: null, noRecord: null, profileTokenAffiliations: null, walletValueUsd: null,
  })),
  suppressedGroups: [...groups.values()].filter(g => g.fids < 10).length,
  walletAttributionReconciles: attributable + ambiguous === sum,
  ambiguityCheckedAcrossFullNetwork: false,
};
const population = info?.dbStats?.numFidRegistrations;
evidence.capacity = {
  ...(Number.isSafeInteger(population) ? { callCountLowerBounds: (({ dailyWalletCallsPer30Days, ...calls }) => calls)(estimateCalls(population, 0)) } : {}),
  fullNetworkWalletCount: null, remainingMonthlyCredits: null, endpointCreditTariffs: null,
  exportEntitlementVerified: false, sharedD1HeadroomVerified: false,
  costWithinExistingSubscriptionVerified: false,
  note: 'Wallet estimate omitted: a non-random sample cannot estimate full-network distinct wallets. Credit rates and subscription headroom require account evidence. REST sweep counts exclude pagination and retries.',
};
evidence.gates = {
  officialContractAddress: Boolean(evidence.sources.officialVote?.contract && evidence.sources.officialVote.contract === tracker?.contract?.toLowerCase()),
  votingAbiAndCurrentStatus: false,
  completeRegistryEnumeration: false,
  rawSnapchainProfileTokenAssignments: evidence.profileTokens.productionAssignmentsVerified,
  reliableBaseValuation: false,
  refreshWithinExistingBudget: false,
  safeToImplementDashboard: false,
};
evidence.finishedAt = new Date().toISOString();
await mkdir(resolve(root, 'docs/network'), { recursive: true });
await writeFile(resolve(root, 'docs/network/feasibility-results.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log('Saved docs/network/feasibility-results.json. Feasibility gates are unresolved; dashboard implementation remains gated.');
process.exitCode = 2;
