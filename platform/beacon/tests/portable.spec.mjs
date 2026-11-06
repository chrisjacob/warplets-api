import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {verifyPinnedBeacon} from '../portable.mjs';
import {createNobleBeaconVerifier} from '../noble-verifier.mjs';
import {verifyBeacon} from '../quicknet.mjs';
const proof=JSON.parse(readFileSync(new URL('../fixtures/round-30000000.json',import.meta.url)));
test('actual pinned noble BLS verifies retained quicknet proof identically in portable and synchronous adapters',async()=>{
 const crypto=createNodeCrypto(),verifier=createNobleBeaconVerifier();assert.equal(await verifyPinnedBeacon(proof,proof.round,crypto,verifier),verifyBeacon(proof,proof.round));
 const signature='82'+proof.signature.slice(2),bytes=Uint8Array.from(signature.match(/../g),v=>parseInt(v,16)),forged={...proof,signature,randomness:await crypto.sha256(bytes)};await assert.rejects(verifyPinnedBeacon(forged,proof.round,crypto,verifier));assert.throws(()=>verifyBeacon(forged,proof.round));
});
