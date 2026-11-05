import {decodePoolAccount,decodeMintAccount,decodeVaultAccount} from '../quotes/accounts.mjs';
import {normalizePolicy,assessObservation} from '../pricing/policy.mjs';
import {applyPurchaseActivity,enrollPosition} from '../domain/earn/index.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {time,text} from './envelope.mjs';
const decision=(status,reason,scope,decoded=null,gaps=[])=>({status,reason,scope,coverage:{complete:false,gaps},decoded});
const legacy=n=>n==='local-solana'||n==='solana-local';
function history(source,payload,envelope){
 const p=source.policy;
 if(source.mode!=='synthetic-fixture'||!legacy(payload.network))return decision('incompatible','history-adapter-unavailable','decoder-only');
 if(payload.wallet!==p.wallet||payload.tokenId!==p.tokenId)return decision('incompatible','position-identity','synthetic-transcript');
 if(!time(payload.enrolledAtMs)||payload.enrolledAtMs!==p.enrolledAtMs||!time(payload.throughMs))return decision('invalid','history-time','synthetic-transcript');
 if(!Array.isArray(payload.pages)||payload.pages.length>20)return decision('invalid','history-page-bound','synthetic-transcript');
 if(!payload.pages.length)return decision('pending','history-coverage-missing','synthetic-transcript');
 let cursor=null,position=enrollPosition(p.wallet,p.tokenId),previousTime=payload.enrolledAtMs,count=0;
 const signatures=new Set(),purchases=new Set(),cursors=new Set();let pageIndex=0;
 for(const page of payload.pages){
  if(pageIndex++>0&&cursor===null)return decision('invalid','history-after-terminal-page','synthetic-transcript');
  if(page.nextCursor!==null&&!text(page.nextCursor))return decision('invalid','history-cursor','synthetic-transcript');
  if(page.cursor!==cursor||!Array.isArray(page.events)||page.events.length>100)return decision('pending','history-page-gap','synthetic-transcript');
  if(cursors.has(page.cursor))return decision('invalid','history-cursor-cycle','synthetic-transcript');
  cursors.add(page.cursor);
  if(page.nextCursor!==null&&cursors.has(page.nextCursor))return decision('invalid','history-cursor-cycle','synthetic-transcript');
  for(const event of page.events){
   count++;if(count>1000)return decision('invalid','history-event-bound','synthetic-transcript');
   if(!time(event.atMs))return decision('pending','missing-event-time','synthetic-transcript');
   if(event.atMs<previousTime||event.atMs>payload.throughMs)return decision('invalid','history-time-order','synthetic-transcript');
   if(event.finality!=='finalized')return decision('pending','provisional-history','synthetic-transcript');
   if(event.wallet!==p.wallet||event.tokenId!==p.tokenId||event.program!==p.farmProgram)return decision('incompatible','history-identity','synthetic-transcript');
   if(!text(event.signature)||!Number.isSafeInteger(event.instructionIndex)||event.instructionIndex<0)return decision('invalid','history-instruction','synthetic-transcript');
   const key=canonicalJson([event.signature,event.instructionIndex]);if(signatures.has(key))return decision('invalid','duplicate-instruction','synthetic-transcript');signatures.add(key);
   if(event.sequence!==position.sequence+1)return decision('pending','history-sequence-gap','synthetic-transcript');
   const e={...event,confirmed:true};
   for(const field of ['netBoughtUnits','depositedUnits','withdrawnUnits','remainingStakeUnits'])if(Object.hasOwn(e,field)){
    if(typeof e[field]!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(e[field])||BigInt(e[field])>(1n<<64n)-1n)return decision('invalid','history-units','synthetic-transcript');e[field]=BigInt(e[field]);
   }
   if(e.type==='verified-buy-and-stake'){
    if(purchases.has(e.signature))return decision('invalid','duplicate-purchase','synthetic-transcript');purchases.add(e.signature);
    if(!e.swap||!e.deposit||e.swap.program!==p.swapProgram||e.swap.wallet!==p.wallet||e.deposit.wallet!==p.wallet||
      e.swap.tokenId!==p.tokenId||e.deposit.tokenId!==p.tokenId||e.swap.signature!==e.signature||e.deposit.signature!==e.signature||
      e.swap.netBoughtUnits!==event.netBoughtUnits||e.deposit.depositedUnits!==event.depositedUnits||e.deposit.instructionIndex!==e.instructionIndex||!Number.isSafeInteger(e.swap.instructionIndex)||e.swap.instructionIndex<0||e.swap.instructionIndex>=e.instructionIndex)
      return decision('incompatible','unlinked-purchase-deposit','synthetic-transcript');
   }
   position=applyPurchaseActivity(position,e);previousTime=e.atMs;
  }
  cursor=page.nextCursor;
 }
 if(cursor!==null||payload.complete!==true||payload.throughMs!==envelope.requestedCutoffMs)return decision('pending','incomplete-history','synthetic-transcript',null,['history-coverage']);
 return {status:'verified',reason:'synthetic-history-validated',scope:'synthetic-transcript',coverage:{complete:true,fromMs:payload.enrolledAtMs,toMs:payload.throughMs,gaps:[]},
  decoded:{wallet:p.wallet,tokenId:p.tokenId,sequence:position.sequence,creditedUnits:String(position.creditedUnits),flags:position.flags,legacyNetwork:payload.network}};
}
export function decodeRecorded(source,record,envelope){
 let payload;
 try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(record.bytes));}catch{return decision('invalid','malformed-json','decoder-only');}
 if(envelope.retrievedAtMs>envelope.ingestedAtMs||envelope.blockTimeMs!==null&&envelope.blockTimeMs>envelope.retrievedAtMs)return decision('invalid','future-recording-clock','decoder-only');
 if(envelope.requestedCutoffMs!==null&&envelope.requestedCutoffMs>envelope.ingestedAtMs)return decision('pending','cutoff-not-reached','decoder-only');
 if(record.bytes.length>source.maxBytes)return decision('invalid','source-byte-bound','decoder-only');
 if(source.mode==='recorded-public'&&envelope.chainGenesis===null)return decision('pending','missing-chain-identity','decoder-only');
 if(envelope.contextSlot===null||envelope.blockTimeMs===null)return decision('pending','missing-chain-time','decoder-only');
 if(envelope.finality!=='finalized')return decision('pending','unfinalized-recording','decoder-only');
 const effectiveCutoff=envelope.requestedCutoffMs??envelope.ingestedAtMs;
 if(envelope.blockTimeMs>effectiveCutoff)return decision('pending','future-cutoff-observation','decoder-only');
 if(effectiveCutoff-envelope.blockTimeMs>source.maxAgeMs)return decision('pending','stale-cutoff-observation','decoder-only');
 try{
  if(source.decoderVersion==='synthetic-position-history-v1')return history(source,payload,envelope);
  if(source.decoderVersion==='synthetic-pricing-v1'){
   if(source.mode!=='synthetic-fixture'||payload.pool?.network!=='local-solana')return decision('incompatible','legacy-fixture-mode-required','decoder-only');
   const policy=normalizePolicy(source.policy);
   if(payload.wallet!==source.subject.id||payload.tokenId!==policy.tokenId)return decision('incompatible','valuation-subject','synthetic-transcript');
   if(payload.asOfMs!==envelope.requestedCutoffMs)return decision('pending','valuation-cutoff-mismatch','synthetic-transcript');
   if(String(payload.pool.slot)!==envelope.contextSlot||payload.pool.observedMs!==envelope.blockTimeMs)return decision('incompatible','valuation-recording-context','synthetic-transcript');
   const result=assessObservation(policy,payload);
   return {status:result.status,reason:result.reason??'synthetic-valuation-validated',scope:'synthetic-transcript',coverage:{complete:result.status==='verified',gaps:result.status==='verified'?[]:[result.reason]},decoded:{...result,legacyNetwork:policy.network}};
  }
  const decoders={'damm-pool-v1':decodePoolAccount,'spl-mint-v1':decodeMintAccount,'spl-vault-v1':decodeVaultAccount};
  const decoder=decoders[source.decoderVersion];if(!decoder)return decision('incompatible','decoder-version','decoder-only');
  if(payload===null)return decision('pending','account-missing','decoder-only');
  if(payload.address!==source.subject.id||payload.owner!==source.policy.ownerProgram)return decision('incompatible','account-identity','decoder-only');
  const decoded=decoder(payload);
  for(const [key,value] of Object.entries(source.policy.expected??{}))if(decoded[key]!==value)return decision('incompatible','decoded-identity-'+key,'decoder-only');
  return decision('verified','account-layout-validated','decoder-only',decoded,['historical-coverage-unavailable']);
 }catch(error){
  return decision(error.code==='program_owner'||error.code==='token_program'?'incompatible':'invalid',error.code??'invalid-decoder-input','decoder-only');
 }
}
