import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('decision packet pins retained source bytes and leaves every release decision unresolved',async()=>{
 const packet=JSON.parse(await readFile(new URL('./financial-decisions.json',import.meta.url),'utf8'));
 for(const source of packet.sources){assert.match(source.commit,/^[a-f0-9]{40}$/);const bytes=await readFile(new URL('../../../'+source.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),source.digest);}
 assert.equal(packet.financialExecution,false);assert.equal(packet.releaseAuthorized,false);assert.equal(packet.metadataProvider,null);assert.equal(packet.identityCustodyProvider,null);
 for(const d of packet.decisions){assert.equal(d.reviewOwner,null);assert.equal(d.selectedOption,null);assert.equal(d.releaseAuthorized,false);assert.ok(d.options.length>=2&&d.unlockEvidence.length>=2);}
 const byId=Object.fromEntries(packet.decisions.map(d=>[d.id,d]));assert.equal(byId['farm-authority'].status,'incompatible');assert.equal(byId['external-burn-and-metadata'].status,'incompatible');assert.match(byId['earn-calendar'].finding,/UTC.*day-eleven/);assert.match(byId['public-claim-rarity'].unlockEvidence.join(' '),/without delaying or withholding vested rights/);
});
