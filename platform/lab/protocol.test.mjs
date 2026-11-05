import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectCapture, inspectStoredCapture } from './capture.mjs';
import { launchAllocations, launchFeeBps } from '../domain/economics/index.mjs';

const v = JSON.parse(readFileSync(new URL('./fixtures/damm-v2-prd-vector.json', import.meta.url)));
const disc = name => createHash('sha256').update('global:' + name).digest().subarray(0, 8);

test('verify real captured program and programdata linkage, ELF hash, deploy slot and authority', () => {
  const [damm] = inspectStoredCapture();
  assert.equal(damm.address, v.program);
  assert.equal(damm.binarySha256, '967ff9fb161eec2e62f66d2c899100739fb747c445f697b8625c86b31b9a2022');
  assert.equal(damm.sourceCodeMatchVerified, false);
  const archive = readFileSync(new URL('./fixtures/programs-mainnet.json.gz', import.meta.url));
  archive[archive.length - 1] ^= 1;
  assert.throws(() => inspectCapture(archive, {}));
});

test('decode the scheduler from the SDK pool instruction and compare actual SDK arithmetic at every second', () => {
  const instructions = v.initAndLock.filter(ix => ix.program === v.program);
  assert.equal(instructions.length, 2);
  const init = Buffer.from(instructions[0].data, 'hex');
  const lock = Buffer.from(instructions[1].data, 'hex');
  assert.deepEqual(init.subarray(0, 8), disc('initialize_customizable_pool'));
  assert.deepEqual(lock.subarray(0, 8), disc('permanent_lock_position'));
  const fee = init.subarray(8, 35);
  assert.equal(fee.toString('hex'), v.baseFeeHex);
  assert.equal(fee.readBigUInt64LE(0), 900_000_000n);
  assert.equal(fee.readUInt16LE(8), 89);
  assert.equal(fee.readBigUInt64LE(10), 1n);
  assert.equal(fee.readBigUInt64LE(18), 10_000_000n);
  assert.equal(fee[26], 0); // linear time scheduler
  assert.deepEqual([...init.subarray(35, 39)], [0,0,0,0]); // compounding, padding, dynamic Option::None
  assert.equal(init[71], 0); // no alpha vault
  assert.deepEqual(init.subarray(72,88), lock.subarray(8,24));
  assert.deepEqual(init.subarray(39,55), init.subarray(88,104)); // initial price at lower bound
  assert.deepEqual([...init.subarray(104,107)], [1,1,1]); // timestamp, OnlyB, activation Some
  assert.equal(init.readBigUInt64LE(107), BigInt(v.activation));
  assert.equal(init.length, 115);
  assert.equal(v.numerators.length, 92);
  for (const [i, row] of v.numerators.entries()) {
    assert.equal(row.elapsed, i - 1);
    if (row.elapsed < 0) assert.equal(row.numerator, '10000000'); // alpha-vault calculation; access must be disabled
    else assert.equal(BigInt(row.numerator), 100_000n * launchFeeBps({ activatedAt: 0n, at: BigInt(row.elapsed) }));
  }
  const split = launchAllocations({ supply: BigInt(v.supply), activeSeasonWeight: 2013n });
  for (const [k,n] of Object.entries(split)) assert.equal(v.allocation[k], String(n));
});
