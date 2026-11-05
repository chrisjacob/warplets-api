import {transaction} from '../storage/database.mjs';
import {DAY_MS,MIN_STAKE_MICRO_USD,epochAt,onboardingTenths,multiplierTenths} from '../domain/earn/index.mjs';
import {name,nat,EarnError} from './validation.mjs';
import {observationAt} from '../pricing/evidence.mjs';
import {capacityAt} from './operations.mjs';
import {actionDecision} from '../operations/controls.mjs';
import {recoveryMode} from './archive.mjs';
/** Shared pure display projection of already sealed component evidence. Never
 * substitutes missing ownership/position evidence with a zero-valued preview. */
export function finalizedMemberComponents(row){
 if(!row)return null;
 const m=JSON.parse(row.payload);
 const components={actionTenths:onboardingTenths(row.epoch,m.intervals,m.completions),streakDays:row.streak_days??0,
  highestEligibleLevel:m.highestEligibleLevel,purchaseTokenDays:m.purchaseTokenDays};
 return {epoch:row.epoch,cutoffAt:new Date((row.epoch+1)*DAY_MS-1).toISOString(),...components,
  multiplierTenths:multiplierTenths(components),sourceRef:row.source_ref,snapshotDigest:row.snapshot_hash};
}
/** New owner-only Node read seam; authentication must provide the principal.
 * Admission is a point-in-time preview and never a reservation or final award.
 * Current cutoff components remain pending until the complete board is sealed.
 */
export function readMemberStatus(db,principal,nowMs){
 if(principal?.kind!=='wallet')throw new EarnError(401,'authentication_required','Connect your wallet.');
 const wallet=name(principal.wallet,'wallet');nat(nowMs,'now');
 return transaction(db,()=>{
  const epoch=epochAt(nowMs),capacity=capacityAt(db,epoch,nowMs),decision=actionDecision(db,'earn-admission',nowMs);
  const held=recoveryMode(db)?'read-only-archive':!decision.allowed?decision.reason:!capacity.accepting?'board-capacity':
    db.prepare('SELECT 1 FROM earn_boards WHERE epoch=?').get(epoch)?'board-closed':null;
  const campaigns=db.prepare('SELECT token_id FROM earn_fixture_campaigns WHERE activation_ms<=? AND activation_ms+?>? ORDER BY token_id LIMIT 11').all(nowMs,10*DAY_MS,nowMs);
  const admission=campaigns.length>10?{status:'unavailable',reason:'campaign-bound',items:[]}:{status:'complete',reason:null,items:campaigns.map(({token_id:tokenId})=>{
   const valuation=observationAt(db,wallet,tokenId,nowMs);
   const accepted=db.prepare('SELECT id FROM earn_submissions WHERE epoch=? AND wallet=? AND token_id=?').get(epoch,wallet,tokenId);
   const reason=accepted?'already-accepted':held??(valuation.status!=='verified'?'stake-evidence-pending':BigInt(valuation.microUsd)<MIN_STAKE_MICRO_USD?'stake-ineligible':null);
   return {tokenId,status:accepted?'accepted':reason===null?'eligible':reason==='stake-evidence-pending'?'pending':'held',reason,
    stakeMicroUsd:valuation.status==='verified'?valuation.microUsd:null,stakeObservedAt:valuation.asOfMs===undefined?null:new Date(valuation.asOfMs).toISOString(),
    sourceRef:valuation.receipt??null};
  })};
  const actions=db.prepare(`SELECT a.id AS actionId,a.label,a.verifier,c.effective_epoch AS startEpoch,
    v.verified_ms,v.source_ref FROM earn_action_catalog a JOIN earn_action_changes c ON c.action_id=a.id AND c.effective_epoch=(
      SELECT MAX(z.effective_epoch) FROM earn_action_changes z WHERE z.action_id=a.id AND z.effective_epoch<=?)
    LEFT JOIN earn_action_completions v ON v.action_id=a.id AND v.wallet=? AND v.verifier=a.verifier AND v.verified_ms<=?
    WHERE c.enabled=1 ORDER BY a.id LIMIT 101`).all(epoch,wallet,nowMs);
  const final=db.prepare(`SELECT f.epoch,f.payload,f.source_ref,b.snapshot_hash,s.days AS streak_days FROM earn_member_facts f
    JOIN earn_boards b ON b.epoch=f.epoch LEFT JOIN earn_streaks s ON s.epoch=f.epoch AND s.wallet=f.wallet
    WHERE f.wallet=? AND b.finalized_ms<=? ORDER BY f.epoch DESC LIMIT 1`).get(wallet,nowMs);
  return {mode:'local-fixture',asOf:new Date(nowMs).toISOString(),epoch,admission,
    actions:actions.length>100?{status:'unavailable',reason:'action-bound',items:[]}:{status:'complete',reason:null,items:actions.map(a=>({actionId:a.actionId,label:a.label,verifier:a.verifier,startEpoch:a.startEpoch,
      status:a.verified_ms===null?'pending':'verified',verifiedAt:a.verified_ms===null?null:new Date(a.verified_ms).toISOString(),sourceRef:a.source_ref}))},
    currentCutoff:{status:'pending',reason:'board-not-sealed',cutoffAt:new Date((epoch+1)*DAY_MS-1).toISOString()},
    latestFinalComponents:finalizedMemberComponents(final),multiplierBounds:{minimumTenths:1,maximumTenths:100}};
 });
}
