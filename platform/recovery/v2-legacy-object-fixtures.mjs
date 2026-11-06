import {recordUsage,reserveOptionalCost} from '../operations/controls.mjs';
import {hashLegacyAdoptionCertificate} from '../collect/legacy-adoption-authority.mjs';
import {hashJson} from './inventory.mjs';
/** Actual retained certificate verification, with explicitly isolated prior-stage,
 * mint/economic/current completion cursor. The outer integration owns those phases. */
export async function legacyObjectPhaseSetup(db,crypto){
 const row=db.prepare('SELECT rowid cursor,* FROM app_collection_legacy_adoptions LIMIT 1').get(),verified=await hashLegacyAdoptionCertificate(row,crypto),last=db.prepare('SELECT chain_digest FROM app_collection_legacy_mint_anchors WHERE adoption_id=? ORDER BY ordinal DESC LIMIT 1').get(row.id)??db.prepare('SELECT chain_digest FROM app_collection_legacy_stage_imports WHERE adoption_id=? ORDER BY ordinal DESC LIMIT 1').get(row.id);
 const state={id:row.id,cursor:row.cursor,certificateDigest:verified.certificateDigest,stageIndex:row.stage_count,currentOrdinal:row.admitted,currentContext:null,chain:last?.chain_digest??row.parent_digest};
 return {state,certificate:row,certificateProof:await hashJson(crypto,['v2-reconciled-legacy-adoption','certificate:'+row.id,{body:verified.body,digest:verified.certificateDigest}])};
}

/** Legal bounded control history; labels and records are synthetic local fixtures. */
export const largeRetainedControlOptions={beforeParents(f){const at=f.db.prepare("SELECT MIN(created_ms) at FROM collect_operations WHERE kind='mint'").get().at;for(let n=0;n<100;n++){recordUsage(f.db,{provider:'p'.repeat(80)+n,metric:'new-monthly-usd',measured:'1',atMs:at,evidenceRef:'e'.repeat(80)});reserveOptionalCost(f.db,{scope:'collection-mint',now:at,upperUsdMicros:'1',actor:'a'.repeat(80),quoteRef:'q'.repeat(80),requestKey:'r'.repeat(80)+n});}}};
