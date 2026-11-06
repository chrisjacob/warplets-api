import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {prepareCollectionRecord} from './source-intake.mjs';
import {LEVEL_QUOTAS,drawLevel,seasonExpiry} from '../domain/collections/policy.mjs';
import {CHAIN,genesisMs,leadMs,roundTime,drawRequestPreimage} from '../randomness/request-plan.mjs';
import {beaconSeedPreimage,beaconProofPreimage,pickTrait,validateTraitField} from '../randomness/draw-protocol.mjs';
import {uniformDraw} from '../randomness/portable-draw.mjs';
import {verifyPinnedBeacon} from '../beacon/portable.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(c,code)=>{if(!c){const error=new TypeError(code);error.code=code;throw error;}};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const nat=v=>Number.isSafeInteger(v)&&v>=0;
const time=v=>nat(v)&&v<=8640000000000000;
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const clone=v=>JSON.parse(canonicalJson(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const amount=v=>exact(v,['$lamports'])&&typeof v.$lamports==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v.$lamports)&&BigInt(v.$lamports)<(1n<<64n);
const sha=(crypto,v)=>crypto.sha256(utf8(canonicalJson(v)));
const legacySha=(crypto,v)=>crypto.sha256(utf8(JSON.stringify(v)));
function wallet(v){need(typeof v==='string'&&v.length<=44,'legacy-mint-wallet');decode58(v,32);return v;}
function raw(v,max){need(exact(v,['id','size','bytes'])&&hash(v.id)&&nat(v.size)&&v.size>0&&v.size<=max&&v.bytes instanceof Uint8Array&&v.bytes.length===v.size,'legacy-mint-source-record');return {id:v.id,size:v.size,bytes:v.bytes.slice()};}
async function document(r,crypto){await prepareCollectionRecord(r,crypto);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.bytes));}
function capture(value){need(exact(value,['sourceRoot','admissionPage','asOfMs','prefix','header','operation','originalFixture','collectBinding','vaultBinding','vaultObservation','initialHistory','configured']),'legacy-mint-audit-fields');const sourceRoot=raw(value.sourceRoot,131072),admissionPage=raw(value.admissionPage,65536),{sourceRoot:ignored,admissionPage:ignored2,...rest}=value;need(utf8(canonicalJson(rest)).length<=49152,'legacy-mint-context-bound');return {sourceRoot,admissionPage,...clone(rest)};}
const measured=(m,n)=>{m.workingBytes=Math.max(m.workingBytes,n);need(m.workingBytes<=1048576,'legacy-mint-working-bound');};
async function sourceFacts(f,crypto){
 const root=await document(f.sourceRoot,crypto),page=await document(f.admissionPage,crypto),p=f.prefix;
 need(root.format==='collection-source-v1'&&page.format==='collection-page-v1'&&page.kind==='admissions','legacy-mint-source-kind');need(p&&nat(p.entryIndex)&&p.entryIndex<page.entries.length,'legacy-mint-prefix-cursor');
 const entry=page.entries[p.entryIndex],terms=root.stages.find(s=>s.terms.id===entry.stageId)?.terms;
 const compact={rootId:f.sourceRoot.id,pageId:f.admissionPage.id,root:{format:root.format,source:{inventoryId:root.source.inventoryId},inventory:{id:root.inventory.id,kind:root.inventory.kind,tranche:root.inventory.tranche??null,fulfilled:root.inventory.fulfilled,remaining:root.inventory.remaining},admissions:{pageIds:root.admissions.pageIds},stages:terms?[{terms:{id:terms.id,type:terms.type,priceLamports:terms.priceLamports,costLamports:terms.costLamports}}]:[]},page:{format:page.format,kind:page.kind,index:page.index,entry,entryCount:page.entries.length}};
 // Subsequent policy reads retain only this selected historical fact set.
 f.sourceRoot=null;f.admissionPage=null;return compact;
}
class MissingOriginal extends Error{}
/** Rehash original retained parts. Named storage/immutable identity and prefix
 * ownership are repository obligations; current mutable policy rows are not an
 * implicit source. Each part is verified again if read a second time. */
async function originalPart(ref,ports,max){need(exact(ref,['byteDigest','size'])&&hash(ref.byteDigest)&&nat(ref.size)&&ref.size>0&&ref.size<=max,'legacy-mint-policy-part');need(typeof ports.readOriginalPolicyPart==='function','legacy-mint-policy-reader');const found=await ports.readOriginalPolicyPart(freeze({...ref}));if(found===null||found===undefined)throw new MissingOriginal('original-policy-preimage-missing');need(found instanceof Uint8Array&&found.length===ref.size,'legacy-mint-policy-part-size');const m=ports.meter;m.partReads++;m.partBytes+=ref.size;m.maxPartBytes=Math.max(m.maxPartBytes,ref.size);need(m.partReads<=25,'legacy-mint-policy-read-bound');measured(m,m.baseWorking+6*ref.size+m.namesBytes+m.assetsBytes);const bytes=found.slice();need(await ports.crypto.sha256(bytes)===ref.byteDigest,'legacy-mint-policy-part-digest');const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);need(canonicalJson(value)===text,'legacy-mint-policy-part-canonical');return value;}
async function traitPages(descriptor,ports,visit){
 need(exact(descriptor,['count','pages'])&&nat(descriptor.count)&&descriptor.count>=1&&descriptor.count<=256&&Array.isArray(descriptor.pages)&&descriptor.pages.length===Math.ceil(descriptor.count/64),'legacy-mint-policy-trait-descriptor');
 const names=new Set();let totalWeight=0;
 for(let n=0;n<descriptor.pages.length;n++){const raw=await originalPart(descriptor.pages[n],ports,65536),choices=validateTraitField(raw);need(choices.length===Math.min(64,descriptor.count-n*64)&&same(raw,choices),'legacy-mint-policy-trait-page');for(const choice of choices){need(!names.has(choice.name),'legacy-mint-policy-duplicate-trait');names.add(choice.name);totalWeight+=choice.weight;}ports.meter.namesBytes=2*utf8(canonicalJson([...names])).length;measured(ports.meter,ports.meter.baseWorking+ports.meter.assetsBytes+ports.meter.namesBytes+4*descriptor.pages[n].size);await visit(choices,n);}
 ports.meter.namesBytes=0;return totalWeight;
}
async function configuredDraw(f,ports,operation,slotIndex,remainingTotal){
 const c=f.configured,p=c.policy,r=c.request,result=c.result;
 need(exact(c,['policy','request','result'])&&exact(p,['inventoryId','policyHash','registeredMs','assets','traits'])&&p.inventoryId===operation.inventory_id&&hash(p.policyHash)&&time(p.registeredMs)&&p.registeredMs>=genesisMs&&p.registeredMs<=operation.created_ms&&exact(p.traits,['model','backdrop','symbol']),'legacy-mint-original-policy');
 need(typeof ports.createDigest==='function','legacy-mint-policy-stream-unavailable');const stream=ports.createDigest();let reservedAsset;const totals={};
 try{const assets=await originalPart(p.assets,ports,65536);need(Array.isArray(assets)&&assets.length===1000&&new Set(assets).size===1000,'legacy-mint-policy-assets');assets.forEach(wallet);ports.meter.assetsBytes=3*utf8(canonicalJson(assets)).length;measured(ports.meter,ports.meter.baseWorking+ports.meter.assetsBytes+4*p.assets.size);reservedAsset=assets[slotIndex];await stream.write(utf8(canonicalJson(['10x-lab-draw-1',p.inventoryId,CHAIN,leadMs,p.registeredMs,assets,LEVEL_QUOTAS]).slice(0,-1)+',{'));
  for(const [n,field] of ['backdrop','model','symbol'].entries()){await stream.write(utf8((n?',':'')+JSON.stringify(field)+':['));totals[field]=await traitPages(p.traits[field],ports,async(choices,index)=>{await stream.write(utf8((index?',':'')+canonicalJson(choices).slice(1,-1)));});await stream.write(utf8(']'));}await stream.write(utf8('}]'));need(await stream.finish()===p.policyHash,'legacy-mint-policy-hash');
 }catch(error){await stream.abort(error).catch(()=>{});throw error;}
 ports.meter.assetsBytes=0;
 need(exact(r,['operationId','targetRound','contextDigest'])&&r.operationId===operation.id&&nat(r.targetRound)&&r.targetRound>0&&hash(r.contextDigest),'legacy-mint-original-request');const derived=drawRequestPreimage({policy_hash:p.policyHash,registered_ms:p.registeredMs},{opId:operation.id,kind:'mint',inventoryId:operation.inventory_id,owner:operation.owner,commitment:operation.commitment,now:operation.created_ms});need(r.targetRound===derived.targetRound&&r.contextDigest===await sha(ports.crypto,derived.preimage),'legacy-mint-request-digest');
 need(exact(result,['operationId','proofId','signedRoundJson','fixtureJson','settledMs'])&&result.operationId===operation.id&&result.proofId===operation.proof_id&&time(result.settledMs)&&result.settledMs>=roundTime(r.targetRound)&&result.settledMs<=f.asOfMs&&typeof result.signedRoundJson==='string'&&utf8(result.signedRoundJson).length<=2048&&typeof result.fixtureJson==='string'&&utf8(result.fixtureJson).length<=4096,'legacy-mint-original-result');const proof=JSON.parse(result.signedRoundJson);need(canonicalJson(proof)===result.signedRoundJson,'legacy-mint-signed-round-canonical');let randomness;try{randomness=await verifyPinnedBeacon(proof,r.targetRound,ports.crypto,ports.beaconVerifier);}catch{need(false,'legacy-mint-beacon-verification');}const seed=await sha(ports.crypto,beaconSeedPreimage(r.contextDigest,randomness)),proofId=await sha(ports.crypto,beaconProofPreimage(r.targetRound,seed)),traits={};
 for(const field of ['model','backdrop','symbol']){let pick=await uniformDraw(seed,field,totals[field],ports.crypto);await traitPages(p.traits[field],ports,async choices=>{if(traits[field]!==undefined)return;const weight=choices.reduce((n,v)=>n+v.weight,0);if(pick<weight)traits[field]=pickTrait(choices,pick);else pick-=weight;});need(typeof traits[field]==='string','legacy-mint-trait-selection');}
 const fixture={operationId:operation.id,commitment:operation.commitment,proofId,at:roundTime(r.targetRound),finalized:true,traits,ticket:await uniformDraw(seed,'initial-level',remainingTotal,ports.crypto),assetId:reservedAsset};need(canonicalJson(fixture)===result.fixtureJson,'legacy-mint-fair-result-fixture');return fixture;
}
/** One historical settled mint. A valid result is a private audit fact, never
 * adoption/mint authority. The prefix must come from prior guarded audit steps;
 * this pure function cannot prove that caller-provided counters are reachable. */
function initialMeter(f){const {sourceRoot,admissionPage,...context}=f;return {sourceBytes:sourceRoot.size+admissionPage.size,contextBytes:utf8(canonicalJson(context)).length,partReads:0,partBytes:0,maxPartBytes:0,workingBytes:0,baseWorking:0,namesBytes:0,assetsBytes:0};}
export async function auditLegacyMint(value,ports){const f=capture(value);value=null;const meter=initialMeter(f);measured(meter,4*meter.sourceBytes+3*meter.contextBytes+16384);
 try{return await auditCaptured(f,{...ports,meter});}finally{ports.onMeasure?.({...meter});}
}
async function auditCaptured(f,ports){
 need(time(f.asOfMs),'legacy-mint-audit-clock');const {crypto}=ports,facts=await sourceFacts(f,crypto),{root,page,rootId,pageId}=facts,p=f.prefix,h=f.header,op=f.operation;ports.meter.baseWorking=3*ports.meter.contextBytes+3*utf8(canonicalJson(facts)).length+16384;measured(ports.meter,ports.meter.baseWorking);
 need(root.format==='collection-source-v1'&&page.format==='collection-page-v1'&&page.kind==='admissions','legacy-mint-source-kind');need(exact(p,['rootId','ordinal','pageIndex','entryIndex','remaining'])&&p.rootId===rootId&&nat(p.ordinal)&&p.ordinal<1000&&nat(p.pageIndex)&&p.pageIndex<16&&page.index===p.pageIndex&&root.admissions.pageIds[p.pageIndex]===pageId&&nat(p.entryIndex)&&p.entryIndex<page.entryCount&&p.ordinal<root.inventory.fulfilled,'legacy-mint-prefix-cursor');
 need(Array.isArray(p.remaining)&&p.remaining.length===10&&p.remaining.every((n,i)=>nat(n)&&n<=LEVEL_QUOTAS[i])&&p.remaining.reduce((a,b)=>a+b,0)===1000-p.ordinal,'legacy-mint-prefix-quota');const a=page.entry,stage=root.stages.find(s=>s.terms.id===a.stageId)?.terms;
 need(exact(h,['id','kind','tranche','seasonStart','originDigest'])&&h.id===root.inventory.id&&h.id===root.source.inventoryId&&h.kind===root.inventory.kind&&['genesis','season'].includes(h.kind)&&h.originDigest===await legacySha(crypto,[h.id,h.kind,h.tranche,h.seasonStart]),'legacy-mint-header');need(h.kind==='genesis'?nat(h.tranche)&&h.tranche>=1&&h.tranche<=10&&h.tranche===root.inventory.tranche&&h.seasonStart===null:h.tranche===null&&time(h.seasonStart),'legacy-mint-header-kind');
 need(stage&&amount(stage.priceLamports)&&amount(stage.costLamports)&&amount(a.costLamports)&&same(a.costLamports,stage.costLamports),'legacy-mint-stage-cost');wallet(a.wallet);
 need(op&&op.kind==='mint'&&op.id===a.operationId&&op.inventory_id===h.id&&op.owner===a.wallet&&op.commitment===a.drawCommitment&&op.created_ms===a.admittedAt&&id(op.id)&&id(op.commitment)&&id(op.request_key)&&time(op.created_ms)&&time(op.settled_ms)&&op.settled_ms>=op.created_ms&&op.settled_ms<=f.asOfMs&&op.proof_id===a.proofId&&id(op.proof_id)&&hash(op.evidence_digest)&&op.request_digest===await legacySha(crypto,[stage.type==='founder'?'founder':'mint',h.id,a.stageId]),'legacy-mint-operation');need(same(JSON.parse(op.operation),{stageId:a.stageId,costLamports:stage.costLamports,priceLamports:stage.priceLamports}),'legacy-mint-operation-body');
 if(f.configured!==null){if(f.configured.result===null)return freeze({kind:'held',reason:'original-configured-result-missing'});if(f.configured.request===null)return freeze({kind:'held',reason:'original-configured-request-missing'});if(f.configured.policy===null)return freeze({kind:'held',reason:'original-policy-preimage-missing'});}
 if(f.originalFixture===null&&f.configured===null)return freeze({kind:'held',reason:'original-mint-preimage-missing'});
 let fixture=f.originalFixture;
 if(fixture===null)fixture=JSON.parse(f.configured.result.fixtureJson);
 need(fixture&&fixture.operationId===op.id&&fixture.commitment===op.commitment&&fixture.proofId===op.proof_id&&fixture.at===op.settled_ms&&time(fixture.at)&&fixture.at%1000===0&&fixture.finalized===true&&id(fixture.assetId)&&Number.isInteger(fixture.ticket)&&fixture.ticket===a.ticket,'legacy-mint-original-preimage');
 const visuals={};for(const key of ['model','backdrop','symbol']){const v=fixture.traits?.[key];need(typeof v==='string'&&v.length>0&&v.length<=128&&v.trim().length>0,'legacy-mint-original-traits');visuals[key]=v;}
 const level=drawLevel(p.remaining,fixture.ticket),ordinal=LEVEL_QUOTAS[level-1]-p.remaining[level-1],slotIndex=LEVEL_QUOTAS.slice(0,level-1).reduce((s,n)=>s+n,0)+ordinal;need(level===a.level,'legacy-mint-admission-level');
 if(f.configured!==null){try{const derived=await configuredDraw(f,ports,op,slotIndex,1000-p.ordinal);need(same(derived,fixture),'legacy-mint-configured-preimage');}catch(error){if(error instanceof MissingOriginal)return freeze({kind:'held',reason:error.message});throw error;}}
 const evidenceDigest=await legacySha(crypto,['mint',op.id,fixture.assetId,fixture.proofId,fixture.at,fixture.ticket,op.commitment,visuals]);need(evidenceDigest===op.evidence_digest,'legacy-mint-evidence-digest');
 const slot=h.kind==='genesis'?{kind:'genesis',tranche:h.tranche,level,ordinal}:{kind:'season',seasonId:h.id,slotIndex},slotJson=JSON.stringify(slot),receipt={operationId:op.id,assetId:fixture.assetId,at:fixture.at};need(op.receipt===JSON.stringify(receipt),'legacy-mint-receipt');
 const b=f.collectBinding,v=f.vaultBinding,o=f.vaultObservation;need(b&&b.id===fixture.assetId&&b.inventory_id===h.id&&b.bind_ms===fixture.at&&b.slot===slotJson,'legacy-mint-collect-binding');need(v&&v.id===fixture.assetId&&v.slot_key===slotJson&&v.coords===slotJson,'legacy-mint-vault-slot');const event={eventId:'collect:'+op.id,assetId:fixture.assetId,kind:'bind',at:new Date(fixture.at).toISOString(),owner:a.wallet,slot};need(o&&o.event_id===event.eventId&&o.asset_id===fixture.assetId&&o.kind==='bind'&&o.observed_ms===fixture.at&&o.body===JSON.stringify(event),'legacy-mint-original-vault-event');
 const expectedHistory=h.kind==='season'?[{asset_id:fixture.assetId,effective_ms:fixture.at,level,source_ref:op.id}]:[];need(same(f.initialHistory,expectedHistory),'legacy-mint-initial-history');const remaining=[...p.remaining];remaining[level-1]--;if(p.ordinal+1===root.inventory.fulfilled)need(same(remaining,root.inventory.remaining),'legacy-mint-final-prefix-quota');
 const atEnd=p.entryIndex+1===page.entryCount,nextPrefix={rootId:p.rootId,ordinal:p.ordinal+1,pageIndex:p.pageIndex+(atEnd?1:0),entryIndex:atEnd?0:p.entryIndex+1,remaining};return freeze({kind:'audited',summary:{rootId:p.rootId,admissionPageId:pageId,ordinal:p.ordinal,inventoryId:h.id,operationId:op.id,assetId:fixture.assetId,originalWallet:a.wallet,initialLevel:level,initialExpiryMs:h.kind==='season'?seasonExpiry(h.seasonStart,level):null,slot,legacyEvidenceDigest:evidenceDigest,provenance:f.configured===null?'manual-fixture':'configured-offline-beacon',source:'local-fixture',executable:false},nextPrefix});
}
