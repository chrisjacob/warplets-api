import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inspectKamino, readFarmConfig, readGlobalConfig } from './kamino.mjs';

const evidence = JSON.parse(readFileSync(new URL('./fixtures/kamino-public.json', import.meta.url)));
test('decode a real finalized same-mint configuration and its own linked fee, without treating it as an ATT campaign', () => {
  const result = inspectKamino(evidence);
  assert.equal(result.contextSlot, 465650698);
  assert.equal(result.observedSameMint, true);
  assert.equal(result.farm.mint, 'sSo14endRuUbvQaJS3dq36Q829a3A6BEfoeeRGJywEh');
  assert.deepEqual(result.globals.map(g => g.treasuryFeeBps), [0, 0]);
  assert.equal(result.linkedHarvestFeeBps, 0);
  assert.equal(result.farm.timeUnit, 0);
  assert.equal(result.farm.lockingMode, '0');
  assert.equal(result.farm.warmup + result.farm.cooldown, 0);
  assert.equal(result.farm.rewards[0].minClaimDuration, '0');
  assert.equal(result.farm.rewards[0].curve[0].rewardPerTimeUnit, '0');
  assert.equal(result.farm.rewards[0].availableUnits, '0');
  assert.equal(result.attCampaignFunded, false);
  assert.equal(result.sourceBinaryParity, 'unverified');
  assert.equal(evidence.deployment.deployedSlot, '444035168');
});
test('reject wrong account authorities, length, reward count, discriminator and unrelated global config', () => {
  const [farm, global] = evidence.farmSnapshot.accounts;
  assert.throws(() => readGlobalConfig({ ...global, executable: true }));
  assert.throws(() => readFarmConfig({ ...farm, owner: '11111111111111111111111111111111' }));
  assert.throws(() => readFarmConfig({ ...farm, space: 4 }));
  function corrupt(account, offset, fill) {
    const b = Buffer.from(account.data[0], 'base64'); b[offset] = fill;
    return { ...account, data: [b.toString('base64'), 'base64'] };
  }
  assert.throws(() => readFarmConfig(corrupt(farm, 0, 0)));
  assert.throws(() => readFarmConfig(corrupt(farm, 7232, 11)));
  const altered = structuredClone(evidence);
  altered.farmSnapshot.accounts[0] = corrupt(farm, 40, 0);
  assert.throws(() => inspectKamino(altered), /different global config/);
});
