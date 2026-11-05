import { DAY_MS, epochAt, id, integer, units } from './values.mjs';

export function allocationWindow(activationMs, day) {
  const epoch = epochAt(activationMs);
  integer(day, 'day', 1, 10);
  const startsAtMs = activationMs + (day - 1) * DAY_MS;
  const vestsFromMs = startsAtMs + DAY_MS;
  const vestsThroughMs = integer(vestsFromMs + DAY_MS, 'vestsThroughMs');
  return { boardEpoch: epoch + day - 2, startsAtMs, vestsFromMs, vestsThroughMs };
}

export function claimableUnits({ awardedUnits, claimedUnits, window, nowMs }) {
  units(awardedUnits, 'awardedUnits');
  units(claimedUnits, 'claimedUnits');
  integer(nowMs, 'nowMs');
  integer(window.vestsFromMs, 'vestsFromMs');
  if (window.vestsThroughMs !== window.vestsFromMs + DAY_MS) throw new RangeError('invalid vesting window');
  const elapsed = Math.min(DAY_MS, Math.max(0, nowMs - window.vestsFromMs));
  const vested = awardedUnits * BigInt(elapsed) / BigInt(DAY_MS);
  if (claimedUnits > vested) throw new RangeError('claimed balance exceeds vested award');
  return vested - claimedUnits;
}

// Work in tenths of a token base unit until the final floor. Early flooring a
// capped award would redistribute its dust to a different wallet.
export function distributeBudget(budgetUnits, winners) {
  units(budgetUnits, 'budgetUnits');
  if (winners.length > 100) throw new RangeError('board exceeds 100 winners');
  const paid = new Map();
  let pending = winners.map(({ wallet, pointsTenths }) => {
    id(wallet, 'wallet');
    integer(pointsTenths, 'pointsTenths', 1, 1000);
    if (paid.has(wallet)) throw new TypeError('duplicate wallet');
    paid.set(wallet, 0n);
    return { wallet, weight: BigInt(pointsTenths) };
  });
  const capScaled = budgetUnits;
  let remainingScaled = 10n * budgetUnits;
  while (pending.length > 0) {
    const weights = pending.reduce((sum, w) => sum + w.weight, 0n);
    const capGroup = pending.filter(w => remainingScaled * w.weight > capScaled * weights);
    if (!capGroup.length) {
      for (const w of pending) {
        paid.set(w.wallet, remainingScaled * w.weight / (weights * 10n));
      }
      break;
    }
    const locked = new Set(capGroup.map(w => w.wallet));
    for (const w of capGroup) paid.set(w.wallet, capScaled / 10n);
    remainingScaled -= BigInt(capGroup.length) * capScaled;
    pending = pending.filter(w => !locked.has(w.wallet));
  }
  const awards = Array.from(paid, ([wallet, amountUnits]) => ({ wallet, amountUnits }));
  const paidUnits = awards.reduce((sum, a) => sum + a.amountUnits, 0n);
  return { budgetUnits, awards, burnUnits: budgetUnits - paidUnits };
}

// A plan is not a transfer. An execution adapter must store a unique allocation
// per token/day and verify finalized board provenance before funding or burning.
export function settleAllocation({ tokenId, originalSupplyUnits, activationMs, day, nowMs, board }) {
  id(tokenId, 'tokenId');
  units(originalSupplyUnits, 'originalSupplyUnits');
  if (originalSupplyUnits === 0n || originalSupplyUnits % 100n !== 0n) {
    throw new RangeError('pilot supply must support ten exact 1% Earn budgets');
  }
  integer(nowMs, 'nowMs');
  const window = allocationWindow(activationMs, day);
  if (board && board.epoch !== window.boardEpoch) throw new RangeError('wrong global board');
  const base = { tokenId, day, ...window };
  if (nowMs < window.startsAtMs) return { ...base, status: 'scheduled' };
  if (board?.status !== 'final') return { ...base, status: 'pending' };
  return { ...base, status: 'ready', ...distributeBudget(originalSupplyUnits / 100n, board.winners) };
}
