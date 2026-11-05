import {sql,revisions} from './atomic-driver.mjs';
import {createCutoffSnapshotRepository} from './cutoff-snapshot.mjs';
import {allocationWindow} from '../domain/earn/index.mjs';
import {nat,name,requireValue} from '../earn/validation.mjs';
const pending=reason=>({kind:'pending',reason,dependencyIds:[]});
// Read-only preparation seam. A sealed reference alone is insufficient: only
// a ready B05 attempt and its immutable private identity qualify for planning.
export function createSettlementPreparationRepository(driver,ports){
 const snapshots=createCutoffSnapshotRepository(driver,ports);
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 return Object.freeze({
  readVersions:snapshots.readVersions,readPointer:snapshots.readPointer,
  selectHeads:snapshots.selectHeads,loadBoardInput:snapshots.loadBoardInput,
  async loadBoardPreparation({epoch}){
   nat(epoch,'epoch');
   const [versionRows,boards,sealedRows]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),
    sql('SELECT * FROM earn_boards WHERE epoch=?',epoch),
    sql(`SELECT i.*,a.size,a.content_type,a.semantic_digest,s.requirements_digest,s.evidence_digest,s.dependency_versions AS attempt_versions
      FROM app_epoch_inputs p JOIN app_complete_inputs i ON i.manifest_digest=p.manifest_digest
      JOIN app_snapshot_attempts s ON s.manifest_digest=i.manifest_digest AND s.status='ready' AND s.epoch=i.epoch
       AND s.object_key=i.object_key AND s.byte_digest=i.byte_digest AND s.input_digest=i.input_digest
      JOIN app_private_artifacts a ON a.object_key=i.object_key AND a.byte_digest=i.byte_digest AND a.semantic_digest=i.manifest_digest
      WHERE p.epoch=?`,epoch)]);
   if(boards[0]){const b=boards[0];return {kind:'final',epoch,snapshotId:b.snapshot_hash,winners:JSON.parse(b.winners),finalizedAtMs:b.finalized_ms};}
   const r=sealedRows[0];if(!r)return pending('complete-manifest-required');
   return {kind:'loaded',versions:revisions(versionRows),sealed:{epoch:r.epoch,manifestDigest:r.manifest_digest,inputDigest:r.input_digest,
    objectKey:r.object_key,byteDigest:r.byte_digest,asOfMs:r.as_of_ms,sourceRef:r.source_ref,dependencyVersions:JSON.parse(r.dependency_versions)},
    attempt:{epoch:r.epoch,status:'ready',manifestDigest:r.manifest_digest,inputDigest:r.input_digest,objectKey:r.object_key,byteDigest:r.byte_digest,
     requirementsDigest:r.requirements_digest,evidenceDigest:r.evidence_digest,dependencyVersions:JSON.parse(r.attempt_versions)},
    manifestIdentity:{key:r.object_key,byteDigest:r.byte_digest,size:r.size,semanticDigest:r.semantic_digest,contentType:r.content_type,visibility:'private'}};
  },
  async loadAllocationPreparation({tokenId,day,nowMs}){
   name(tokenId,'token');nat(nowMs,'now');requireValue(Number.isInteger(day)&&day>=1&&day<=10,'Invalid campaign day.');
   const [versionRows,campaigns,allocations]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),
    sql('SELECT activation_ms,original_units FROM earn_fixture_campaigns WHERE token_id=?',tokenId),
    sql('SELECT * FROM earn_allocations WHERE token_id=? AND day=?',tokenId,day)]);
   if(allocations[0])return {kind:'recorded',value:{mode:'local-fixture',status:'recorded',allocation:allocations[0]}};
   if(!campaigns[0])return pending('campaign-required');
   const c=campaigns[0],window=allocationWindow(c.activation_ms,day);
   const [boards]=await read([sql('SELECT * FROM earn_boards WHERE epoch=?',window.boardEpoch)]);
   const b=boards[0];return {kind:'loaded',versions:revisions(versionRows),campaign:{activationMs:c.activation_ms,originalSupplyUnits:c.original_units},
    board:b?{epoch:b.epoch,status:'final',winners:JSON.parse(b.winners),snapshotId:b.snapshot_hash}:null};
  },
 });
}
