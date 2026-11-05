import { CAMPAIGN_SECONDS } from './launch.mjs';
import { requireId, tokenUnits, unsigned } from './units.mjs';

// Exact fractions are for offline comparison with a candidate farm's
// fixed-point implementation. Work is bounded to the supplied pilot trace.
function fraction(numerator, denominator = 1n) {
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  return { n: numerator / a, d: denominator / a };
}

function add(a, b) { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
function difference(a, b) { return fraction(a.n * b.d - b.n * a.d, a.d * b.d); }
function scale(a, units) { return fraction(a.n * units, a.d); }
function whole(a) { return a.n / a.d; }

function settle(position, index) {
  position.earned = add(position.earned, scale(difference(index, position.lastIndex), position.principal));
  position.lastIndex = index;
}

// Events are in confirmed order and use Unix seconds. "treasuryFeeBps" is a
// hypothetical input for fee sensitivity, not a measured Kamino setting.
export function simulateStakeFarm({ activatedAt, budget, through, treasuryFeeBps = 0n, events }) {
  unsigned(activatedAt, 'activatedAt');
  unsigned(through, 'through');
  tokenUnits(budget, 'budget');
  unsigned(treasuryFeeBps, 'treasuryFeeBps');
  if (treasuryFeeBps > 10_000n || through < activatedAt) throw new RangeError('invalid farm parameters');
  if (!Array.isArray(events) || events.length > 1000) throw new RangeError('pilot trace limit is 1000 events');
  const end = activatedAt + CAMPAIGN_SECONDS;
  const positions = new Map();
  const eventIds = new Set();
  const receipts = [];
  let last = activatedAt;
  let idleSeconds = 0n;
  let totalPrincipal = 0n;
  let index = fraction(0n);

  function advance(at) {
    const start = last < end ? last : end;
    const stop = at < end ? at : end;
    const seconds = stop - start;
    if (totalPrincipal === 0n) idleSeconds += seconds;
    else if (seconds) index = add(index, fraction(budget * seconds, CAMPAIGN_SECONDS * totalPrincipal));
    last = at;
  }

  for (const { id, at, wallet, kind, amount } of events) {
    requireId(id, 'event id');
    requireId(wallet, 'wallet');
    unsigned(at, 'event time');
    if (eventIds.has(id)) throw new RangeError('duplicate event id');
    if (at < last || at > through) throw new RangeError('event outside ordered observation');
    eventIds.add(id);
    advance(at);
    const position = positions.get(wallet) ?? { principal: 0n, earned: fraction(0n), lastIndex: index, harvested: 0n };
    settle(position, index);
    if (kind === 'harvest') {
      if (amount !== undefined) throw new TypeError('harvest takes no amount');
      const cumulativeGross = whole(position.earned);
      const gross = cumulativeGross - position.harvested;
      const treasury = cumulativeGross * treasuryFeeBps / 10_000n - position.harvested * treasuryFeeBps / 10_000n;
      receipts.push({ id, wallet, at, gross, treasury, net: gross - treasury });
      position.harvested = cumulativeGross;
    } else {
      tokenUnits(amount, 'position change');
      if (amount === 0n) throw new RangeError('position change must be positive');
      if (kind !== 'deposit' && kind !== 'withdraw') throw new RangeError('unknown position event');
      if (kind === 'withdraw' && position.principal < amount) throw new RangeError('withdrawal exceeds principal');
      const delta = kind === 'deposit' ? amount : -amount;
      position.principal = tokenUnits(position.principal + delta, 'principal');
      totalPrincipal = tokenUnits(totalPrincipal + delta, 'total principal');
    }
    positions.set(wallet, position);
  }

  advance(through);
  const balances = [];
  let earnedGross = 0n;
  for (const [wallet, position] of positions) {
    settle(position, index);
    const cumulativeGross = whole(position.earned);
    earnedGross += cumulativeGross;
    balances.push({ wallet, principal: position.principal, earnedGross: cumulativeGross,
      harvestedGross: position.harvested, claimableGross: cumulativeGross - position.harvested });
  }
  const futureSeconds = through < end ? end - through : 0n;
  const unissued = budget * futureSeconds / CAMPAIGN_SECONDS;
  const idle = budget * idleSeconds / CAMPAIGN_SECONDS;
  // Unresolved sub-unit shares stay funded. Only whole idle units can be
  // classified as unused, and only upon campaign end are they recoverable.
  return { balances, receipts, totalPrincipal, earnedGross, unissued, idle,
    recoverableIdle: through >= end ? idle : 0n, roundingReserve: budget - earnedGross - unissued - idle };
}
