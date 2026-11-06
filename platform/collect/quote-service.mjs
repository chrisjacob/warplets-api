import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
export const ISSUE_COLLECTION_QUOTE='collection.issue-quote.v1';
export const COLLECTION_QUOTE_POLICY='collection-progression-v1',COLLECTION_QUOTE_TTL_MS=120000;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const clone=v=>JSON.parse(canonicalJson(v));
const frozen=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))frozen(child);Object.freeze(v);}return v;};
export class CollectionQuoteInputError extends TypeError {constructor(code){super(code);this.code=code;this.status=400;}}
const requireValue=(condition,code)=>{if(!condition)throw new CollectionQuoteInputError(code);};
export function quotePrincipal(value){
 const p=clone(value);requireValue(p&&Object.keys(p).length===2&&p.kind==='wallet'&&typeof p.wallet==='string','wallet-principal-required');
 try{decode58(p.wallet,32);}catch{throw new CollectionQuoteInputError('invalid-wallet');}return p;
}
export function normalizeCollectionQuoteInput(value){
 const v=clone(value);requireValue(v&&Object.keys(v).every(k=>['kind','inventoryId','targetId','materialId','expectedTargetVersion','expectedMaterialVersion','maxTotalLamports'].includes(k))&&['upgrade','visual'].includes(v.kind)&&id(v.inventoryId)&&id(v.targetId)&&natural(v.expectedTargetVersion),'invalid-quote-input');
 if(v.kind==='upgrade')requireValue(id(v.materialId)&&v.materialId!==v.targetId&&natural(v.expectedMaterialVersion),'invalid-quote-participants');
 else requireValue(v.materialId==null&&v.expectedMaterialVersion==null,'unexpected-quote-material');
 const ceiling=v.maxTotalLamports??null;requireValue(ceiling===null||typeof ceiling==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(ceiling)&&BigInt(ceiling)<(1n<<64n),'invalid-local-ceiling');
 return frozen({kind:v.kind,inventoryId:v.inventoryId,targetId:v.targetId,materialId:v.materialId??null,expectedTargetVersion:v.expectedTargetVersion,expectedMaterialVersion:v.expectedMaterialVersion??null,maxTotalLamports:ceiling});
}
export const collectionQuoteCommandBytes=c=>utf8(canonicalJson([ISSUE_COLLECTION_QUOTE,c.principal,c.businessIdentity,c.requestKey,c.input]));
export async function collectionQuoteBusinessIdentity(principal,requestKey,crypto){return crypto.sha256(utf8(canonicalJson([ISSUE_COLLECTION_QUOTE,principal.wallet,requestKey])));}
export async function buildCollectionQuoteCommand(principal,value,crypto){
 const p=quotePrincipal(principal),v=clone(value);requireValue(v&&id(v.requestKey),'invalid-quote-request-key');const {requestKey,...raw}=v,input=normalizeCollectionQuoteInput(raw);
 const command={operationKind:ISSUE_COLLECTION_QUOTE,principal:p,requestKey,input,businessIdentity:await collectionQuoteBusinessIdentity(p,requestKey,crypto)};
 return frozen({...command,requestDigest:await crypto.sha256(collectionQuoteCommandBytes(command))});
}
/** Authenticated caller input only. Quote IDs, clocks, policy and source facts
 * are always chosen inside the independently validating storage adapter. */
export function createCollectionQuoteService({repository,crypto}){return Object.freeze({
 async issueQuote(principal,input){return repository.issueQuote(await buildCollectionQuoteCommand(principal,input,crypto));},
 async readQuote(principal,quoteId){const p=quotePrincipal(principal);requireValue(id(quoteId),'invalid-quote-id');return repository.readQuote(p,quoteId);},
});}
