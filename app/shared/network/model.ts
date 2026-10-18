export const NETWORK_CONTRACT = '0x4ecfed276c566aeb49da1f3a888e8dbb7263028d';
export const NETWORK_DEPLOY_BLOCK = 52601136;
export const NETWORK_ACCEPTANCE_TOPIC = '0xb51e0080591358c6acd543e4989b2cc178707c6d20c9218e83f2af19a8a1e315';
// keccak256('OptInMinted(uint256,address)'), both arguments indexed.
export const NETWORK_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const NETWORK_HOSTS = ['network.10x.meme', 'network-local.10x.meme', 'network-dev.10x.meme'];
export function isNetworkRoute(host: string, path: string) { return NETWORK_HOSTS.includes(host.toLowerCase()) || path === '/network' || path.startsWith('/network/'); }
export type NetworkVote = 'opted_in' | 'opted_out' | 'pending' | 'moderated_out' | 'unavailable';
export interface NetworkCell { country: string | null; location: 'known' | 'unknown' | 'unavailable'; token: string | null; tokenStatus: 'assigned' | 'none' | 'unavailable'; vote: NetworkVote; acceptedDay: string | null; count: number; held?: string; walletUsdUnits?: string; portfolioValues?: string[] }
export interface WalletSnapshot { associationsObserved: number; expectedWallets: number; measuredWallets: number; unallocatedUsdUnits: string; oldestBalanceAt: number | null; latestBalanceAt: number | null; oldestPriceAt: number | null; excludedBalances: number; tokens: NetworkToken[] }
export interface NetworkEconomics { status: 'unavailable' | 'partial' | 'ready'; chain: 'Base'; reason: string; totalUsd?: string; attributedUsd?: string; unallocatedUsd?: string; averageUsd?: string | null; medianUsd?: string | null; measuredAccounts?: number; coverage?: WalletSnapshot; stale?: boolean }
export interface NetworkToken { id: string; name: string; symbol: string }
export interface NetworkSnapshot {
  id: string; createdAt: number; cohort: 'acceptance-signers'; chain: 'Base';
  scan: { fromBlock: number; throughBlock: number; targetBlock: number; complete: boolean };
  population: number; profilesObserved: number; profileOldestAt: number | null;
  sources?: { chainVerified: number; officialConfirmed: number; candidates: number; candidatesObserved: number };
  cells: NetworkCell[]; tokens: NetworkToken[];
  adoption: { day: string; count: number }[];
  wallet?: WalletSnapshot;
}
export interface NetworkFilters { country: string; location: 'all' | 'known' | 'unknown' | 'unavailable'; vote: 'all' | NetworkVote; tokens: string[]; snapshot: string; held?: string }
export interface NetworkRow { id: string; name: string; population: number | null; adoption: number | null; percentage: number | null; suppressed: boolean; walletUsd?: string }
export interface NetworkDashboard {
  snapshot: { id: string; createdAt: number; profileOldestAt: number | null; stale: boolean; scan: NetworkSnapshot['scan']; sources?: NetworkSnapshot['sources'] } | null;
  filters: NetworkFilters; population: number | null; cohortPopulation: number | null;
  coverage: { observed: number | null; known: number | null; unknown: number | null; unavailable: number | null; tokenAssigned: number | null; tokenUnavailable: number | null };
  votes: { id: NetworkVote; count: number | null }[];
  countries: NetworkRow[]; tokens: NetworkRow[]; tokenCatalog: NetworkToken[];
  adoption: { day: string; count: number }[];
  heldTokens?: NetworkRow[]; heldCatalog?: NetworkToken[];
  suppressed: boolean; economics: NetworkEconomics;
  activity: { status: 'unavailable'; reason: string };
  methodology: string[];
}
export const NETWORK_METHODOLOGY = [
  'Population is distinct FIDs accepted through either original onchain mint evidence or official client opt-in confirmation of a FID from the contract tracker signer list. Tracker candidates alone are never counted. Independent chain reconciliation coverage is shown separately. This is not all Farcaster accounts, current NFT holders, or unique humans.',
  'Signing history establishes acceptance at that time. Current client status is observed separately; rejection, moderation and missing status are never inferred from NFT ownership.',
  'Public location descriptions are normalized only when an explicit country is identifiable. Profiles not yet retrieved are unavailable, separate from retrieved profiles with unknown or unresolvable locations.',
  'Profile tokens are self-declared CAIP-19 affiliations, not evidence of token ownership. Explicitly cleared tokens and source-omitted token fields remain distinct.',
  'Public signer profiles, country/token groups and participation counts are visible at every group size. Names and images are public profile observations, not onchain identity verification. Individual financial profiles are never published.',
  'Base wallet estimates use distinct current verified EVM addresses and independently timestamped DefiLlama prices with confidence at least 0.95. Unsupported, unpriced, stale-price and decimal-mismatched assets are excluded. The supported estimate is not personal net worth. Native ETH and stablecoins can be the largest priced holding. Wallet import coverage is for the whole cohort; incomplete portfolios have no top-held assignment. Shared wallets count once globally and remain unallocated. Complete 30-day activity remains unavailable.',
  'Acceptance history uses chain event timestamps. Historical filters are offered only for stored snapshots; no synthetic history is generated.',
];
export function validateNetworkParams(params: URLSearchParams, extra: string[] = []) {
  if (params.toString().length > 32768) throw new Error('Network query is too large');
  const allowed = new Set(['country', 'location', 'vote', 'token', 'snapshot', 'held', ...extra]);
  for (const key of params.keys()) if (!allowed.has(key) || key !== 'token' && params.getAll(key).length !== 1) throw new Error('Unknown or repeated Network parameter');
}
export function parseNetworkFilters(params: URLSearchParams): NetworkFilters {
  const country = params.get('country') ?? 'all';
  const location = params.get('location') ?? 'all', vote = params.get('vote') ?? 'all';
  const tokens = [...new Set(params.getAll('token'))].sort();
  const snapshot = params.get('snapshot') ?? 'current';
  const held = params.get('held') ?? 'all';
  if (!['all','none','unavailable','ambiguous','unpriced'].includes(held) && (held.length>180 || !/^eip155:8453\/(erc20:0x[a-f0-9]{40}|slip44:60)$/.test(held))) throw new Error('Invalid top-held token');
  if (country !== 'all' && !/^[A-Z]{2}$/.test(country) && country !== 'UNKNOWN' && country !== 'UNAVAILABLE') throw new Error('Invalid country');
  if (!['all', 'known', 'unknown', 'unavailable'].includes(location)) throw new Error('Invalid location');
  if (!['all', 'opted_in', 'opted_out', 'pending', 'moderated_out', 'unavailable'].includes(vote)) throw new Error('Invalid current status');
  if (tokens.length > 100 || tokens.some(t => t.length > 180 || !['none', 'unavailable'].includes(t) && !/^(eip155|solana):[^\s]+\/(erc20|token|slip44):[^\s]+$/.test(t))) throw new Error('Invalid token selection');
  if (snapshot !== 'current' && !/^\d{13}-[a-f0-9-]{36}$/.test(snapshot)) throw new Error('Invalid snapshot');
  return { country, location: location as NetworkFilters['location'], vote: vote as NetworkFilters['vote'], tokens, snapshot, held };
}
