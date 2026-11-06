import {canonicalJson,utf8} from '../security/canonical.mjs';
import {launchAllocations} from '../domain/economics/launch.mjs';
import {GENESIS_LEVEL_COUNTS,GENESIS_WEIGHT,createSeasonSnapshot,genesisSlotEntitlement,vestedVaultUnits} from '../domain/economics/vault.mjs';
import {requireId} from '../domain/economics/units.mjs';

export const VAULT_LIABILITY_FORMAT='10x.local.vault.liabilities.v1';
export const VAULT_MANIFEST_MAX_BYTES=65536;
const need=(ok,message)=>{if(!ok)throw new TypeError('Vault manifest: '+message);};
const exact=(v,keys)=>need(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(','),'exact fields');
const time=v=>{need(Number.isSafeInteger(v)&&v>=0&&v<=253402127999000&&v%1000===0,'whole-second supported time');return BigInt(v/1000);};
const digest=v=>need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'digest');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function parse(bytes){
 need(bytes instanceof Uint8Array&&bytes.length<=VAULT_MANIFEST_MAX_BYTES,'bounded bytes');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
 need(canonicalJson(value)===text,'canonical JSON bytes');return value;
}
function derive(input){
 exact(input,['marketId','activatedMs','originalUnits','inventoryCommitment','seasons']);requireId(input.marketId,'marketId');
 const activatedAt=time(input.activatedMs);digest(input.inventoryCommitment);
 need(typeof input.originalUnits==='string'&&/^[1-9][0-9]{0,19}$/.test(input.originalUnits),'original units');
 need(Array.isArray(input.seasons)&&input.seasons.length<=12,'Season bound');
 const seasons=input.seasons.map(s=>{
  exact(s,['id','startsMs','levels']);requireId(s.id,'season id');time(s.startsMs);
  need(Array.isArray(s.levels)&&s.levels.length===1000&&s.levels.every(l=>Number.isInteger(l)&&l>=1&&l<=10),'complete Season levels');
  return {id:s.id,startsMs:s.startsMs,levels:s.levels.slice()};
 }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const season=createSeasonSnapshot({activatedAt,seasons:seasons.map(s=>({id:s.id,startsAt:time(s.startsMs),levels:s.levels}))});
 const allocation=launchAllocations({supply:BigInt(input.originalUnits),activeSeasonWeight:season.activeWeight});
 return {format:VAULT_LIABILITY_FORMAT,mode:'local-fixture',visibility:'private',financialExecution:false,isAuthorization:false,
  inventoryCommitment:input.inventoryCommitment,inventoryAuthority:'unverified-reference',marketId:input.marketId,activatedMs:input.activatedMs,originalUnits:input.originalUnits,
  genesis:{tranches:10,slotsPerTranche:1000,levelCounts:[...GENESIS_LEVEL_COUNTS],weight:String(GENESIS_WEIGHT),budgetUnits:String(allocation.genesisVault)},
  season:{activeWeight:String(season.activeWeight),budgetUnits:String(allocation.seasonVault),snapshots:seasons},
  bindingAuthority:false,claimHistoryIncluded:false};
}
/** Private liability component only. Inventory reference must be independently
 * verified by archive composition; this component contains no claim authority. */
export async function createVaultLiabilityManifest(inputBytes,{crypto}){
 const manifest=derive(parse(inputBytes));
 const bytes=utf8(canonicalJson(manifest));need(bytes.length<=VAULT_MANIFEST_MAX_BYTES,'output byte bound');
 const sha256=await crypto.sha256(bytes);digest(sha256);
 return {manifest:freeze(manifest),bytes,sha256};
}
export async function verifyVaultLiabilityManifest(bytes,pinnedDigest,{crypto}){
 digest(pinnedDigest);const value=parse(bytes),captured=utf8(canonicalJson(value));
 need(await crypto.sha256(captured)===pinnedDigest,'pinned digest mismatch');
 const expected=derive({marketId:value.marketId,activatedMs:value.activatedMs,originalUnits:value.originalUnits,inventoryCommitment:value.inventoryCommitment,seasons:value.season?.snapshots});
 need(canonicalJson(expected)===canonicalJson(value),'derived liabilities mismatch');
 return freeze(expected);
}
/** Public commitment excludes reserve-to-asset maps, Season Levels and owners.
 * This is a verification index, not a Rewards-program Merkle root or claim. */
export async function publicVaultLiabilityCommitment(bytes,pinnedDigest,{crypto}){
 const m=await verifyVaultLiabilityManifest(bytes,pinnedDigest,{crypto});
 return freeze({format:'10x.local.vault.commitment.v1',mode:'local-fixture',marketId:m.marketId,activatedMs:m.activatedMs,
  originalUnits:m.originalUnits,genesisBudgetUnits:m.genesis.budgetUnits,seasonBudgetUnits:m.season.budgetUnits,
  genesisReservedSlots:10000,seasonReservedSlots:m.season.snapshots.length*1000,
  liabilityDigest:pinnedDigest,inventoryCommitment:m.inventoryCommitment,commitmentAlgorithm:'sha256-canonical-json',
  claimFormat:'not-a-program-merkle-proof',financialExecution:false,isAuthorization:false});
}
/** Reserve accounting, never an owner claim quote. Use only a verified manifest. */
export function projectVaultReserve(manifest,coords,atMs){
 const activatedAt=time(manifest.activatedMs),at=time(atMs);let allocation;
 if(coords.kind==='genesis')allocation=genesisSlotEntitlement({...coords,budget:BigInt(manifest.genesis.budgetUnits)});
 else {
  need(coords.kind==='season','reserve kind');
  const snapshot=createSeasonSnapshot({activatedAt,seasons:manifest.season.snapshots.map(s=>({id:s.id,startsAt:time(s.startsMs),levels:s.levels}))});
  allocation=snapshot.entitlement({budget:BigInt(manifest.season.budgetUnits),seasonId:coords.seasonId,slotIndex:coords.slotIndex});
 }
 return {allocatedUnits:String(allocation),vestedUnits:String(vestedVaultUnits({allocation,activatedAt,at})),claimAuthority:false,claimedUnits:null};
}
