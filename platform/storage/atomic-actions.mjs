import {createAtomicReceipts} from './atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from './atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {actionProofIdentity,verifyActionProof} from '../earn/action-proof.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
export const ACCEPT_ACTION='earn.accept-action.v1';
const clone=v=>JSON.parse(canonicalJson(v));
const validateInput=input=>requireValue(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===3&&['actionId','proof','signature'].every(key=>Object.hasOwn(input,key)),'Supply actionId, proof and signature only.');
const commandBytes=c=>utf8(canonicalJson([ACCEPT_ACTION,c.principal,c.input]));
export async function createActionCommand({principal,input,nowMs,expectedRevisions={}},crypto){
 const c=clone({principal,input,nowMs,expectedRevisions,operationKind:ACCEPT_ACTION});
 requireValue(c.principal?.kind==='wallet','Wallet authentication required.');
 validateInput(c.input);const identity=await actionProofIdentity({...c.input,wallet:c.principal.wallet},crypto);
 c.businessIdentity=canonicalJson([c.principal.wallet,c.input.actionId]);c.requestKey=identity.proofDigest;c.requestDigest=await crypto.sha256(commandBytes(c));return c;
}
export function createAtomicActionRepository(driver,ports){
 const {read,replay,execute}=createAtomicReceipts(driver,ports);
 return Object.freeze({async acceptCompletion(value){
  const c=clone(value),{principal,input}=c;requireValue(principal?.kind==='wallet','Wallet authentication required.');name(principal.wallet,'wallet');nat(c.nowMs,'now');
  validateInput(input);const identity=await actionProofIdentity({...input,wallet:principal.wallet},ports.crypto);
  requireValue(c.operationKind===ACCEPT_ACTION&&c.businessIdentity===canonicalJson([principal.wallet,input.actionId])&&c.requestKey===identity.proofDigest&&c.requestDigest===await ports.crypto.sha256(commandBytes(c)),'Invalid action command.');
  const prior=await replay(c);if(prior)return prior;
  const epoch=Math.floor(c.nowMs/86400000);
  const [versionRows,grants,actions,nonces,existing,closed,recovered]=await read([
   sql('SELECT * FROM app_revisions ORDER BY name'),
   sql(`SELECT g.id AS issuerId,g.action_id AS actionId,g.verifier,g.pubkey,g.from_epoch AS fromEpoch,g.until_epoch AS untilEpoch,g.recorded_ms AS recordedMs,g.revision,r.revoked_ms AS revokedMs
    FROM earn_issuer_grants g LEFT JOIN earn_issuer_revocations r ON r.issuer_id=g.id WHERE g.id=?`,identity.issuerId),
   sql(`SELECT a.id AS actionId,a.verifier,c.effective_epoch AS startEpoch FROM earn_action_catalog a JOIN earn_action_changes c ON c.action_id=a.id
    AND c.effective_epoch=(SELECT MAX(z.effective_epoch) FROM earn_action_changes z WHERE z.action_id=a.id AND z.effective_epoch<=?) WHERE a.id=? AND c.enabled=1`,epoch,input.actionId),
   sql('SELECT proof_digest FROM earn_signed_completions WHERE issuer_id=? AND nonce=?',identity.issuerId,identity.nonce),
   sql('SELECT 1 FROM earn_action_completions WHERE wallet=? AND action_id=?',principal.wallet,input.actionId),
   sql('SELECT 1 FROM earn_boards WHERE epoch>=? LIMIT 1',epoch),sql('SELECT 1 FROM earn_recovered_boards LIMIT 1'),
  ]);
  const version=revisions(versionRows);if(!matchesExpectedRevisions(c.expectedRevisions,version))return {kind:'conflict',code:'revision_conflict'};
  if(nonces.length)return {kind:'conflict',code:'nonce_conflict'};if(existing.length)return {kind:'conflict',code:'completion_exists'};
  if(recovered.length)return {kind:'conflict',code:'read_only_archive'};if(closed.length)return {kind:'conflict',code:'board_closed'};
  const verified=await verifyActionProof({...input,wallet:principal.wallet,nowMs:c.nowMs,grant:grants[0]??null,activeAction:actions[0]??null},ports.crypto);
  return execute(c,{businessKey:c.businessIdentity,input:verified,result:{actionId:input.actionId,verifiedAtMs:c.nowMs,proofDigest:verified.proofDigest,replay:false},resultRef:verified.proofDigest,version,
   child:(gate,v)=>[
    sql(`INSERT INTO earn_action_completions SELECT ?,?,?,?,? WHERE ${gate}`,principal.wallet,input.actionId,c.nowMs,verified.verifier,verified.sourceRef,...v),
    sql(`INSERT INTO earn_signed_completions SELECT ?,?,?,?,?,?,? WHERE ${gate}`,verified.issuerId,verified.nonce,principal.wallet,input.actionId,verified.proofDigest,verified.sourceHash,c.nowMs,...v),
   ]});
 }});
}
