import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletMaterial, publicWallets, requireOutsideRepository } from '../src/wallets.mjs';
import { loopback, hash, validateEvidenceCapture, boundedJson } from '../src/safety.mjs';
import { estimateBudget } from '../src/budget.mjs';
test('independent cryptographic wallet keys roundtrip without a plaintext file', () => {
  const a = createWalletMaterial(), b = createWalletMaterial();
  assert.notDeepEqual(publicWallets(a), publicWallets(b));
  assert.match(publicWallets(a).base, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(JSON.stringify(publicWallets(a)).includes(a.basePrivateKey), false);
  assert.throws(() => requireOutsideRepository(import.meta.dirname), /outside/);
});
test('simulator endpoints reject mainnet and credential-bearing destinations', () => {
  for (const s of ['https://mainnet.base.org', 'http://user:pass@localhost:8899', 'http://localhost.attacker.example']) assert.throws(() => loopback(s));
  assert.equal(loopback('http://127.0.0.1:8899').hostname, '127.0.0.1');
});
test('capture tampering, duplicate accounts and unknown context cannot become replay evidence', () => {
  const account = { address: 'fixture', owner: 'fixture-owner', data: 'aGk=', sha256: hash(Buffer.from('hi')) };
  const manifest = { version: 1, network: 'solana-mainnet', context: 123, capturedAt: new Date().toISOString(), accounts: [account] };
  assert.equal(validateEvidenceCapture(manifest), manifest);
  assert.throws(() => validateEvidenceCapture({ ...manifest, accounts: [account, account] }));
  assert.throws(() => validateEvidenceCapture({ ...manifest, accounts: [{ ...account, data: '' }] }));
});
test('native cost estimates round retry allowance upward and exclude financial permission', () => {
  const b = estimateBudget({ base: [{ label: 'gas', units: '101' }], solana: [{ label: 'rent', units: '2039280' }] });
  assert.equal(b.base.maximum, '127'); assert.equal(b.solana.maximum, '2549100'); assert.equal(b.fundingApproved, false);
  assert.throws(() => estimateBudget({ base: [{ label: 'float', units: '0.1' }] }));
});
test('unbounded provider response is cancelled', async () => {
  await assert.rejects(boundedJson(new Response('x'.repeat(20)), 10), /exceeds/);
});
