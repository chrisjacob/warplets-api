import { DAY_SECONDS, indexInRange, requireId, tokenUnits, unsigned } from './units.mjs';

export const GENESIS_LEVEL_COUNTS = Object.freeze([489, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
export const GENESIS_WEIGHT = 20_130n;

// For adjacent slots, the ending floor of one equals the starting floor of
// the next. Thus every base unit is assigned once, including unminted slots.
function shareOfRange(budget, weightBefore, weight, totalWeight) {
  return budget * (weightBefore + weight) / totalWeight - budget * weightBefore / totalWeight;
}

// Tranche and Level are one-based. ordinal is zero-based within that Level.
// Logical reserve coordinates, never the mint order or a buyer-selected draw.
export function genesisSlotEntitlement({ budget, tranche, level, ordinal }) {
  tokenUnits(budget, 'budget');
  indexInRange(tranche, 'tranche', 1, 10);
  indexInRange(level, 'level', 1, 10);
  indexInRange(ordinal, 'ordinal', 0, GENESIS_LEVEL_COUNTS[level - 1] - 1);
  let weightBefore = 2013n * BigInt(tranche - 1) + BigInt(level * ordinal);
  for (let lower = 1; lower < level; lower++) {
    weightBefore += BigInt(lower * GENESIS_LEVEL_COUNTS[lower - 1]);
  }
  return shareOfRange(budget, weightBefore, BigInt(level), GENESIS_WEIGHT);
}

export function vestedVaultUnits({ allocation, activatedAt, at }) {
  tokenUnits(allocation, 'allocation');
  unsigned(activatedAt, 'activatedAt');
  unsigned(at, 'at');
  const elapsed = at - activatedAt - DAY_SECONDS;
  if (elapsed <= 0n) return 0n;
  if (elapsed >= DAY_SECONDS) return allocation;
  return allocation * elapsed / DAY_SECONDS;
}

// Display/proof fixture only. Real claims require verified chain ownership and
// an atomic cumulative-claimed update keyed to launch and NFT, never to owner.
export function claimableVaultUnits({ claimed, ...vesting }) {
  tokenUnits(claimed, 'claimed');
  const vested = vestedVaultUnits(vesting);
  if (claimed > vested) throw new RangeError('claimed exceeds vested balance at snapshot');
  return vested - claimed;
}

// Add Level calendar months in UTC, clamping to the last day of that month.
export function seasonExpiresAt({ startsAt, level }) {
  unsigned(startsAt, 'startsAt');
  indexInRange(level, 'level', 1, 10);
  if (startsAt > 253402300799n) throw new RangeError('season date exceeds supported calendar');
  const date = new Date(Number(startsAt) * 1000);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + level + 1, 0);
  date.setUTCDate(Math.min(originalDay, date.getUTCDate()));
  return BigInt(date.getTime() / 1000);
}

// Offline reference model. Supply all 1,000 reserved positions per Season,
// minted or not. Caller provides the effective Levels at the launch's chain
// observation. The immutable closure copies that observation; later metadata
// or mint events cannot change the denominator or a slot's entitlement.
export function createSeasonSnapshot({ activatedAt, seasons }) {
  unsigned(activatedAt, 'activatedAt');
  if (!Array.isArray(seasons)) throw new TypeError('seasons must be an array');
  const bySeason = new Map();
  let activeWeight = 0n;
  const ordered = [...seasons].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const { id, startsAt, levels } of ordered) {
    requireId(id, 'season id');
    if (bySeason.has(id)) throw new RangeError('duplicate season id');
    if (!Array.isArray(levels) || levels.length !== 1000) {
      throw new RangeError('every season must include all 1000 reserved slots');
    }
    const expires = Array.from({ length: 10 }, (_, i) => seasonExpiresAt({ startsAt, level: i + 1 }));
    const entries = [];
    for (const level of levels) {
      indexInRange(level, 'level', 1, 10);
      const weight = startsAt <= activatedAt && activatedAt < expires[level - 1] ? BigInt(level) : 0n;
      entries.push({ before: activeWeight, weight });
      activeWeight += weight;
    }
    bySeason.set(id, entries);
  }
  return Object.freeze({
    activatedAt,
    activeWeight,
    entitlement({ budget, seasonId, slotIndex }) {
      tokenUnits(budget, 'budget');
      indexInRange(slotIndex, 'slotIndex', 0, 999);
      const entries = bySeason.get(seasonId);
      if (!entries) throw new RangeError('season is absent from snapshot');
      if (activeWeight === 0n && budget !== 0n) throw new RangeError('inactive Seasons require zero budget');
      const { before, weight } = entries[slotIndex];
      return weight === 0n ? 0n : shareOfRange(budget, before, weight, activeWeight);
    },
  });
}
