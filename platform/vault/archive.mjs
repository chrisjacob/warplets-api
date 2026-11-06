import {privateIdentity} from '../artifacts/identity.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {createVaultLiabilityManifest,verifyVaultLiabilityManifest,VAULT_MANIFEST_MAX_BYTES} from './manifest.mjs';

/** Private liability-component persistence. Full inventory, binding and claim
 * restoration is a separate requirement; this store never grants authority. */
export function createVaultLiabilityArchive({crypto,store}){
 const data=(input,keys)=>{
  if(!input||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Reflect.ownKeys(input).length!==keys.length)throw new TypeError('Vault archive: exact data pin required');
  const value={};for(const key of keys){const field=Object.getOwnPropertyDescriptor(input,key);if(!field?.enumerable||!Object.hasOwn(field,'value'))throw new TypeError('Vault archive: data fields required');value[key]=field.value;}return value;
 };
 const capturePin=input=>{
  const value=data(input,['identity','inventoryCommitment','marketId']);
  const pin={identity:privateIdentity(data(value.identity,['key','byteDigest','size','semanticDigest','visibility','contentType'])),inventoryCommitment:value.inventoryCommitment,marketId:value.marketId};
  if(pin.identity.size>VAULT_MANIFEST_MAX_BYTES||pin.identity.contentType!=='application/json'||pin.identity.semanticDigest!==null||typeof pin.inventoryCommitment!=='string'||!/^[a-f0-9]{64}$/.test(pin.inventoryCommitment)||typeof pin.marketId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(pin.marketId))throw new TypeError('Vault archive: invalid pin');
  return pin;
 };
 async function restore(input){
  const pin=capturePin(input),read=await store.getVerified(pin.identity);
  if(read.status!=='verified')return {kind:'pending',reason:'vault-liability-object-'+read.status,pin};
  if(!(read.bytes instanceof Uint8Array)||read.bytes.length!==pin.identity.size)return {kind:'pending',reason:'vault-liability-object-size',pin};
  const manifest=await verifyVaultLiabilityManifest(read.bytes,pin.identity.byteDigest,{crypto});
  if(manifest.marketId!==pin.marketId||manifest.inventoryCommitment!==pin.inventoryCommitment)throw new Error('Vault archive: independent scope pin mismatch');
  return {kind:'restored',pin,manifest,scope:'liability-component-only',financialExecution:false,isAuthorization:false};
 }
 return Object.freeze({restore,async save(inputBytes){
  const built=await createVaultLiabilityManifest(inputBytes,{crypto}),identity=privateIdentity({key:'private/'+built.sha256+'.json',byteDigest:built.sha256,size:built.bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'});
  const pin=capturePin({identity,inventoryCommitment:built.manifest.inventoryCommitment,marketId:built.manifest.marketId});
  const written=await store.putIfAbsent(identity,built.bytes);
  if(written.status==='unknown')return {kind:'pending',reason:'vault-liability-write-unknown',pin};
  if(!['created','exists'].includes(written.status))return {kind:'pending',reason:'vault-liability-write-'+written.status,pin};
  const result=await restore(pin);
  if(result.kind==='restored'&&canonicalJson(result.manifest)!==canonicalJson(built.manifest))throw new Error('Vault archive: readback mismatch');
  return result.kind==='restored'?{...result,kind:'saved'}:result;
 }});
}
