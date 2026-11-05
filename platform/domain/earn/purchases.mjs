import { id, integer, MIN_STAKE_MICRO_USD, units } from './values.mjs';

// The collector pages finalized farm activity in canonical chain order and gives
// each position its own gap-free journal sequence. Its durable unique key is
// (wallet, token, transaction signature, instruction index). A retry with the
// original sequence is harmless; a missing withdrawal stops bonus settlement.
export function enrollPosition(wallet, tokenId) {
  return { wallet: id(wallet, 'wallet'), tokenId: id(tokenId, 'tokenId'),
    sequence: 0, creditedUnits: 0n, flags: [], lastEpoch: null, suspended: true };
}

export function applyPurchaseActivity(position, event) {
  if (event.wallet !== position.wallet || event.tokenId !== position.tokenId) {
    throw new TypeError('event belongs to another position');
  }
  integer(event.sequence, 'sequence', 1);
  if (event.sequence <= position.sequence) return position;
  if (event.sequence !== position.sequence + 1) throw new RangeError('missing position activity');
  if (event.confirmed !== true) throw new TypeError('confirmed event required');
  let creditedUnits = position.creditedUnits;
  let flags = position.flags;
  if (event.type === 'verified-buy-and-stake') {
    const bought = units(event.netBoughtUnits, 'netBoughtUnits');
    const deposited = units(event.depositedUnits, 'depositedUnits');
    creditedUnits += bought < deposited ? bought : deposited;
  } else if (event.type === 'withdrawal') {
    const debit = units(event.withdrawnUnits, 'withdrawnUnits');
    creditedUnits = debit < creditedUnits ? creditedUnits - debit : 0n;
    if (units(event.remainingStakeUnits, 'remainingStakeUnits') === 0n) {
      creditedUnits = 0n;
      flags = [];
    }
  } else if (event.type === 'exit' || event.type === 'position-transfer') {
    creditedUnits = 0n;
    flags = [];
  } else if (!['deposit', 'reward', 'restake'].includes(event.type)) {
    throw new RangeError('unknown position event');
  }
  return { ...position, sequence: event.sequence, creditedUnits, flags };
}

// priceNumerator/priceDenominator is the verified micro-USD value of one raw
// base unit. Cross multiplication retains full precision at the $10 boundary.
export function snapshotPurchasePosition(position, { epoch, active, reconciledSequence,
  stakedUnits, priceNumerator, priceDenominator }) {
  integer(epoch, 'epoch');
  if (position.lastEpoch != null && epoch !== position.lastEpoch + 1) {
    throw new RangeError('purchase snapshots must advance one board at a time');
  }
  if (typeof active !== 'boolean') throw new TypeError('campaign status required');
  if (!active) {
    return { status: 'ready', position: { ...position, flags: [], lastEpoch: epoch, suspended: true }, tokenDays: 0 };
  }
  if (reconciledSequence !== position.sequence || priceNumerator == null || priceDenominator == null
      || stakedUnits == null) return { status: 'pending' };
  units(stakedUnits, 'stakedUnits');
  units(priceNumerator, 'priceNumerator');
  units(priceDenominator, 'priceDenominator');
  if (!priceNumerator || !priceDenominator) throw new RangeError('positive price required');
  const principal = stakedUnits < position.creditedUnits ? stakedUnits : position.creditedUnits;
  const qualifies = principal * priceNumerator >= MIN_STAKE_MICRO_USD * priceDenominator;
  const flags = position.flags.filter(flag => flag > epoch - 10);
  if (qualifies) flags.push(epoch);
  return { status: 'ready', position: { ...position, lastEpoch: epoch, flags, suspended: !qualifies },
    tokenDays: qualifies ? flags.length : 0 };
}
