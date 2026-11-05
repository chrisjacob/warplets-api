import { createAtomicReceipts } from './atomic-receipts.mjs';
import { loadAtomicBoardInput } from './atomic-board-input.mjs';
import { sql,revisions,matchesExpectedRevisions } from './atomic-driver.mjs';
import { canonicalJson,utf8 } from '../security/canonical.mjs';
import { computeBoard,computeAllocation } from '../earn/settlement.mjs';
import { allocationWindow } from '../domain/earn/index.mjs';
import { name,nat,requireValue } from '../earn/validation.mjs';
export const SEAL_INPUT='earn.seal-input.v1',COMMIT_BOARD='earn.commit-board.v1',COMMIT_ALLOCATION='earn.commit-allocation.v1';
const conflict=code=>({kind:'conflict',code}),pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const clone=value=>JSON.parse(canonicalJson(value));
const requestBytes=c=>utf8(canonicalJson([c.operationKind,c.principal,c.input,c.expectedRevisions]));
const business=(kind,input)=>canonicalJson(kind===SEAL_INPUT?[input.epoch,input.manifestDigest]:kind===COMMIT_BOARD?[input.epoch]:[input.tokenId,input.day]);
export const settlementFenceKey=(kind,input)=>kind+':'+business(kind,input);
export async function createSettlementCommand(operationKind,args,crypto) {
  const command=clone({...args,operationKind,expectedRevisions:args.expectedRevisions??{}});
  command.businessIdentity=business(operationKind,command.input);command.requestDigest=await crypto.sha256(requestBytes(command));return command;
}
export function createAtomicSettlementRepository(driver,{crypto,ids,clock,telemetry={record(){}}}) {
  const receipts=createAtomicReceipts(driver,{crypto,ids,telemetry}),{read,replay,execute}=receipts;
  const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
  async function validate(command,kind) {
    if(command.operationKind!==kind||command.principal?.kind!=='operator')throw new TypeError('Invalid settlement authority.');
    name(command.principal.id,'operator');name(command.requestKey,'request key');nat(command.nowMs,'now');
    if(command.businessIdentity!==business(kind,command.input)||command.requestDigest!==await crypto.sha256(requestBytes(command)))throw new TypeError('Invalid settlement digest.');
    return replay(command);
  }
  async function authority(command,scope,version) {
    if(!matchesExpectedRevisions(command.expectedRevisions,version))return conflict('revision_conflict');
    const [rows]=await read([sql('SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope=?',command.principal.id,scope)]);
    return rows[0]?.enabled?null:conflict('operator_scope_required');
  }
  function fence(command,lease) {
    if(!lease||lease.businessKey!==settlementFenceKey(command.operationKind,command.input))throw new TypeError('Lease belongs to another settlement.');
    name(lease.token,'lease token');name(lease.payloadDigest,'lease payload');
    requireValue(typeof lease.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(lease.revision),'Invalid lease revision.');
    return {authoritySql:`EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-settlement' AND enabled=1)
      AND EXISTS(SELECT 1 FROM app_execution_fences WHERE business_key=? AND holder_token=? AND revision=? AND payload_digest=? AND expires_ms>? AND expires_ms>${driver.leaseNowSql??"CAST(unixepoch('subsec') * 1000 AS INTEGER)"})`,
      authorityValues:()=>[command.principal.id,lease.businessKey,lease.token,Number(lease.revision),lease.payloadDigest,nat(clock.nowMs(),'commit clock')]};
  }
  return Object.freeze({
    // This is a storage seam for B05's coverage service, not an assertion that
    // arbitrary object contents prove historical completeness.
    async sealBoardInput(value) {
      const command=clone(value),prior=await validate(command,SEAL_INPUT);if(prior)return prior;
      const i=command.input;nat(i.epoch,'epoch');nat(i.asOfMs,'input time');name(i.sourceRef,'source reference');
      for(const key of ['manifestDigest','inputDigest','byteDigest'])requireValue(/^[a-f0-9]{64}$/.test(i[key]),'Invalid input digest.');
      const loaded=await loadAtomicBoardInput(driver,crypto,{epoch:i.epoch,nowMs:i.asOfMs,sourceRef:i.sourceRef});
      if(loaded.kind!=='loaded')return loaded.kind==='final'?conflict('board_closed'):loaded;
      if(loaded.inputDigest!==i.inputDigest)return conflict('input_digest_mismatch');
      const denied=await authority(command,'earn-snapshot',loaded.versions);if(denied)return denied;
      const [objects,pointers]=await read([sql('SELECT * FROM app_private_artifacts WHERE object_key=?',i.objectKey),sql('SELECT manifest_digest FROM app_epoch_inputs WHERE epoch=?',i.epoch)]);
      if(!objects[0]||objects[0].byte_digest!==i.byteDigest||objects[0].semantic_digest!==i.manifestDigest)return pending('verified-input-object-required');
      if((pointers[0]?.manifest_digest??null)!==i.previousManifestDigest)return conflict('input_pointer_changed');
      const pointerSql=i.previousManifestDigest===null?'NOT EXISTS(SELECT 1 FROM app_epoch_inputs WHERE epoch=?)':'EXISTS(SELECT 1 FROM app_epoch_inputs WHERE epoch=? AND manifest_digest=?)';
      return execute(command,{businessKey:command.businessIdentity,input:i,result:{epoch:i.epoch,manifestDigest:i.manifestDigest,inputDigest:i.inputDigest},resultRef:i.manifestDigest,version:loaded.versions,
        authoritySql:`EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-snapshot' AND enabled=1) AND ${pointerSql}`,
        authorityValues:[command.principal.id,i.epoch,...(i.previousManifestDigest===null?[]:[i.previousManifestDigest])],
        child:(gate,v)=>[
          sql(`INSERT INTO app_complete_inputs SELECT ?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
            i.manifestDigest,i.epoch,i.inputDigest,i.objectKey,i.byteDigest,i.asOfMs,i.sourceRef,canonicalJson(loaded.versions),...v,...v),
          sql(`INSERT INTO app_epoch_inputs SELECT ?,? WHERE ${gate} ON CONFLICT(epoch) DO UPDATE SET manifest_digest=excluded.manifest_digest`,i.epoch,i.manifestDigest,...v),
        ]});
    },
    async commitBoard(value,leaseValue) {
      const command=clone(value),lease=clone(leaseValue),prior=await validate(command,COMMIT_BOARD);if(prior)return prior;
      const i=command.input;nat(i.epoch,'epoch');
      const [inputs]=await read([sql(`SELECT i.* FROM app_complete_inputs i JOIN app_epoch_inputs p ON p.manifest_digest=i.manifest_digest
        WHERE p.epoch=? AND i.manifest_digest=?`,i.epoch,i.manifestDigest)]);
      const sealed=inputs[0];if(!sealed)return pending('complete-input-required');
      const loaded=await loadAtomicBoardInput(driver,crypto,{epoch:i.epoch,nowMs:sealed.as_of_ms,sourceRef:sealed.source_ref});
      if(loaded.kind!=='loaded')return loaded.kind==='final'?conflict('board_closed'):loaded;
      if(loaded.inputDigest!==sealed.input_digest||canonicalJson(loaded.versions)!==sealed.dependency_versions)return conflict('input_revision_changed');
      const denied=await authority(command,'earn-settlement',loaded.versions);if(denied)return denied;
      const plan=computeBoard(loaded.input);if(plan.status!=='ready')return pending(plan.reason);
      if(await hash(plan)!==i.planDigest)return conflict('plan_digest_mismatch');
      const snapshotId=await crypto.sha256(utf8(JSON.stringify(plan.commitmentInput))),winners=JSON.stringify(plan.winners);
      const input={epoch:i.epoch,manifestDigest:i.manifestDigest,sourceRef:plan.sourceRef,winners,decisions:plan.decisions,facts:plan.factSources,streaks:plan.streaks};
      const guard=fence(command,lease);guard.authoritySql+=' AND EXISTS(SELECT 1 FROM app_epoch_inputs WHERE epoch=? AND manifest_digest=?)';const values=guard.authorityValues;guard.authorityValues=()=>[...values(),i.epoch,i.manifestDigest];
      return execute(command,{businessKey:command.businessIdentity,input,
        result:{mode:'local-fixture',epoch:i.epoch,date:new Date(i.epoch*86400000).toISOString().slice(0,10),status:'final',items:plan.winners,allocations:[],snapshotId,finalizedAtMs:command.nowMs},
        resultRef:snapshotId,version:loaded.versions,...guard,
        child:(gate,v)=>[
          sql(`INSERT INTO earn_boards SELECT ?,?,?,?,? WHERE ${gate}`,i.epoch,winners,command.nowMs,snapshotId,plan.sourceRef,...v),
          ...plan.factSources.map(([wallet,ref,payload])=>sql(`INSERT INTO earn_member_facts SELECT ?,?,?,? WHERE ${gate}`,i.epoch,wallet,payload,ref,...v)),
          ...plan.decisions.map(d=>sql(`INSERT INTO earn_decisions SELECT ?,?,?,? WHERE ${gate}`,d.submissionId,i.epoch,Number(d.qualified),d.cutoffEvidence,...v)),
          ...plan.streaks.map(s=>sql(`INSERT INTO earn_streaks SELECT ?,?,?,? WHERE ${gate}`,i.epoch,s.wallet,s.days,s.lastApprovalMs,...v)),
        ]});
    },
    async commitAllocation(value,leaseValue) {
      const command=clone(value),lease=clone(leaseValue),prior=await validate(command,COMMIT_ALLOCATION);if(prior)return prior;
      const i=command.input;name(i.tokenId,'token');requireValue(Number.isInteger(i.day)&&i.day>=1&&i.day<=10,'Invalid campaign day.');
      const [versionRows,campaigns,stored]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),
        sql('SELECT activation_ms,original_units FROM earn_fixture_campaigns WHERE token_id=?',i.tokenId),sql('SELECT 1 FROM earn_allocations WHERE token_id=? AND day=?',i.tokenId,i.day)]);
      if(stored.length)return conflict('allocation_recorded');if(!campaigns[0])return conflict('unknown_campaign');
      const version=revisions(versionRows),denied=await authority(command,'earn-settlement',version);if(denied)return denied;
      const campaign=campaigns[0],window=allocationWindow(campaign.activation_ms,i.day);
      const [boards]=await read([sql('SELECT epoch,winners,snapshot_hash FROM earn_boards WHERE epoch=?',window.boardEpoch)]);
      if(!boards[0])return pending('board-required');if(boards[0].snapshot_hash!==i.boardDigest)return conflict('board_digest_mismatch');
      const plan=computeAllocation({tokenId:i.tokenId,day:i.day,nowMs:command.nowMs,originalSupplyUnits:campaign.original_units,
        activationMs:campaign.activation_ms,board:{epoch:window.boardEpoch,status:'final',winners:JSON.parse(boards[0].winners)}});
      if(plan.status!=='ready')return pending(plan.status);
      if(await hash(plan)!==i.planDigest)return conflict('plan_digest_mismatch');
      const allocation={token_id:i.tokenId,day:i.day,epoch:plan.boardEpoch,starts_ms:plan.startsAtMs,vests_from_ms:plan.vestsFromMs,
        vests_through_ms:plan.vestsThroughMs,budget:plan.budgetUnits,burn:plan.burnUnits};
      const guard=fence(command,lease);guard.authoritySql+=' AND EXISTS(SELECT 1 FROM earn_boards WHERE epoch=? AND snapshot_hash=?)';const values=guard.authorityValues;guard.authorityValues=()=>[...values(),window.boardEpoch,i.boardDigest];
      return execute(command,{businessKey:command.businessIdentity,input:plan,result:{mode:'local-fixture',status:'recorded',allocation},resultRef:canonicalJson([i.tokenId,i.day]),version,...guard,
        child:(gate,v)=>[
          sql(`INSERT INTO earn_allocations SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,i.tokenId,i.day,plan.boardEpoch,plan.startsAtMs,plan.vestsFromMs,plan.vestsThroughMs,plan.budgetUnits,plan.burnUnits,...v),
          ...plan.awards.map(a=>sql(`INSERT INTO earn_awards SELECT ?,?,?,? WHERE ${gate}`,i.tokenId,i.day,a.wallet,a.amountUnits,...v)),
        ]});
    },
    loadBoardInput(query){return loadAtomicBoardInput(driver,crypto,query);},
  });
}
