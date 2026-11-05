import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../storage/database.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { exportBoard, importBoard, proofForWallet, recoveryMode } from './archive.mjs';
import { commitment, verifyAwardProof, verifyManifest } from './commitments.mjs';
import { recordOwnership } from './components.mjs';
import { runArchive } from './archive-cli.mjs';
import { addCampaign, finalizeBoard, readLeaderboard, readWalletClaims, recordAllocation,
  recordReview, recordStakeRead, submitContent } from './workflow.mjs';

const epoch=20_001,start=epoch*DAY_MS,cutoff=start+DAY_MS-1;
function original(t,path=':memory:') {
  const db=openDatabase(path);t.after(()=>db.close());
  addCampaign(db,{tokenId:'A',activationMs:start,originalUnits:'1000000'});
  const wallets=['w3','w1','w2'];
  for (const wallet of wallets) {
    const read={wallet,tokenId:'A',microUsd:'10000000',sourceRef:'private-proof-'+wallet};
    recordStakeRead(db,{...read,observedMs:start,expiresMs:start});
    const post=submitContent(db,{wallet,tokenId:'A',requestKey:'private-key-'+wallet,
      url:'https://private.example/posts/'+wallet,nowMs:start}).submission;
    recordReview(db,{submissionId:post.id,score:7,moderator:'private-moderator',reason:'private assessment',
      sourceRef:'private source',reviewedMs:start});
    recordStakeRead(db,{...read,observedMs:cutoff,expiresMs:cutoff});
    recordOwnership(db,{wallet,epoch,asOfMs:cutoff,assets:[],sourceRef:'private-owner'});
  }
  finalizeBoard(db,{epoch,nowMs:cutoff+1,sourceRef:'private-reconciliation',sourceComplete:true});
  recordAllocation(db,{tokenId:'A',day:2,nowMs:start+DAY_MS});
  return db;
}
function secondAllocation(db) {
  addCampaign(db,{tokenId:'B',activationMs:start+DAY_MS+321,originalUnits:'100000'});
  recordAllocation(db,{tokenId:'B',day:1,nowMs:start+DAY_MS+321});
}
test('a portable board commits public awards only; pinned proofs verify each leaf of an odd-sized tree',t=>{
  const db=original(t);
  const bundle=exportBoard(db,epoch);
  assert.doesNotMatch(JSON.stringify(bundle),/private[-. ]/);
  assert.equal(verifyManifest(bundle.manifest,bundle.sha256).allocations,1);
  const allocation=bundle.manifest.allocations[0];
  for (const wallet of ['w3','w1','w2']) {
    const result=proofForWallet(db,{wallet,tokenId:'A',day:2});
    assert.equal(result.manifestDigest,bundle.sha256);
    assert.equal(verifyAwardProof(result.proof,allocation.awardRoot),true);
    result.proof.award.amountUnits='9999';
    assert.equal(verifyAwardProof(result.proof,allocation.awardRoot),false);
  }
  assert.throws(()=>proofForWallet(db,{wallet:'other',tokenId:'A',day:2}),/no award/);
});

test('semantic reconciliation rejects altered payouts and vesting even with recomputed outer hash',t=>{
  const db=original(t);const bundle=exportBoard(db,epoch);
  const modified=structuredClone(bundle.manifest);
  modified.allocations[0].awards[0].amountUnits='8';
  assert.throws(()=>verifyManifest(modified,bundle.sha256),/pinned digest/);
  assert.throws(()=>verifyManifest(modified,commitment('manifest',modified)),/capped point/);
  modified.allocations[0]=structuredClone(bundle.manifest.allocations[0]);modified.allocations[0].vestsThroughMs++;
  assert.throws(()=>verifyManifest(modified,commitment('manifest',modified)),/schedule/);
  // Simulate a corrupted operational ledger, not a user edit or financial transfer.
  db.prepare('UPDATE earn_allocations SET burn=? WHERE token_id=? AND day=?').run('7001','A',2);
  assert.throws(()=>exportBoard(db,epoch),/Burn does not reconcile/);
});

test('restore is additive and idempotent; an older bundle cannot discard later allocations',t=>{
  const db=original(t);const target=openDatabase();t.after(()=>target.close());
  const first=exportBoard(db,epoch);
  assert.throws(()=>importBoard(db,first.manifest,first.sha256),/separate recovery/);
  importBoard(target,first.manifest,first.sha256);
  secondAllocation(db);
  const second=exportBoard(db,epoch);
  assert.notEqual(second.sha256,first.sha256);
  assert.equal(second.manifest.boardId,first.manifest.boardId);
  assert.equal(importBoard(target,second.manifest,second.sha256).addedAllocations,1);
  assert.equal(importBoard(target,first.manifest,first.sha256).addedAllocations,0);
  assert.equal(exportBoard(target,epoch).sha256,second.sha256);
  assert.equal(recoveryMode(target),true);
  assert.throws(()=>addCampaign(target,{tokenId:'new',activationMs:start,originalUnits:'10000'}),/read-only/);
  const restored=readLeaderboard(target,epoch);
  assert.equal(restored.source,'public-archive');
  assert.equal(restored.allocations.length,2);
  const claimArgs={wallet:'w2',nowMs:start+DAY_MS*700};
  const live=readWalletClaims(db,claimArgs), saved=readWalletClaims(target,claimArgs);
  assert.deepEqual(saved.items,live.items);
  assert.equal(saved.executionEnabled,false);
});

test('offline CLI verifies an independently pinned digest and recovers from a separate file',t=>{
  const directory=mkdtempSync(join(tmpdir(),'tenx-public-archive-'));
  const source=join(directory,'source.sqlite'),backup=join(directory,'board.json'),restored=join(directory,'new.sqlite');
  const db=original(t,source);
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const result=runArchive(['export',source,String(epoch),backup]);
  assert.equal(runArchive(['verify',backup,result.sha256]).boardId,result.boardId);
  assert.throws(()=>runArchive(['export',source,String(epoch),backup]),/exist/i);
  assert.equal(runArchive(['restore',restored,backup,result.sha256]).addedAllocations,1);
  const rebuilt=openDatabase(restored);
  try {
    assert.equal(readLeaderboard(rebuilt,epoch).snapshotId,readLeaderboard(db,epoch).snapshotId);
    assert.equal(JSON.parse(readFileSync(backup,'utf8')).sha256,result.sha256);
  } finally { rebuilt.close(); }
});
