/** Offline reference policy. Amounts are lamports, timestamps are UTC Unix milliseconds. */
export const DAY_MS = 86_400_000;
export const HOUR_MS = DAY_MS / 24;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const GENESIS_STAGE_ONE_PRICE = LAMPORTS_PER_SOL / 10n;
export const GENESIS_TRANCHES = 10;
export const SLOTS_PER_TRANCHE = 1_000;
export const LEVEL_QUOTAS = Object.freeze([489, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export class CollectionPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CollectionPolicyError';
    this.code = code;
  }
}

export function requirePolicy(condition, code) {
  if (!condition) throw new CollectionPolicyError(code);
}

export function checkTimestamp(value) {
  requirePolicy(Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP, 'invalid_timestamp');
  return value;
}

export function checkLevel(level) {
  requirePolicy(Number.isInteger(level) && level >= 1 && level <= 10, 'invalid_level');
  return level;
}

export function checkId(value) {
  requirePolicy(typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value, 'invalid_id');
  return value;
}

export function walletSnapshot(wallets) {
  requirePolicy(Array.isArray(wallets), 'invalid_wallet_list');
  return Object.freeze([...new Set(wallets.map(checkId))].sort());
}

export function seasonExpiry(seasonStart, level) {
  checkLevel(level);
  const expiry = new Date(checkTimestamp(seasonStart));
  const day = expiry.getUTCDate();
  // Move via day one to avoid automatic rollover from e.g. January 31 into March.
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + level + 1, 0);
  expiry.setUTCDate(Math.min(day, expiry.getUTCDate()));
  return checkTimestamp(expiry.getTime());
}

/** An exclusive end preserves the snapshot at the exact month rollover. */
export function seasonActiveWeight(seasonStart, level, at) {
  const expiry = seasonExpiry(seasonStart, level);
  checkTimestamp(at);
  return at >= seasonStart && at < expiry ? level : 0;
}

/** Adapter must provide an already uniform, verified ticket in [0, remaining).
 * Reject out-of-domain tickets. Never convert raw randomness with modulo here.
 * Initial mints draw from remaining quotas. Material upgrades draw independently
 * from LEVEL_QUOTAS so upgrade activity cannot change future mint odds.
 */
export function drawLevel(remaining, ticket) {
  requirePolicy(Array.isArray(remaining) && remaining.length === 10
    && remaining.every((n, i) => Number.isInteger(n) && n >= 0 && n <= LEVEL_QUOTAS[i]),
    'invalid_level_inventory');
  const total = remaining.reduce((sum, count) => sum + count, 0);
  requirePolicy(Number.isInteger(ticket) && ticket >= 0 && ticket < total, 'invalid_draw_ticket');
  let offset = 0;
  for (let level = 1; level <= 10; level++) {
    offset += remaining[level - 1];
    if (ticket < offset) return level;
  }
  throw new CollectionPolicyError('invalid_level_inventory');
}

/** Holdings are canonical Solana collection/ownership observations from one finalized
 * snapshot. An NFT may appear only once. Public reveal and ownership must agree at
 * the snapshot; the caller supplies the complete ownership cut, never a client list.
 */
export function snapshotSeasonFreeWallets({ at, holdings }) {
  checkTimestamp(at);
  requirePolicy(Array.isArray(holdings), 'invalid_holdings');
  const ids = new Set();
  const wallets = [];
  for (const nft of holdings) {
    const id = checkId(nft.id);
    requirePolicy(!ids.has(id), 'conflicting_snapshot_holding');
    ids.add(id);
    checkId(nft.owner);
    if (nft.collection !== 'solana-genesis' || nft.revealedAt == null) continue;
    if (checkTimestamp(nft.revealedAt) <= at && checkLevel(nft.level) === 1) wallets.push(nft.owner);
  }
  return Object.freeze({ at, wallets: walletSnapshot(wallets) });
}
