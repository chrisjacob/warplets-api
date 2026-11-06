import {canonicalJson,utf8} from '../security/canonical.mjs';
export const GATE_STATUSES=Object.freeze(['missing','fixture-proven','incompatible','review-required','accepted-for-named-scope']);
export const GATE_INDEX_LIMITS=Object.freeze({records:32,bytes:65536});
const need=(ok,reason)=>{if(!ok)throw new TypeError('Gate index: '+reason);};
const text=(v,max=512)=>{need(typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v,'bounded text');return v;};
function own(v,keys){need(v&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length,'plain exact record');const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);need(d?.enumerable&&Object.hasOwn(d,'value'),'data fields');out[k]=d.value;}return out;}
function array(v,max,fn){need(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=max&&Reflect.ownKeys(v).length===v.length+1,'bounded dense array');return Array.from({length:v.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(v,String(i));need(d?.enumerable&&Object.hasOwn(d,'value'),'array data');return fn(d.value);});}
function record(value){
 const r=own(value,['id','requirementId','status','evidenceKind','source','program','configuration','network','slot','observedAtMs','applicability','limitations','reviewOwner','acceptedScope']);
 for(const k of ['id','requirementId'])need(/^[A-Za-z0-9._:-]{1,128}$/.test(text(r[k],128)),'identifier');
 need(GATE_STATUSES.includes(r.status)&&['missing','recorded-fixture','recorded-observation','documented-review'].includes(r.evidenceKind),'status or evidence kind');
 if(r.source!==null){const s=own(r.source,['commit','digest','path']);need(typeof s.commit==='string'&&typeof s.digest==='string'&&/^[a-f0-9]{40}$/.test(s.commit)&&/^[a-f0-9]{64}$/.test(s.digest),'pinned source');text(s.path,256);need(/^[A-Za-z0-9._/-]+$/.test(s.path)&&!s.path.startsWith('/')&&!s.path.split('/').some(p=>p==='..'||p==='.'||p===''),'relative source path');r.source=s;}
 for(const k of ['program','configuration','network','reviewOwner','acceptedScope'])if(r[k]!==null)r[k]=text(r[k]);
 for(const k of ['slot','observedAtMs'])need(r[k]===null||Number.isSafeInteger(r[k])&&r[k]>=0&&(k!=='observedAtMs'||r[k]<=8640000000000000),'observation identity');
 r.applicability=array(r.applicability,8,v=>text(v));r.limitations=array(r.limitations,8,v=>text(v));need(r.applicability.length>0&&r.limitations.length>0,'explicit scope and limitations');
 need(r.status==='missing'?r.evidenceKind==='missing'&&r.source===null:r.evidenceKind!=='missing'&&r.source!==null,'evidence presence');
 need(r.status==='accepted-for-named-scope'?r.acceptedScope!==null&&r.reviewOwner!==null:r.acceptedScope===null,'named review scope');
 return r;
}
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
/** Indexes caller-supplied evidence assertions. It does not authenticate source
 * bytes, reviewers, provider configurations or approval authority. */
export async function createGateIndex(records,{crypto}){
 const captured=array(records,32,record).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);need(new Set(captured.map(r=>r.id)).size===captured.length,'duplicate evidence ID');
 need(utf8(canonicalJson(captured)).length<=65536,'input byte bound');
 const requirements=[...new Set(captured.map(r=>r.requirementId))].sort().map(id=>{const rows=captured.filter(r=>r.requirementId===id);return {id,evidenceIds:rows.map(r=>r.id),statuses:[...new Set(rows.map(r=>r.status))].sort(),hasIncompatibility:rows.some(r=>r.status==='incompatible'),hasMissingEvidence:rows.some(r=>r.status==='missing'),reviewAuthority:'unverified',executionEnabled:false};});
 const body={format:'10x.financial-gate-index.v1',sourceAuthority:'caller-supplied-unverified',records:captured,requirements,financialExecution:false,isAuthorization:false,releaseAuthorized:false};
 need(utf8(canonicalJson(body)).length+80<=65536,'output byte bound');
 const digest=await crypto.sha256(utf8(canonicalJson(body)));need(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),'digest');return freeze({...body,digest});
}
