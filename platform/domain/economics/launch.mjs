import { DAY_SECONDS, tokenUnits, unsigned } from './units.mjs';

export const CAMPAIGN_SECONDS = 10n * DAY_SECONDS;

// 200 is the least common multiple of the 1% daily and 2.5% Vault denominators.
// A launch with fractional base-unit budgets requires a separately agreed policy.
export function launchAllocations({ supply, activeSeasonWeight }) {
  tokenUnits(supply, 'supply');
  unsigned(activeSeasonWeight, 'activeSeasonWeight');
  if (supply === 0n || supply % 200n !== 0n) {
    throw new RangeError('supply must be a positive multiple of 200 base units');
  }
  const seasonVault = activeSeasonWeight === 0n ? 0n : supply / 40n;
  return Object.freeze({
    liquidity: supply * 4n / 5n,
    earn: supply / 10n,
    dailyEarn: supply / 100n,
    stake: supply / 20n,
    genesisVault: supply / 20n - seasonVault,
    seasonVault,
  });
}

export function launchFeeBps({ activatedAt, at }) {
  unsigned(activatedAt, 'activatedAt');
  unsigned(at, 'at');
  if (at < activatedAt) throw new RangeError('market is not active yet');
  const seconds = at - activatedAt;
  return seconds >= 89n ? 100n : 9000n - seconds * 100n;
}
