import {sql} from '../storage/atomic-driver.mjs';
import {utf8} from '../security/canonical.mjs';
const need=(v,reason)=>{if(!v)throw Error('fairness-progression-'+reason);};
const bounded=(field,size=16384,alias=field.split('.').at(-1))=>`CASE WHEN length(CAST(${field} AS BLOB))<=${size} THEN ${field} ELSE NULL END ${alias}`;
const parse=(v,max=16384)=>{need(typeof v==='string'&&utf8(v).length<=max,'record-bound');return JSON.parse(v);};
const time=v=>Number.isSafeInteger(v)&&v>=0;
/** Internal normalized040/042 reader. Caller owns principal authentication,
 * total read bounds and a final generation/watermark fence after BLS replay. */
export async function readProgressionFairnessFacts(m,{read,receipt,now}){
 need(['upgrade','visual'].includes(m.op_kind)&&time(m.created_ms)&&m.created_ms<=now,'operation');
 const [reservations]=await read([sql(`SELECT ${['operation_id','quote_id','quote_binding_digest','target_id','material_id','fair_policy_hash','context_digest','command_operation_id'].map(k=>bounded('r.'+k,128)).join(',')},r.fair_registered_ms,r.target_round,${bounded('r.operation_json')},${bounded('r.result_json')},${bounded('r.target_after_json')},${bounded('r.material_after_json')},(SELECT count(*) FROM app_collection_operation_conflicts c WHERE c.operation_id=r.operation_id) held_count FROM app_collection_reservations r WHERE r.operation_id=? LIMIT 1`,m.op_id)]);
 if(!reservations.length)return null;
 const r=reservations[0],reserved=await receipt(r.command_operation_id),body=parse(r.operation_json),result=reserved.result;
 need(r.operation_id===m.op_id&&r.operation_json===m.op_operation&&reserved.row.r_operation_kind==='collection.reserve-operation.v1'&&reserved.row.r_result_ref===m.op_id&&reserved.row.r_result_json===r.result_json&&reserved.principal.kind==='wallet'&&reserved.principal.wallet===m.op_owner&&reserved.row.created_ms===m.created_ms,'reservation-receipt');
 need(reserved.input.inventoryId===m.op_inventory_id&&reserved.input.kind===m.op_kind&&reserved.input.targetId===r.target_id&&reserved.input.materialId===r.material_id&&reserved.input.quoteId===r.quote_id&&reserved.input.bindingDigest===r.quote_binding_digest&&result.operationId===m.op_id&&result.inventoryId===m.op_inventory_id&&result.wallet===m.op_owner&&result.quoteId===r.quote_id&&result.bindingDigest===r.quote_binding_digest&&result.createdMs===m.created_ms&&result.status==='awaiting-evidence'&&result.executable===false&&result.kind===m.op_kind&&result.targetId===r.target_id&&result.materialId===r.material_id,'reservation-binding');
 need(body.operationId===m.op_id&&body.kind===m.op_kind&&body.commitment===m.op_commitment&&body.signer===m.op_owner&&body.targetId===r.target_id&&body.materialId===r.material_id,'original-operation');
 const target=parse(r.target_after_json),material=r.material_id===null?null:parse(r.material_after_json);
 need(target.id===r.target_id&&target.pending===m.op_id&&target.owner===m.op_owner&&(m.op_kind==='visual'?material===null:material&&material.id===r.material_id&&material.pending===m.op_id&&material.owner===m.op_owner),'reserved-participants');
 const configured=r.fair_policy_hash!==null;
 const [links]=await read([sql(`SELECT ${['evidence_receipt_digest','byte_digest','proof_id','command_operation_id'].map(k=>bounded('f.'+k,128)).join(',')},f.effective_ms,${bounded('f.result_json')},${bounded('f.effect_json',131072)},${bounded('p.policy_hash',64)},p.registered_ms,fr.target_round,${bounded('fr.context_digest',64)},e.status evidence_status,${bounded('e.envelope_json')},${bounded('e.decision_json')} FROM collect_operations o LEFT JOIN app_collection_fulfillments f ON f.operation_id=o.id LEFT JOIN fair_inventories p ON p.inventory_id=o.inventory_id LEFT JOIN fair_requests fr ON fr.operation_id=o.id LEFT JOIN app_evidence_receipts e ON e.receipt_digest=f.evidence_receipt_digest WHERE o.id=? LIMIT 1`,m.op_id)]);
 need(links.length===1,'links');const l=links[0];
 if(configured)need(l.policy_hash===r.fair_policy_hash&&l.registered_ms===r.fair_registered_ms&&l.target_round===r.target_round&&l.context_digest===r.context_digest,'request-binding');
 const facts={operation:{id:m.op_id,kind:m.op_kind,inventoryId:m.op_inventory_id,owner:m.op_owner,rawCommitment:m.op_commitment,createdMs:m.created_ms,settledMs:m.settled_ms,proofId:m.op_proof_id},policy:configured?{policyHash:r.fair_policy_hash,registeredMs:r.fair_registered_ms,traitChoices:null}:null,request:configured?{targetRound:r.target_round,contextDigest:r.context_digest}:null,result:null,assignment:null,disclosure:{selectedRevealed:false,participantsRevealed:false,mintPrefixRevealed:false},remainingQuotas:null,waiting:r.held_count?'conflict':'entropy'};
 if(l.command_operation_id===null){need(m.settled_ms===null&&m.op_proof_id===null&&m.op_receipt===null,'unlinked-result');return facts;}
 const fulfilled=await receipt(l.command_operation_id),effect=parse(l.effect_json,131072),accepted=fulfilled.result;
 need(fulfilled.row.r_operation_kind==='collection.fulfill-operation.v1'&&fulfilled.row.r_result_ref===m.op_id&&fulfilled.row.r_result_json===l.result_json&&fulfilled.input.operationId===m.op_id&&fulfilled.input.evidenceReceiptId===l.evidence_receipt_digest&&fulfilled.input.evidenceDigest===l.byte_digest,'fulfillment-receipt');
 need(accepted.operationId===m.op_id&&accepted.kind===m.op_kind&&accepted.targetId===r.target_id&&accepted.materialId===r.material_id&&accepted.proofId===m.op_proof_id&&accepted.proofId===l.proof_id&&accepted.effectiveMs===l.effective_ms&&m.settled_ms===l.effective_ms&&accepted.status==='fulfilled'&&accepted.executable===false&&accepted.evidenceReceiptId===l.evidence_receipt_digest,'fulfillment-binding');
 need(l.evidence_status==='verified'&&parse(l.envelope_json).byteDigest===l.byte_digest,'evidence-binding');
 const decoded=parse(l.decision_json).decoded;need(decoded.inventoryId===m.op_inventory_id&&decoded.operationId===m.op_id&&decoded.commitment===m.op_commitment&&decoded.kind===m.op_kind,'evidence-operation');
 need(effect.operationReceiptJson===m.op_receipt&&effect.target.id===r.target_id&&effect.target.beforeJson===r.target_after_json&&(m.op_kind==='visual'?effect.material===null:effect.material?.id===r.material_id&&effect.material.beforeJson===r.material_after_json),'effect-binding');
 const participants=[effect.target,...(effect.material?[effect.material]:[])];
 const [assets]=await read([sql(`SELECT id,inventory_id,reveal_ms,observed_ms,${bounded('slot',4096)} FROM collect_assets WHERE id IN (?,?) ORDER BY id`,r.target_id,r.material_id??r.target_id)]);
 need(assets.length===participants.length,'participants-missing');
 const revealed=participants.every(w=>{const a=assets.find(x=>x.id===w.id);return a&&a.inventory_id===m.op_inventory_id&&time(w.revealMs)&&w.revealMs<=m.created_ms&&a.reveal_ms===w.revealMs&&a.reveal_ms<=now&&a.slot===w.slotJson&&time(a.observed_ms)&&a.observed_ms>=l.effective_ms&&a.observed_ms<=now;});
 facts.assignment={irreversible:true,assetId:r.target_id,level:null};facts.disclosure.selectedRevealed=revealed;facts.disclosure.participantsRevealed=revealed;facts.waiting=r.held_count?'conflict':'fulfillment';
 if(!configured||!revealed||r.held_count)return facts;
 const [proofs]=await read([sql(`SELECT ${bounded('p.traits',131072)},${bounded('f.proof_id',128)},${bounded('f.signed_round',4096)},${bounded('f.fixture')},f.settled_ms FROM fair_results f JOIN fair_inventories p ON p.inventory_id=? WHERE f.operation_id=? LIMIT 1`,m.op_inventory_id,m.op_id)]);
 need(proofs.length===1,'proof-missing');const proof=proofs[0];
 need(effect.fairResult&&proof.proof_id===l.proof_id&&effect.fairResult.proofId===proof.proof_id&&effect.fairResult.signedRoundJson===proof.signed_round&&effect.fairResult.fixtureJson===proof.fixture&&effect.fairResult.settledMs===proof.settled_ms,'proof-binding');
 if(m.op_kind==='visual')facts.policy.traitChoices=parse(proof.traits,131072);
 facts.result={proofId:proof.proof_id,proof:parse(proof.signed_round,4096),fixture:parse(proof.fixture)};
 return facts;
}
