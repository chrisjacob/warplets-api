import {prepareMintAdmission} from '../domain/collections/inventory.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
const assert=(condition,message)=>{if(!condition)throw new TypeError(message);};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const revision=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const amount=value=>{assert(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value),'Invalid decimal amount.');return BigInt(value);};
export async function createMintReservationCommand(input,{crypto}){
 const args=structuredClone(input);assert(args.principal?.kind==='wallet','Expected wallet principal.');decode58(args.principal.wallet,32);
 assert(id(args.requestKey)&&Number.isSafeInteger(args.nowMs)&&args.nowMs>=0,'Invalid request identity or clock.');
 const body=args.input;assert(body&&Object.keys(body).length===4&&body.kind==='mint'&&id(body.inventoryId)&&id(body.stageId)&&/^[a-f0-9]{64}$/.test(body.expectedTermsDigest),'Invalid mint reservation input.');
 assert(args.expectedRevisions&&Object.entries(args.expectedRevisions).every(([key,value])=>['earn','source','control'].includes(key)&&revision(value)),'Invalid expected revisions.');
 const operationKind='collection.reserve-operation.v1',businessIdentity=canonicalJson([args.principal.wallet,args.requestKey]);
 const requestDigest=await crypto.sha256(utf8(canonicalJson([operationKind,args.principal,body])));
 return freeze({...args,operationKind,businessIdentity,requestDigest});
}
/** Pure decision only: no receipt, scope admission, database write or financial
 * action. The application must resolve accepted command replay before this plan. */
export function planMintReservation(command,input,{operationId,commitment}){
 const c=structuredClone(command),facts=structuredClone(input),stage=facts.stage;
 assert(c.operationKind==='collection.reserve-operation.v1'&&c.principal.kind==='wallet'&&c.input.kind==='mint','Expected named mint command.');
 assert(c.input.inventoryId===facts.inventoryId&&c.input.stageId===stage.id&&c.input.expectedTermsDigest===stage.termsDigest&&revision(facts.inventoryRevision),'Collection terms or revision mismatch.');
 assert(facts.membership.wallet===c.principal.wallet&&facts.membership.stageId===stage.id&&typeof facts.membership.eligible==='boolean','Membership identity mismatch.');
 assert(stage.type==='public'||!facts.membership.eligible||typeof facts.membership.sourceId==='string'&&/^[a-f0-9]{64}$/.test(facts.membership.sourceId),'Missing sealed membership identity.');
 assert(stage.type!=='founder','Founder reservation requires a separate scoped operator command.');
 const prepared=prepareMintAdmission({...facts,stage:{...stage,approvedSpendLamports:stage.approvedSpendLamports===null?undefined:amount(stage.approvedSpendLamports)},eligible:facts.membership.eligible,
  founderSpentLamports:amount(facts.founderSpentLamports),priorOperation:facts.priorOperation?{...facts.priorOperation,costLamports:amount(facts.priorOperation.costLamports)}:null},
  {operationId,wallet:c.principal.wallet,stageId:stage.id,at:c.nowMs,drawCommitment:commitment,costLamports:amount(stage.costLamports)});
 const delta=prepared.replayed?0:1;
 return freeze({status:'ready',replayed:prepared.replayed,inventoryId:facts.inventoryId,inventoryRevision:facts.inventoryRevision,stageId:stage.id,termsDigest:stage.termsDigest,membershipSourceId:facts.membership.sourceId,
  admission:{...prepared.admission,costLamports:prepared.admission.costLamports.toString()},effects:{inventoryAdmissionDelta:delta,stageAdmissionDelta:delta,walletAdmissionDelta:delta}});
}
