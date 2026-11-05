import {canonicalJson} from '../security/canonical.mjs';
import {text,time,requireEvidence} from './envelope.mjs';
export const CUTOFF_FACT_KINDS=Object.freeze(['campaign-registry','ownership','position-inventory','action-completions']);
const fail=(status,reason)=>({status,reason,scope:'synthetic-transcript',coverage:{complete:false,gaps:[reason]},decoded:null});
const exact=(value,keys)=>requireEvidence(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'cutoff-item-fields');
function normalizeItem(kind,item,wallet,cutoffMs){
 if(kind==='campaign-registry'){
  exact(item,['tokenId','activationMs']);requireEvidence(text(item.tokenId)&&time(item.activationMs)&&item.activationMs<=cutoffMs,'campaign-time-or-identity');
  return [item.tokenId,{tokenId:item.tokenId,activationMs:item.activationMs}];
 }
 if(kind==='ownership'){
  exact(item,['assetId','collectionId','owner','chain','level']);
  requireEvidence(text(item.assetId)&&text(item.collectionId)&&item.owner===wallet&&item.chain==='solana'&&Number.isInteger(item.level)&&item.level>=1&&item.level<=10,'ownership-item');
  return [item.assetId,{assetId:item.assetId,collectionId:item.collectionId,owner:wallet,chain:'solana',level:item.level}];
 }
 if(kind==='position-inventory'){
  exact(item,['tokenId','enrolledMs','activationMs']);
  requireEvidence(text(item.tokenId)&&time(item.enrolledMs)&&time(item.activationMs)&&item.activationMs<=item.enrolledMs&&item.enrolledMs<=cutoffMs&&item.enrolledMs<item.activationMs+10*86400000,'position-inventory-item');
  return [item.tokenId,{tokenId:item.tokenId,enrolledMs:item.enrolledMs,activationMs:item.activationMs}];
 }
 exact(item,['actionId','verifiedAtMs','verifier','sourceRef']);
 requireEvidence(text(item.actionId)&&text(item.verifier)&&text(item.sourceRef)&&time(item.verifiedAtMs)&&item.verifiedAtMs<=cutoffMs,'action-completion-item');
 return [item.actionId,{actionId:item.actionId,verifiedAtMs:item.verifiedAtMs,verifier:item.verifier,sourceRef:item.sourceRef}];
}
// This decoder proves only the explicitly registered synthetic interval. It
// never upgrades a provider's empty response into real-chain historical proof.
export function decodeCutoffFacts(source,payload,envelope){
 try{
  if(source.mode!=='synthetic-fixture'||!['local-solana','solana-local'].includes(payload?.network))return fail('incompatible','cutoff-synthetic-mode-required');
  const kind=source.policy.kind;
  if(!CUTOFF_FACT_KINDS.includes(kind)||payload.version!==1||payload.kind!==kind)return fail('incompatible','cutoff-kind');
  if(canonicalJson(payload.subject??null)!==canonicalJson(source.subject)||canonicalJson(envelope.subject??source.subject)!==canonicalJson(source.subject))return fail('incompatible','cutoff-subject');
  if(!time(payload.fromMs)||!time(payload.toMs)||payload.fromMs>payload.toMs||payload.fromMs!==source.policy.fromMs)return fail('invalid','cutoff-interval');
  if(payload.toMs!==envelope.requestedCutoffMs)return fail('pending','cutoff-boundary');
  if(!Array.isArray(payload.pages)||payload.pages.length>20)return fail('invalid','cutoff-page-bound');
  if(!payload.pages.length)return fail('pending','cutoff-pages-missing');
  let cursor=null,count=0;const cursors=new Set(),items=new Map();
  for(let index=0;index<payload.pages.length;index++){
   const page=payload.pages[index];
   if(index>0&&cursor===null)return fail('invalid','cutoff-after-terminal-page');
   if(!page||page.cursor!==cursor)return fail('pending','cutoff-page-gap');
   if(page.nextCursor!==null&&!text(page.nextCursor))return fail('invalid','cutoff-cursor');
   if(cursors.has(page.cursor))return fail('invalid','cutoff-cursor-cycle');cursors.add(page.cursor);
   if(page.nextCursor!==null&&cursors.has(page.nextCursor))return fail('invalid','cutoff-cursor-cycle');
   if(!Array.isArray(page.items)||page.items.length>100)return fail('invalid','cutoff-page-item-bound');
   for(const item of page.items){
    if(++count>(kind==='ownership'?1000:100))return fail('invalid','cutoff-item-bound');
    const [id,value]=normalizeItem(kind,item,source.subject.id,payload.toMs);
    if(items.has(id))return fail('invalid','cutoff-duplicate-item');items.set(id,value);
   }
   cursor=page.nextCursor;
  }
  if(cursor!==null||payload.complete!==true)return fail('pending','cutoff-incomplete');
  const values=[...items].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,value])=>value);
  const key={'campaign-registry':'campaigns',ownership:'assets','position-inventory':'positions','action-completions':'completions'}[kind];
  const value=kind==='campaign-registry'?{[key]:values}:{wallet:source.subject.id,[key]:values};
  return {status:'verified',reason:'synthetic-cutoff-facts-validated',scope:'synthetic-transcript',coverage:{complete:true,fromMs:payload.fromMs,toMs:payload.toMs,gaps:[]},decoded:{kind,value,legacyNetwork:payload.network}};
 }catch(error){return fail('invalid',error.message??'invalid-cutoff-facts');}
}
