import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { encode58 } from '../server/base58.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
export const captureSha256 = '4159978c9699c5ae450fff95a2c1b022ab04d38a49b2c5b4675f3dfbfa9c6296';
const loader = 'BPFLoaderUpgradeab1e11111111111111111111111';

// Reuse October's independently pinned account archive; inspect loader state
// and ELF bytes, never trust a fixture's own description of its authorities.
export function inspectCapture(archive, pin) {
  assert.equal(sha256(archive), captureSha256);
  assert.equal(pin.captureSha256, captureSha256);
  const evidence = JSON.parse(gunzipSync(archive, { maxOutputLength: 16 * 1024 * 1024 }));
  assert.equal(evidence.network, 'solana-mainnet');
  assert.equal(evidence.context, 463107036);
  assert.equal(pin.context, evidence.context);
  assert.equal(pin.capturedAt, evidence.capturedAt);
  const accounts = new Map();
  for (const account of evidence.accounts) {
    assert(!accounts.has(account.address));
    assert.equal(account.owner, loader);
    const bytes = Buffer.from(account.data, 'base64');
    assert.equal(sha256(bytes), account.sha256);
    accounts.set(account.address, { account, bytes });
  }
  return pin.programs.map(program => {
    const { account, bytes } = accounts.get(program.address);
    assert.equal(account.executable, true);
    assert.equal(bytes.readUInt32LE(0), 2); // UpgradeableLoaderState::Program
    const linked = encode58(bytes.subarray(4, 36));
    assert.equal(linked, account.programData);
    const data = accounts.get(linked);
    assert.equal(data.account.executable, false);
    assert.equal(data.bytes.readUInt32LE(0), 3); // ProgramData
    assert.equal(String(data.bytes.readBigUInt64LE(4)), program.deployedSlot);
    const option = data.bytes[12];
    assert(option === 0 || option === 1);
    assert.equal(option ? encode58(data.bytes.subarray(13, 45)) : null, program.upgradeAuthority);
    const elf = data.bytes.subarray(45);
    assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
    assert.equal(sha256(elf), program.binarySha256);
    return { ...program, contextSlot: evidence.context, capturedAt: evidence.capturedAt, sourceCodeMatchVerified: false };
  });
}
export function inspectStoredCapture() {
  return inspectCapture(readFileSync(new URL('./fixtures/programs-mainnet.json.gz', import.meta.url)),
    JSON.parse(readFileSync(new URL('./fixtures/programs.json', import.meta.url))));
}
