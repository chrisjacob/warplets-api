import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_SECONDS as tenDays, DAY_SECONDS as day, GENESIS_LEVEL_COUNTS, U64_MAX,
  claimableVaultUnits, createSeasonSnapshot, genesisSlotEntitlement, launchAllocations,
  launchFeeBps, seasonExpiresAt, simulateStakeFarm, vestedVaultUnits,
} from './index.mjs';

const start = 1_700_000_037n;
const unix = iso => BigInt(Date.parse(iso) / 1000);

test('fund the full split, ten equal daily allocations and Genesis fallback in base units', () => {
  for (const supply of [200n, 1_000_000n, U64_MAX - U64_MAX % 200n]) {
    for (const weight of [0n, 2013n]) {
      const { liquidity, earn, dailyEarn, stake, genesisVault, seasonVault } = launchAllocations({ supply, activeSeasonWeight: weight });
      assert.equal(liquidity * 5n, supply * 4n);
      assert.equal(earn, dailyEarn * 10n);
      assert.equal(dailyEarn * 100n, supply);
      assert.equal(stake * 20n, supply);
      assert.equal(seasonVault, weight ? supply / 40n : 0n);
      assert.equal(liquidity + earn + stake + genesisVault + seasonVault, supply);
    }
  }
  for (const supply of [1e6, -200n, 0n, 199n, 100n, U64_MAX + 1n]) {
    assert.throws(() => launchAllocations({ supply, activeSeasonWeight: 1n }));
  }
});

test('the opening fee follows actual activation through second 89 and remains at its floor', () => {
  for (const [second, expected] of [[0n, 9000n], [1n, 8900n], [30n, 6000n], [60n, 3000n], [88n, 200n], [89n, 100n], [90n, 100n], [tenDays, 100n]]) {
    assert.equal(launchFeeBps({ activatedAt: start, at: start + second }), expected);
  }
  assert.throws(() => launchFeeBps({ activatedAt: start, at: start - 1n }), /not active/);
});

test('all 10,000 reserved Genesis slots consume exactly the declared budget', () => {
  for (const budget of [1n, 20130n, 25_000_000n, U64_MAX]) {
    let total = 0n;
    for (let tranche = 1; tranche <= 10; tranche++) {
      let trancheTotal = 0n;
      for (let level = 1; level <= 10; level++) {
        for (let ordinal = 0; ordinal < GENESIS_LEVEL_COUNTS[level - 1]; ordinal++) {
          const amount = genesisSlotEntitlement({ budget, tranche, level, ordinal });
          const floor = budget * BigInt(level) / 20_130n;
          assert.ok(amount === floor || amount === floor + 1n);
          trancheTotal += amount;
        }
      }
      assert.equal(trancheTotal, budget * BigInt(tranche) / 10n - budget * BigInt(tranche - 1) / 10n);
      total += trancheTotal;
    }
    assert.equal(total, budget);
  }
  assert.throws(() => genesisSlotEntitlement({ budget: 1000n, tranche: 1, level: 10, ordinal: 1 }), /ordinal/);
});

test('Vault uses cumulative vesting at the original activation, including partial claims after transfer', () => {
  const input = { allocation: 101n, activatedAt: start };
  for (const [elapsed, amount] of [[0n, 0n], [day, 0n], [day * 3n / 2n, 50n], [day * 2n, 101n], [day * 800n, 101n]]) {
    assert.equal(vestedVaultUnits({ ...input, at: start + elapsed }), amount);
  }
  const beforeSale = claimableVaultUnits({ ...input, at: start + day * 3n / 2n, claimed: 0n });
  assert.equal(claimableVaultUnits({ ...input, at: start + 2n * day, claimed: beforeSale }), 51n);
  assert.throws(() => claimableVaultUnits({ ...input, at: start + day, claimed: 1n }), /claimed exceeds vested/);
});

test('UTC expiry clamps the original start day and keeps its time across leap years', () => {
  for (const [iso, level, expected] of [
    ['2024-01-31T10:37:45Z', 1, '2024-02-29T10:37:45Z'],
    ['2025-01-31T10:37:45Z', 1, '2025-02-28T10:37:45Z'],
    ['2025-01-31T10:37:45Z', 2, '2025-03-31T10:37:45Z'],
    ['2025-11-30T10:37:45Z', 3, '2026-02-28T10:37:45Z'],
  ]) assert.equal(seasonExpiresAt({ startsAt: unix(iso), level }), unix(expected));
});

test('Season snapshots include reserved slots, exclude expired/future ones, and survive metadata changes', () => {
  const levels = GENESIS_LEVEL_COUNTS.flatMap((count, i) => Array(count).fill(i + 1));
  const startsAt = unix('2025-01-31T10:37:45Z');
  const seasons = [
    { id: 'S-2', startsAt, levels: [...levels] },
    { id: 'S-1', startsAt, levels: [...levels] },
    { id: 'future', startsAt: unix('2026-01-01T00:00:00Z'), levels: [...levels] },
  ];
  const activatedAt = unix('2025-02-28T10:37:45Z');
  assert.equal(createSeasonSnapshot({ activatedAt: activatedAt - 1n, seasons }).activeWeight, 2013n * 2n);
  const snapshot = createSeasonSnapshot({ activatedAt, seasons });
  const reverse = createSeasonSnapshot({ activatedAt, seasons: [...seasons].reverse() });
  assert.equal(snapshot.activeWeight, 1524n * 2n);
  seasons[1].levels.fill(1);
  const budget = 12_347n;
  let allocated = 0n;
  for (const { id } of seasons) {
    for (let slotIndex = 0; slotIndex < 1000; slotIndex++) {
      const input = { budget, seasonId: id, slotIndex };
      const amount = snapshot.entitlement(input);
      assert.equal(amount, reverse.entitlement(input));
      if (slotIndex < 489 || id === 'future') assert.equal(amount, 0n);
      allocated += amount;
    }
  }
  assert.equal(allocated, budget);
  const expired = createSeasonSnapshot({ activatedAt: unix('2027-01-01T00:00:00Z'), seasons });
  assert.equal(expired.activeWeight, 0n);
  assert.throws(() => expired.entitlement({ budget, seasonId: 'S-1', slotIndex: 1 }), /zero budget/);
  assert.throws(() => createSeasonSnapshot({ activatedAt, seasons: [seasons[0], seasons[0]] }), /duplicate/);
  assert.throws(() => createSeasonSnapshot({ activatedAt, seasons: [{ ...seasons[0], levels: [1] }] }), /1000/);
});

test('stake trace settles continuously, tracks idle separately and supports harvest/withdraw/restake', () => {
  const at = days => start + BigInt(days) * day;
  const trace = [
    { id: '1', wallet: 'a', at: at(2), kind: 'deposit', amount: 30n },
    { id: '2', wallet: 'b', at: at(4), kind: 'deposit', amount: 10n },
    { id: '3', wallet: 'a', at: at(6), kind: 'harvest' },
    { id: '4', wallet: 'a', at: at(6), kind: 'withdraw', amount: 30n },
    { id: '5', wallet: 'a', at: at(6), kind: 'deposit', amount: 30n },
    { id: '6', wallet: 'a', at: at(8), kind: 'withdraw', amount: 30n },
    { id: '7', wallet: 'b', at: at(11), kind: 'withdraw', amount: 10n },
  ];
  const result = simulateStakeFarm({ activatedAt: start, budget: 10_000n, through: at(11), events: trace });
  assert.equal(result.recoverableIdle, 2000n);
  assert.equal(result.totalPrincipal, 0n);
  assert.equal(result.receipts[0].net, 3500n);
  assert.equal(result.balances[0].claimableGross, 1500n);
  assert.equal(result.balances[1].claimableGross, 3000n);
  assert.equal(result.earnedGross + result.idle + result.unissued + result.roundingReserve, 10_000n);
});

test('sub-day rewards conserve supply and harvest frequency cannot change total fees', () => {
  const activatedAt = 0n;
  const at = tenDays * 2n / 3n;
  const deposit = { id: 'deposit', wallet: 'a', at: 0n, kind: 'deposit', amount: 1n };
  const harvest = { id: 'harvest', wallet: 'a', at, kind: 'harvest' };
  const inputs = { activatedAt, budget: 50_000n, through: at, treasuryFeeBps: 100n };
  const once = simulateStakeFarm({ ...inputs, events: [deposit, harvest] });
  const frequent = simulateStakeFarm({ ...inputs, events: [deposit, { ...harvest, id: 'mid', at: at / 2n }, harvest] });
  assert.equal(once.receipts[0].gross, 33_333n);
  assert.equal(once.roundingReserve, 1n);
  assert.equal(once.receipts[0].net, frequent.receipts.reduce((sum, r) => sum + r.net, 0n));
  assert.equal(once.recoverableIdle, 0n);
  const full = simulateStakeFarm({ ...inputs, through: tenDays, events: [deposit, { ...harvest, at: tenDays }] });
  assert.equal(full.receipts[0].treasury, 500n);
  assert.equal(full.receipts[0].net, 49_500n);
  assert.throws(() => simulateStakeFarm({ ...inputs, events: [deposit, deposit] }), /duplicate/);
  assert.throws(() => simulateStakeFarm({ ...inputs, events: [{ ...deposit, kind: 'withdraw' }] }), /exceeds/);
  assert.throws(() => simulateStakeFarm({ ...inputs, events: [harvest, deposit] }), /ordered/);
});
