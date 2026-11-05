// Explicit operator-only refresh of a reference snapshot. The fixed endpoint
// is Solana's free public RPC and the only permitted method is account read.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deploymentObservation, inspectKamino, FARM_PROGRAM, PROGRAM_DATA, GLOBALS, REFERENCE_FARM } from './kamino.mjs';

const endpoint = 'https://api.mainnet-beta.solana.com';
async function readAccounts(addresses, minContextSlot) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
        params: [addresses, { commitment: 'finalized', encoding: 'base64', minContextSlot }] }) });
    if (!response.ok) throw Error('Public Solana RPC returned ' + response.status);
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 20_000_000) { controller.abort(); throw Error('Public RPC response exceeded the lab budget'); }
      chunks.push(chunk);
    }
    const { error, result } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (error || !result || result.context.slot < minContextSlot) throw Error('RPC failed to provide a finalized snapshot');
    return { rpc: endpoint, commitment: 'finalized', retrievedAt: new Date().toISOString(), addresses,
      context: result.context, accounts: result.value };
  } finally { clearTimeout(deadline); }
}

export function compactObservation(programSnapshot, farmSnapshot) {
  const result = { schemaVersion: 1, sourceRevision: 'bfa186034ba8ecd36e7faf27cae6b38ee24d0bc4',
    deployment: deploymentObservation(programSnapshot), farmSnapshot };
  inspectKamino(result);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--read-public-accounts') throw Error('Use --read-public-accounts for an explicit free public RPC read.');
  const program = await readAccounts([FARM_PROGRAM, PROGRAM_DATA], 465649698);
  const farm = await readAccounts([REFERENCE_FARM, ...GLOBALS], program.context.slot);
  const evidence = compactObservation(program, farm);
  writeFileSync(new URL('./fixtures/kamino-public.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(inspectKamino(evidence), null, 2));
}
