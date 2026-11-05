import { loadReferenceBoard, saveReferenceBoard, loadReferenceAllocation, saveReferenceAllocation } from './earn-settlement.mjs';
import { computeBoard, computeAllocation } from '../../earn/settlement.mjs';
import { canonicalJson, utf8 } from '../../security/canonical.mjs';
import { transaction } from '../database.mjs';
import { EarnError } from '../../earn/validation.mjs';
import { submitContent, recordReview, readLeaderboard, readWalletClaims, readWalletSubmissions } from './earn-workflow.mjs';
import { ADMIT_SUBMISSION, admissionRequestBytes, FINAL_REVIEW, reviewRequestBytes } from '../../application/commands.mjs';
import { sha256Sync } from '../../security/node-crypto.mjs';
// Synchronous reference transactions finish before each async command resolves.
// Durable command receipts and D1 SQL revisions belong to B02/B07;
// the existing wallet/request-key admission receipt remains authoritative here.
export function createNodeEarnRepository(db,{ids}={}) {
  const version=loaded=>sha256Sync(utf8(canonicalJson(loaded)));
  const load=(loader,args)=>transaction(db,()=>{
    const loaded=loader(db,args);
    return structuredClone({...loaded,versions:{snapshotDigest:version(loaded)}});
  });
  const commit=(loader,compute,save,{query,versions,plan})=>transaction(db,()=>{
    const loaded=loader(db,query);
    if(loaded.result?.status==='final'||loaded.result?.status==='recorded')return {kind:'replayed',value:loaded.result};
    if(version(loaded)!==versions.snapshotDigest)return {kind:'conflict',code:'revision_conflict'};
    if(!loaded.input)return {kind:'pending',reason:loaded.result.reason,dependencyIds:[]};
    const expected=compute(loaded.input);
    if(expected.status!=='ready')return {kind:'pending',reason:expected.reason??expected.status,dependencyIds:[]};
    if(canonicalJson(expected)!==canonicalJson(plan))throw new TypeError('Settlement plan differs from the captured input.');
    const result=save(db,compute===computeBoard?{...plan,finalizedAtMs:query.nowMs,
      snapshotId:sha256Sync(utf8(JSON.stringify(plan.commitmentInput)))}:plan);
    return {kind:'committed',value:result};
  });
  return Object.freeze({
    async admitSubmission(command) {
      const {principal,input}=command;
      if(principal?.kind!=='wallet'||command.operationKind!==ADMIT_SUBMISSION
        ||command.businessIdentity!==principal.wallet+'/'+input.tokenId
        ||command.requestDigest!==sha256Sync(admissionRequestBytes(command))
        ||!command.expectedRevisions||Object.keys(command.expectedRevisions).length!==0)
        throw new TypeError('Invalid reference admission command.');
      return submitContent(db,{wallet:principal.wallet,tokenId:input.tokenId,url:input.url,
        requestKey:command.requestKey,nowMs:command.nowMs},ids?{ids}:undefined);
    },
    async recordFinalReview(command) {
      const {principal,input}=command;
      if(principal?.kind!=='operator'||command.operationKind!==FINAL_REVIEW
        ||command.businessIdentity!==input.submissionId||command.requestKey!==input.submissionId
        ||command.requestDigest!==sha256Sync(reviewRequestBytes(command))
        ||!command.expectedRevisions||Object.keys(command.expectedRevisions).length!==0)
        throw new TypeError('Invalid reference review command.');
      return transaction(db,()=>{
        const prior=db.prepare('SELECT * FROM earn_reviews WHERE submission_id=?').get(input.submissionId);
        if(prior) {
          if(prior.content_score!==input.score||prior.reason!==input.reason||prior.moderator!==principal.id||prior.source_ref!==input.sourceRef)
            throw new EarnError(409,'final_review','This submission has a final decision.');
          return {recorded:true,replayed:true};
        }
        recordReview(db,{...input,moderator:principal.id,reviewedMs:command.nowMs});
        return {recorded:true,replayed:false};
      });
    },
    async loadBoardInput(query) {return load(loadReferenceBoard,query);},
    async commitBoard(command) {return commit(loadReferenceBoard,computeBoard,saveReferenceBoard,command);},
    async loadAllocationInput(query) {return load(loadReferenceAllocation,query);},
    async commitAllocation(command) {return commit(loadReferenceAllocation,computeAllocation,saveReferenceAllocation,command);},
    async readLeaderboard({epoch}) {return readLeaderboard(db,epoch);},
    async readWalletClaims({principal,nowMs,after}) {return readWalletClaims(db,{wallet:principal.wallet,nowMs,after});},
    async readWalletSubmissions({principal,after}) {return readWalletSubmissions(db,{wallet:principal.wallet,after});},
  });
}
