import { DAY_MS, epochAt, id, integer } from './values.mjs';

// An action keeps its identity over multiple enabled periods. The verifier supplies
// verified, timestamped completions; a click or a future completion earns nothing.
export function onboardingTenths(epoch, intervals, completions) {
  integer(epoch, 'epoch');
  const active = new Set();
  for (const { actionId, startEpoch, endEpoch } of intervals) {
    id(actionId, 'actionId');
    integer(startEpoch, 'startEpoch');
    if (endEpoch != null) integer(endEpoch, 'endEpoch', startEpoch + 1);
    if (epoch >= startEpoch && (endEpoch == null || epoch < endEpoch)) active.add(actionId);
  }
  const counted = new Set();
  for (const { actionId, verifiedAtMs } of completions) {
    if (verifiedAtMs != null && epochAt(verifiedAtMs) <= epoch && active.has(actionId)) {
      counted.add(actionId);
    }
  }
  return Math.min(10, counted.size);
}

// Input timestamps are approved, eligible content only. Carry the last qualifying
// approval and streak from the previous finalized board, including non-winners.
export function advanceStreak({ epoch, previous, approvalsMs }) {
  integer(epoch, 'epoch');
  let days = 0;
  let last = null;
  if (previous != null) {
    if (previous.epoch !== epoch - 1) throw new RangeError('missing previous board');
    days = integer(previous.days, 'previous.days', 0, 10);
    last = previous.lastApprovalMs;
    if (last !== null && epochAt(last) >= epoch) throw new RangeError('invalid last approval');
    if (days > 0 && (last === null || epochAt(last) !== epoch - 1)) {
      throw new RangeError('streak requires prior qualifying evidence');
    }
  }
  const ordered = [...new Set(approvalsMs)].sort((a, b) => a - b);
  for (const time of ordered) {
    if (epochAt(time) !== epoch) throw new RangeError('approval belongs to another board');
    if (last === null || time - last >= DAY_MS) days = 1;
    else if (epochAt(last) !== epoch) days = Math.min(10, days + 1);
    last = time;
  }
  return { epoch, days: ordered.length ? days : 0, lastApprovalMs: last };
}

// Inputs are user-specific facts at the board cutoff. One unit is one tenth of X.
export function multiplierTenths({ actionTenths, streakDays, highestEligibleLevel, purchaseTokenDays }) {
  integer(actionTenths, 'actionTenths', 0, 10);
  integer(streakDays, 'streakDays', 0, 10);
  integer(highestEligibleLevel, 'highestEligibleLevel', 0, 10);
  integer(purchaseTokenDays, 'purchaseTokenDays');
  return Math.max(1, actionTenths + streakDays + 3 * highestEligibleLevel + Math.min(50, purchaseTokenDays));
}
