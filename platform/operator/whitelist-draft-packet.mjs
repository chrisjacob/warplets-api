/** Read-only local draft summary. Contains no addresses and conveys no authority. */
export const WHITELIST_DRAFT_PACKET_MAX_BYTES=16384;
const fail=()=>{throw new TypeError('Invalid whitelist draft summary.');};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const field=(o,k)=>{if(!plain(o))fail();const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value'))fail();return d.value;};
const nat=(v,max=10000)=>Number.isSafeInteger(v)&&v>=0&&v<=max,hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function createWhitelistDraftPacket(result){
 const out={format:'10x.local.whitelist-draft.v1',fixtureMode:'local-fixture',digestKind:'local-whitelist-v1'};
 for(const key of ['operationKind','source','inventoryId','stageId','inputCount','acceptedCount','duplicateCount','errorCount','errorsTruncated','digest','eligibilityListId','publishable','financialExecution','staged','isAuthorization'])out[key]=field(result,key);
 if(out.operationKind!=='collection.validate-whitelist.v1'||typeof out.source!=='string'||!out.source.trim()||out.source.length>256||!id(out.inventoryId)||!id(out.stageId)||!['inputCount','acceptedCount','duplicateCount','errorCount'].every(k=>nat(out[k]))||out.inputCount!==out.acceptedCount+out.duplicateCount+out.errorCount||!hex(out.digest)||out.financialExecution!==false||out.staged!==false||out.isAuthorization!==false||typeof out.publishable!=='boolean'||out.publishable!==(out.errorCount===0)||out.errorsTruncated!==(out.errorCount>100)||(out.publishable?!hex(out.eligibilityListId):out.eligibilityListId!==null))fail();
 const errors=field(result,'errors');if(!Array.isArray(errors)||errors.length!==Math.min(100,out.errorCount))fail();out.errors=[];let last=-1;for(const value of errors){const index=field(value,'index'),reason=field(value,'reason');if(!nat(index)||index>=out.inputCount||index<=last||reason!=='noncanonical-solana-address')fail();out.errors.push({index,reason});last=index;}
 const rev=field(result,'expectedRevisions');out.expectedRevisions={};for(const key of ['earn','source','control']){const value=field(rev,key);if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))fail();out.expectedRevisions[key]=value;}
 if(new TextEncoder().encode(JSON.stringify(out)).length>WHITELIST_DRAFT_PACKET_MAX_BYTES)fail();return freeze(out);
}
