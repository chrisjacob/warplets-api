// Offline inspection of public serialized account layouts. Sizes and fields
// match the bfa1860 source revision cited in KAMINO.md. No SDK, signer or RPC.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decode58, encode58 } from '../server/base58.mjs';

export const FARM_PROGRAM = 'FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr';
export const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const REFERENCE_FARM = '8rEcjBV3p3raTbJWqbQo6mMpdeeckpeUR1QfRgx8o1o';
export const GLOBALS = ['4yYjAdV23E81QgiLr9z3Kr5zM4njnWSmENNWxBWj17TC', '6UodrBjL2ZreDy7QdR4YV1oxqMBjVYSEyrFpctqqwGwL'];
export const PROGRAM_DATA = '5Fz4tY19ihWJAW1j9RNoEQJKSdn5mQHjcVrcZ5BRK5E9';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const publicKey = (bytes, at) => encode58(bytes.subarray(at, at + 32));
const u64 = (bytes, at) => String(bytes.readBigUInt64LE(at));
const MAX = (1n << 64n) - 1n;

function accountData(account, discriminator, size) {
  assert.equal(account.owner, FARM_PROGRAM);
  assert.equal(account.executable, false);
  assert.equal(account.space, size);
  assert.equal(account.data[1], 'base64');
  const bytes = Buffer.from(account.data[0], 'base64');
  assert.equal(bytes.toString('base64'), account.data[0]);
  assert.equal(bytes.length, size);
  assert.equal(bytes.subarray(0, 8).toString('hex'), hash('account:' + discriminator).slice(0, 16));
  return bytes;
}

export function readGlobalConfig(account) {
  const b = accountData(account, 'GlobalConfig', 2136);
  const bps = b.readBigUInt64LE(40);
  assert(bps <= 10_000n);
  return { globalAdmin: publicKey(b, 8), treasuryFeeBps: Number(bps), treasuryVaultAuthority: publicKey(b, 48) };
}

export function readFarmConfig(account) {
  const b = accountData(account, 'FarmState', 8336);
  const count = b.readBigUInt64LE(7232);
  assert(count <= 10n);
  const rewards = [];
  for (let i = 0; i < Number(count); i++) {
    const start = 192 + i * 704; // RewardInfo begins with the full 120-byte TokenInfo.
    const curve = [];
    for (let j = 0; j < 20; j++) {
      const point = start + 160 + j * 16;
      const at = b.readBigUInt64LE(point);
      if (at === MAX) continue; // sentinel for unused points
      curve.push({ from: String(at), rewardPerTimeUnit: u64(b, point + 8) });
    }
    rewards.push({ mint: publicKey(b, start), tokenProgram: publicKey(b, start + 40),
      vault: publicKey(b, start + 120), availableUnits: u64(b, start + 152),
      minClaimDuration: u64(b, start + 480), rewardType: b[start + 536], rpsDecimals: b[start + 537], curve });
  }
  return { farmAdmin: publicKey(b, 8), globalConfig: publicKey(b, 40), mint: publicKey(b, 72),
    tokenProgram: publicKey(b, 112), decimals: u64(b, 104), numUsers: u64(b, 7240), totalStaked: u64(b, 7248),
    timeUnit: b[7360], frozen: b[7361] !== 0, delegated: b[7362] !== 0, withdrawAuthority: publicKey(b, 7368), warmup: b.readUInt32LE(7400),
    cooldown: b.readUInt32LE(7404), lockingMode: u64(b, 7496), rewards };
}

// Preserve public configuration accounts but do not redistribute the third-
// party executable. Its hash includes all allocated program bytes after the
// loader's fixed 45-byte metadata, including any allocation padding.
export function inspectUpgradeableDeployment(raw, programAddress, dataAddress) {
  const [program, data] = raw.accounts;
  assert.deepEqual(raw.addresses.slice(0, 2), [programAddress, dataAddress]);
  assert.equal(raw.commitment, 'finalized');
  assert.equal(program.owner, LOADER);
  assert.equal(program.executable, true);
  assert.equal(data.owner, LOADER);
  assert.equal(data.executable, false);
  const p = Buffer.from(program.data[0], 'base64');
  const d = Buffer.from(data.data[0], 'base64');
  assert.equal(p.length, 36);
  assert.equal(p.readUInt32LE(0), 2);
  assert.equal(publicKey(p, 4), dataAddress);
  assert.equal(d.length, data.space);
  assert.equal(d.readUInt32LE(0), 3);
  assert(d[12] === 0 || d[12] === 1);
  assert.equal(d.subarray(45, 49).toString('hex'), '7f454c46');
  return { program: programAddress, programData: dataAddress, contextSlot: raw.context.slot,
    programDataLength: d.length, deployedSlot: u64(d, 4), upgradeAuthority: d[12] ? publicKey(d, 13) : null,
    allocatedElfSha256: hash(d.subarray(45)), observedAt: raw.retrievedAt };
}
export const deploymentObservation = raw => inspectUpgradeableDeployment(raw, FARM_PROGRAM, PROGRAM_DATA);

export function inspectKamino(observation) {
  const raw = observation.farmSnapshot;
  assert.equal(raw.commitment, 'finalized');
  assert(Number.isSafeInteger(raw.context.slot) && raw.context.slot > 0);
  assert.deepEqual(raw.addresses, [REFERENCE_FARM, ...GLOBALS]);
  assert.equal(raw.accounts.length, raw.addresses.length);
  const farm = readFarmConfig(raw.accounts[0]);
  const globals = raw.accounts.slice(1).map((account, i) => ({ address: GLOBALS[i], ...readGlobalConfig(account) }));
  const linked = globals.find(g => g.address === farm.globalConfig);
  assert(linked, 'farm references a different global config');
  decode58(linked.globalAdmin, 32);
  return { contextSlot: raw.context.slot, observedAt: raw.retrievedAt, globals, farm,
    linkedHarvestFeeBps: linked.treasuryFeeBps, observedSameMint: farm.rewards.some(r => r.mint === farm.mint),
    sourceBinaryParity: 'unverified', attCampaignFunded: false, productionEnabled: false };
}
