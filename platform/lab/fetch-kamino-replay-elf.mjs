// Sole public network step in the Kamino parity workflow. Hard-pin the
// program image; an upgrade must never silently substitute new test behavior.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readAccounts } from './refresh-kamino.mjs';
import { deploymentObservation, FARM_PROGRAM, PROGRAM_DATA } from './kamino.mjs';

const expected = JSON.parse(readFileSync(new URL('./fixtures/kamino-public.json', import.meta.url))).deployment;
const raw = await readAccounts([FARM_PROGRAM, PROGRAM_DATA], expected.contextSlot);
const observed = deploymentObservation(raw);
for (const field of ['allocatedElfSha256', 'deployedSlot', 'program', 'programData', 'upgradeAuthority']) {
  assert.equal(observed[field], expected[field], 'Recorded deployment changed: ' + field);
}
writeFileSync(process.argv[2], Buffer.from(raw.accounts[1].data[0], 'base64').subarray(45), { flag: 'wx' });
console.log(JSON.stringify(observed));
