import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { recordSamplePrice } from '../pricing/fixtures.mjs';
import { addCampaign, finalizeBoard, recordAllocation, recordReview, readWalletClaims, submitContent } from './workflow.mjs';
import { recordOwnership } from './components.mjs';
import { configureWorkload, workloadMetrics } from './operations.mjs';
import { exportBoard, importBoard } from './archive.mjs';

// Builds a throwaway synthetic database; never opens a caller's operational DB.
export function runRecoveryDrill() {
  const folder=mkdtempSync(join(tmpdir(),'tenx-fixture-recovery-'));
  const source=openDatabase(join(folder,'operator.sqlite'));
  let restored,publicDb;
  try {
    const epoch=20_100, at=epoch*DAY_MS+120000, cutoff=(epoch+1)*DAY_MS-1, wallet='fixture-test',tokenId='ATT';
    addCampaign(source,{tokenId,activationMs:at,originalUnits:'100000'});
    configureWorkload(source,{effectiveEpoch:epoch,atMs:at,staffedMinutes:12,secondsPerReview:180,admissionLimit:100,operator:'test',reason:'recovery drill'});
    recordSamplePrice(source,{wallet,tokenId,asOfMs:at,stakedUnits:'10000000'});
    const post=submitContent(source,{wallet,tokenId,nowMs:at,requestKey:'retry',url:'https://example.org/sample'}).submission;
    recordReview(source,{submissionId:post.id,score:9,moderator:'fixture',reason:'reviewed',reviewedMs:at,sourceRef:'test-note'});
    recordOwnership(source,{wallet,epoch,asOfMs:cutoff,assets:[],sourceRef:'synthetic empty holdings'});
    const finalize={epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'tested-source'};
    assert.equal(finalizeBoard(source,finalize).reason,'stake-evidence');
    const alloc={tokenId,day:2,nowMs:at+DAY_MS};
    assert.equal(recordAllocation(source,alloc).status,'pending');
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM earn_allocations').get().n,0);
    const backupPath=join(folder,'restored.sqlite');
    // SQLite produces a consistent standalone image, including changes in WAL.
    source.prepare('VACUUM INTO ?').run(backupPath);
    restored=openDatabase(backupPath);
    // Only the restored operator database receives the recovered price observation.
    recordSamplePrice(restored,{wallet,tokenId,asOfMs:cutoff,stakedUnits:'10000000'});
    const published=finalizeBoard(restored,finalize);assert.equal(published.status,'final');
    assert.equal(finalizeBoard(restored,finalize).snapshotId,published.snapshotId);
    assert.equal(recordAllocation(restored,alloc).status,'recorded');
    assert.equal(recordAllocation(restored,alloc).status,'recorded');
    const bundle=exportBoard(restored,epoch);
    publicDb=openDatabase(join(folder,'public.sqlite'));
    importBoard(publicDb,bundle.manifest,bundle.sha256);
    const view={wallet,nowMs:at+730*DAY_MS};
    assert.deepEqual(readWalletClaims(publicDb,view).items,readWalletClaims(restored,view).items);
    assert.equal(publicDb.prepare('SELECT COUNT(*) AS n FROM earn_submissions').get().n,0);
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM earn_boards').get().n,0);
    return {mode:'synthetic-recovery-drill',heldDuringOutage:true,privateBackupRestored:true,
      sourceStillPending:true,replaysIdentical:true,publicClaimsRetained:true,publicContainsPrivateSubmissions:false,
      metrics:workloadMetrics(restored,{epoch,nowMs:cutoff+1})};
  } finally {
    publicDb?.close();restored?.close();source.close();rmSync(folder,{recursive:true,force:true});
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runRecoveryDrill(),null,2));
}
