import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readAccounts } from './refresh-kamino.mjs';
import { inspectUpgradeableDeployment } from './kamino.mjs';

const candidate = process.argv[3] ?? 'rewards';
assert(['rewards','core'].includes(candidate));
const expected = JSON.parse(readFileSync(new URL('./fixtures/' + candidate + '-program.json', import.meta.url)));
const raw = await readAccounts([expected.program, expected.programData], expected.contextSlot);
const observed = inspectUpgradeableDeployment(raw, expected.program, expected.programData);
for (const key of ['allocatedElfSha256','deployedSlot','upgradeAuthority','programDataLength']) {
  assert.equal(observed[key], expected[key], candidate + ' deployment changed: ' + key);
}
writeFileSync(process.argv[2], Buffer.from(raw.accounts[1].data[0], 'base64').subarray(45), { flag: 'wx' });
console.log(JSON.stringify(observed));
