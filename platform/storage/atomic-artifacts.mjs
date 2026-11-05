import { canonicalJson } from '../security/canonical.mjs';
import { createAtomicReceipts } from './atomic-receipts.mjs';
import { sql,revisions,matchesExpectedRevisions } from './atomic-driver.mjs';
import { privateIdentity } from '../artifacts/identity.mjs';
import { PRIVATE_REFERENCE,privateReferenceBytes } from '../artifacts/reference-service.mjs';
import { name,nat } from '../earn/validation.mjs';
// Storage-internal seam called only after the service's exact-byte verification.
export function createArtifactReferenceRepository(driver,ports) {
  const {read,replay,execute}=createAtomicReceipts(driver,ports);
  return Object.freeze({async recordVerifiedReference(command) {
    command=JSON.parse(canonicalJson(command));
    const {principal,nowMs}=command,input=privateIdentity(command.input);
    if(principal?.kind!=='operator'||command.operationKind!==PRIVATE_REFERENCE||command.businessIdentity!==input.key)
      throw new TypeError('Invalid private artifact command.');
    name(principal.id,'operator');name(command.requestKey,'request key');nat(nowMs,'now');
    if(command.requestDigest!==await ports.crypto.sha256(privateReferenceBytes(command)))throw new TypeError('Invalid private reference digest.');
    const prior=await replay(command);if(prior)return prior;
    const [versionsRows,grants,existing]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),
      sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest'",principal.id),
      sql('SELECT 1 FROM app_private_artifacts WHERE object_key=?',input.key)]);
    if(!matchesExpectedRevisions(command.expectedRevisions,revisions(versionsRows)))return {kind:'conflict',code:'revision_conflict'};
    if(!grants[0]?.enabled)return {kind:'conflict',code:'operator_scope_required'};
    if(existing.length)return {kind:'conflict',code:'artifact_reference_exists'};
    return await execute(command,{businessKey:input.key,input,result:{...input,verification:'exact-bytes'},resultRef:input.key,
      version:revisions(versionsRows),authoritySql:"EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest' AND enabled=1)",authorityValues:[principal.id],
      child:(gate,values)=>sql(`INSERT INTO app_private_artifacts SELECT ?,?,?,?,?,?,operation_id FROM app_command_receipts
        WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
        input.key,input.byteDigest,input.size,input.semanticDigest,input.contentType,nowMs,...values,...values)});
  }});
}
