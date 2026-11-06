import {decode58,encode58} from '../server/base58.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
export const MAX_EVIDENCE_BYTES=256*1024;
export const clone=value=>JSON.parse(canonicalJson(value));
export const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value;
export const time=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
export function requireEvidence(condition,reason){if(!condition)throw new TypeError(reason);}
const keys=['version','evidenceId','mode','chainGenesis','sourceId','sourceRevision','subject','requestedCutoffMs','contextSlot','blockTimeMs','retrievedAtMs','ingestedAtMs','finality','decoderVersion','byteDigest','objectRef','supersedes'];
export function validateEnvelope(value){
 const e=clone(value);requireEvidence(Object.keys(e).length===keys.length&&keys.every(k=>Object.hasOwn(e,k)),'envelope-fields');
 requireEvidence(e.version===1&&digest(e.evidenceId)&&['synthetic-fixture','recorded-public','runtime-read'].includes(e.mode),'envelope-version-or-mode');
 for(const key of ['sourceId','sourceRevision','decoderVersion'])requireEvidence(text(e[key]),'envelope-'+key);
 requireEvidence(e.chainGenesis===null||text(e.chainGenesis),'chain-identity');
 requireEvidence(e.subject&&Object.keys(e.subject).length===2&&text(e.subject.kind)&&text(e.subject.id),'subject-identity');
 requireEvidence(e.requestedCutoffMs===null||time(e.requestedCutoffMs),'requested-cutoff');
 requireEvidence(e.contextSlot===null||(typeof e.contextSlot==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(e.contextSlot)&&BigInt(e.contextSlot)<=(1n<<64n)-1n),'context-slot');
 requireEvidence(e.blockTimeMs===null||time(e.blockTimeMs),'block-time');
 requireEvidence(time(e.retrievedAtMs)&&time(e.ingestedAtMs),'retrieval-ingestion-time');
 requireEvidence(['unverified','confirmed','finalized'].includes(e.finality),'finality');
 requireEvidence(digest(e.byteDigest)&&e.objectRef==='private/'+e.byteDigest+'.json','private-byte-identity');
 requireEvidence(e.supersedes===null||digest(e.supersedes),'supersession');return Object.freeze(e);
}
export function validateSource(value){
 const s=clone(value);
 requireEvidence(s.version===1&&text(s.sourceId)&&text(s.sourceRevision)&&text(s.decoderVersion),'source-identity');
 requireEvidence(['synthetic-fixture','recorded-public'].includes(s.mode),'recorded-source-mode');
 requireEvidence(s.chainGenesis===null||text(s.chainGenesis),'source-chain');
 requireEvidence(digest(s.recordingDigest),'recording-digest');
 requireEvidence(Number.isSafeInteger(s.maxBytes)&&s.maxBytes>0&&s.maxBytes<=MAX_EVIDENCE_BYTES,'source-byte-bound');
 requireEvidence(Number.isSafeInteger(s.maxAgeMs)&&s.maxAgeMs>0&&s.maxAgeMs<=86400000,'source-age-bound');
 requireEvidence(s.subject&&Object.keys(s.subject).length===2&&text(s.subject.kind)&&text(s.subject.id),'source-subject');
 requireEvidence(s.policy&&typeof s.policy==='object'&&!Array.isArray(s.policy),'source-policy');
 if(['damm-pool-v1','spl-mint-v1','spl-vault-v1'].includes(s.decoderVersion))requireEvidence(text(s.policy.ownerProgram),'source-program-required');
 if(s.decoderVersion==='damm-pool-v1')requireEvidence(['attMint','ogMint','attVault','ogVault'].every(k=>text(s.policy.expected?.[k])),'source-pool-identities');
 if(s.decoderVersion==='spl-vault-v1')requireEvidence(text(s.policy.expected?.mint),'source-vault-mint');
 if(['synthetic-position-history-v1','synthetic-position-history-v2'].includes(s.decoderVersion))requireEvidence(['wallet','tokenId','farmProgram','swapProgram'].every(k=>text(s.policy[k]))&&time(s.policy.enrolledAtMs),'source-history-identities');
 if(s.decoderVersion==='synthetic-cutoff-facts-v1')requireEvidence(['campaign-registry','ownership','position-inventory','action-completions'].includes(s.policy.kind)&&time(s.policy.fromMs),'source-cutoff-policy');
 if(['synthetic-transaction-outcome-v1','synthetic-transaction-height-v1'].includes(s.decoderVersion)){
  requireEvidence(s.mode==='synthetic-fixture'&&s.chainGenesis==='8CBzMMmYAECcNqRdJvjM3N43pPYT1ez9yVdxdbDjwzv8'&&s.maxBytes<=4096
   &&Object.keys(s.policy).sort().join(',')==='attemptId,intentId,messageHash,owner,planHash'
   &&['intentId','attemptId'].every(k=>typeof s.policy[k]==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(s.policy[k]))
   &&digest(s.policy.planHash)&&digest(s.policy.messageHash)&&s.subject.kind==='transaction-attempt'&&s.subject.id===s.policy.attemptId,'source-transaction-outcome-policy');
  try{requireEvidence(typeof s.policy.owner==='string'&&encode58(decode58(s.policy.owner,32))===s.policy.owner,'source-transaction-outcome-owner');}catch{requireEvidence(false,'source-transaction-outcome-owner');}
 }
 if(s.decoderVersion==='synthetic-collection-observation-v1')requireEvidence(s.mode==='synthetic-fixture'&&s.maxBytes<=16384&&Object.keys(s.policy).length===2&&['inventoryId','assetId'].every(k=>typeof s.policy[k]==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(s.policy[k]))&&s.subject.kind==='collection-asset'&&s.subject.id===s.policy.assetId,'source-collection-observation-policy');
 if(s.decoderVersion==='synthetic-collection-progression-v1')requireEvidence(s.mode==='synthetic-fixture'&&s.maxBytes<=16384&&Object.keys(s.policy).length===2&&['inventoryId','operationId'].every(k=>typeof s.policy[k]==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(s.policy[k]))&&s.subject.kind==='collection-operation'&&s.subject.id===s.policy.operationId,'source-collection-progression-policy');
 if(s.decoderVersion==='synthetic-collection-mint-v1')requireEvidence(s.mode==='synthetic-fixture'&&s.maxBytes<=16384&&Object.keys(s.policy).length===2&&['inventoryId','operationId'].every(k=>typeof s.policy[k]==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(s.policy[k]))&&s.subject.kind==='collection-operation'&&s.subject.id===s.policy.operationId,'source-collection-mint-policy');
 requireEvidence(utf8(canonicalJson(s)).byteLength<=65536,'source-config-bound');return Object.freeze(s);
}
export const streamKey=e=>canonicalJson([e.sourceId,e.subject.kind,e.subject.id,e.requestedCutoffMs]);
