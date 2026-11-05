import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { encode58 } from '../server/base58.mjs';
import { canonicalJson, commitmentBytes, orderedJson, utf8 } from './canonical.mjs';
import { createNodeCrypto } from './node-crypto.mjs';
import { createWebCrypto } from './web-crypto.mjs';
import { verifyAwardProof, verifyManifest } from '../earn/commitments.mjs';
const golden=JSON.parse(readFileSync(new URL('../application/fixtures/earn-golden.json',import.meta.url),'utf8'));
const adapters=[['node',createNodeCrypto()],['webcrypto',createWebCrypto(webcrypto)]];
test('historical canonical byte encodings retain ordering, Unicode and numeric rules',()=>{
  assert.equal(canonicalJson({z:['é',true,null,9007199254740991],a:-0}),' {"a":0,"z":["é",true,null,9007199254740991]}'.trim());
  assert.throws(()=>canonicalJson({a:1n}),TypeError);
  assert.throws(()=>canonicalJson({a:Infinity}),TypeError);
  assert.throws(()=>canonicalJson({a:undefined}),TypeError);
  assert.equal(orderedJson({z:undefined,a:[undefined,{z:1,a:2}]}),'{"a":[null,{"a":2,"z":1}]}');
});
for(const [runtime,crypto] of adapters) {
  test(runtime+' preserves pinned semantic commitments and every inclusion proof',async()=>{
    const {bundle,allocationDigest}=golden,{manifest}=bundle;
    assert.equal(await crypto.sha256(commitmentBytes('board',manifest.board)),manifest.boardId);
    assert.equal(await crypto.sha256(commitmentBytes('manifest',manifest)),bundle.sha256);
    assert.equal(await crypto.sha256(commitmentBytes('allocation',manifest.allocations[0])),allocationDigest);
    verifyManifest(manifest,bundle.sha256);
    for(const {proof} of golden.proofs) {
      let digest=await crypto.sha256(commitmentBytes('award',[proof.context,proof.award]));
      for(const step of proof.path)digest=await crypto.sha256(commitmentBytes('pair',step.side==='left'?[step.hash,digest]:[digest,step.hash]));
      assert.equal(digest,manifest.allocations[0].awardRoot);
      assert.equal(verifyAwardProof(proof,digest),true);
    }
    // An exact-byte object digest is intentionally different from its semantic
    // format commitment, even though both algorithms are SHA-256.
    assert.notEqual(await crypto.sha256(utf8(JSON.stringify(manifest))),bundle.sha256);
  });
  test(runtime+' retains strict Ed25519 validation with disposable keys',async()=>{
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    const key=encode58(publicKey.export({format:'der',type:'spki'}).subarray(-32));
    const message=utf8('local B01 parity vector'),signature=encode58(sign(null,message,privateKey));
    assert.equal(await crypto.verifyEd25519({publicKey:key,signature,message}),true);
    assert.equal(await crypto.verifyEd25519({publicKey:key,signature,message:utf8('changed')}),false);
    assert.equal(await crypto.verifyEd25519({publicKey:encode58(new Uint8Array(32)),signature,message}),false);
    assert.equal(await crypto.verifyEd25519({publicKey:key,signature:encode58(new Uint8Array(64)),message}),false);
  });
}
