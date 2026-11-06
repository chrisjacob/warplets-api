import {createLegacyAdoptionAuthorityReader} from './legacy-adoption-authority.mjs';
import {canonicalJson} from '../security/canonical.mjs';
/** Release the full certificate before a caller loads large policy/context rows. */
export async function readImportedCollectionContext(driver,crypto,request){
 const result=await createLegacyAdoptionAuthorityReader({driver,crypto}).read(request);
 if(result.kind!=='ready')return result;
 return {kind:'ready',acceptedAtMs:result.certificate.createdMs,fence:result.fence,authority:result.authority,counts:result.counts,stage:result.stage,initialRevision:result.certificate.sourceRevision,initialStateDigest:result.certificate.rawDigest,certificateDigest:result.certificate.certificateDigest};
}
export function importedCollectionSnapshotMatches(imported,{revision,watermark,generation,authority}){
 return imported?.kind==='ready'&&revision===imported.fence.sourceRevision&&watermark===imported.fence.watermark&&generation===imported.fence.generation&&authority?.origin_kind==='verified-source-import'&&authority.activation_command_id===imported.fence.activationCommandId&&authority.initial_revision===imported.initialRevision&&authority.initial_state_digest===imported.initialStateDigest&&authority.revision===imported.authority.revision&&authority.admitted===imported.authority.admitted&&authority.fulfilled===imported.authority.fulfilled&&authority.remaining_json===canonicalJson(imported.authority.remaining);
}
export const importedCollectionRuntimeSql="SELECT w.revision,r.generation FROM app_recovery_watermark w CROSS JOIN app_recovery_state r WHERE w.id=1 AND r.id=1 AND r.write_nonce IS NULL AND length(CAST(r.generation AS BLOB)) BETWEEN 1 AND 256 AND ((r.mode='live' AND r.status='live') OR (r.mode='private' AND r.status='ready'))";
/** This is part of the fresh receipt claim. Accepted replay is resolved earlier. */
export function importedCollectionClaim(imported,inventoryId){
 if(imported?.kind!=='ready')throw new TypeError('Verified imported context required.');
 return {text:"EXISTS(SELECT 1 FROM app_collection_legacy_adoptions a JOIN app_command_receipts r ON r.operation_id=a.activation_command_id CROSS JOIN app_recovery_state runtime CROSS JOIN app_recovery_watermark w WHERE a.id=? AND a.inventory_id=? AND a.activation_command_id=? AND a.preparation_digest=? AND r.state='committed' AND r.operation_kind='collection.adopt-legacy-source.v1' AND r.result_ref=a.inventory_id AND json_extract(r.result_json,'$.certificateDigest')=? AND runtime.id=1 AND runtime.generation=? AND runtime.write_nonce IS NULL AND ((runtime.mode='live' AND runtime.status='live') OR (runtime.mode='private' AND runtime.status='ready')) AND w.id=1 AND w.revision=?)",values:[imported.fence.adoptionId,inventoryId,imported.fence.activationCommandId,imported.fence.preparationDigest,imported.certificateDigest,imported.fence.generation,imported.fence.watermark]};
}
