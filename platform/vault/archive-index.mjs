import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {verifyVaultLiabilityManifest} from './manifest.mjs';
import {vaultLiabilityFromRecoveryPage} from './manifest-from-recovery.mjs';
import {createVaultRecoveryReader} from './archive-index-reader.mjs';
export const VAULT_ARCHIVE_INDEX_TABLES=Object.freeze(['app_collection_authorities','app_collection_legacy_adoptions','app_collection_legacy_mint_anchors','app_collection_mint_fulfillments','app_collection_observation_bindings','app_collection_records','collect_assets','collect_inventories','collect_level_history','collect_observations','collect_operations','vault_assets','vault_claim_totals','vault_manifests','vault_observations']);
export const VAULT_ARCHIVE_INDEX_MAX_BYTES=65536;
const need=(v,m)=>{if(!v)throw new Error('Vault archive index: '+m);};
const exact=(v,keys)=>need(v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');}),'exact data fields');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const identity=(bytes,digest)=>privateIdentity({key:'private/'+digest+'.json',byteDigest:digest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'});
const checkedIdentity=raw=>{exact(raw,['key','byteDigest','size','semanticDigest','visibility','contentType']);return privateIdentity(raw);};
function capture(input){
 exact(input,['rootBytes','rootDigest','liabilityBytes','liabilityDigest','pageIndex']);
 need(input.rootBytes instanceof Uint8Array&&input.rootBytes.length<=262144&&input.liabilityBytes instanceof Uint8Array&&input.liabilityBytes.length<=65536&&hex(input.rootDigest)&&hex(input.liabilityDigest),'bounded independent inputs');
 need(Number.isInteger(input.pageIndex)&&input.pageIndex>=0&&input.pageIndex<16384,'page index');
 return {...input,rootBytes:Uint8Array.from(input.rootBytes),liabilityBytes:Uint8Array.from(input.liabilityBytes)};
}
/** Explicit compact references to the full graph and retained binding/claim
 * tables. Descriptor integrity does not establish full recovery readiness. */
export async function createVaultArchiveIndex(raw,{crypto,store}){
 const input=capture(raw),liability=await verifyVaultLiabilityManifest(input.liabilityBytes,input.liabilityDigest,{crypto});
 need(liability.inventoryCommitment===input.rootDigest,'liability root scope');
 const derived=await vaultLiabilityFromRecoveryPage({rootBytes:input.rootBytes,rootDigest:input.rootDigest,marketId:liability.marketId,pageIndex:input.pageIndex},{crypto,store});
 need(derived.sha256===input.liabilityDigest,'liability source page mismatch');
 const {codec,root,lookup}=await createVaultRecoveryReader({rootBytes:input.rootBytes,rootDigest:input.rootDigest},{crypto,store}),tables=[];
 for(const name of VAULT_ARCHIVE_INDEX_TABLES){const descriptor=await lookup(root.tables,'tables',name);need(descriptor,'required table absent: '+name);tables.push(await codec.verifyTableDescriptor(descriptor));}
 const index={format:'10x.local.vault.archive-index.v1',mode:'local-fixture',visibility:'private',marketId:liability.marketId,
  recoveryRoot:identity(input.rootBytes,input.rootDigest),liability:identity(input.liabilityBytes,input.liabilityDigest),liabilitySource:derived.source,tables,
  verification:'pinned-index-and-liability-only',fullRecoveryVerified:false,currentOwnerVerified:false,financialExecution:false,isAuthorization:false};
 const bytes=utf8(canonicalJson(index));need(bytes.length<=65536,'index byte bound');const digest=await crypto.sha256(bytes),objectIdentity=identity(bytes,digest);
 return {index,bytes,identity:objectIdentity,pin:{identity:objectIdentity,rootDigest:input.rootDigest,liabilityDigest:input.liabilityDigest,marketId:liability.marketId}};
}
export function createVaultArchiveIndexStore({crypto,store}){
 async function read(raw,max){const i=checkedIdentity(raw);need(i.size<=max&&i.semanticDigest===null&&i.contentType==='application/json','referenced artifact bound');const result=await store.getVerified(i);need(result.status==='verified'&&result.bytes instanceof Uint8Array&&result.bytes.length===i.size,'referenced object unavailable');const bytes=Uint8Array.from(result.bytes);need(await crypto.sha256(bytes)===i.byteDigest,'referenced byte mismatch');return bytes;}
 async function restore(raw){
  exact(raw,['identity','rootDigest','liabilityDigest','marketId']);const pin={identity:checkedIdentity(raw.identity),rootDigest:raw.rootDigest,liabilityDigest:raw.liabilityDigest,marketId:raw.marketId};
  need(hex(pin.rootDigest)&&hex(pin.liabilityDigest)&&typeof pin.marketId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(pin.marketId),'independent scope pin');
  const bytes=await read(pin.identity,65536),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),index=JSON.parse(text);need(canonicalJson(index)===text,'canonical index');
  need(index.marketId===pin.marketId&&index.recoveryRoot?.byteDigest===pin.rootDigest&&index.liability?.byteDigest===pin.liabilityDigest,'independent scope mismatch');
  const rootBytes=await read(index.recoveryRoot,262144),liabilityBytes=await read(index.liability,65536);
  const rebuilt=await createVaultArchiveIndex({rootBytes,rootDigest:pin.rootDigest,liabilityBytes,liabilityDigest:pin.liabilityDigest,pageIndex:index.liabilitySource?.pageIndex},{crypto,store});
  need(rebuilt.identity.byteDigest===pin.identity.byteDigest,'index coverage or derived descriptor mismatch');
  return {kind:'restored',pin,index:rebuilt.index,fullRecoveryVerified:false,financialExecution:false,isAuthorization:false};
 }
 return Object.freeze({restore,async save(raw){
  const input=capture(raw),built=await createVaultArchiveIndex(input,{crypto,store});
  for(const [i,bytes] of [[built.index.recoveryRoot,input.rootBytes],[built.index.liability,input.liabilityBytes],[built.identity,built.bytes]]){
   const result=await store.putIfAbsent(i,bytes);if(result.status==='unknown')return {kind:'pending',reason:'vault-archive-write-unknown',pin:built.pin};need(['created','exists'].includes(result.status),'artifact write failed');await read(i,262144);
  }
  const result=await restore(built.pin);return {...result,kind:'saved'};
 }});
}
