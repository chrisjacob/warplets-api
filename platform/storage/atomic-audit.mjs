import {orderedJson,utf8} from '../security/canonical.mjs';
import {requireValue} from '../earn/validation.mjs';
import {sql} from './atomic-driver.mjs';

// Preserve the historical config-audit preimage; callers read the head with
// their revision snapshot and append this child under the same receipt gate.
export async function prepareConfigAudit(head,event,crypto){
 const seq=(head?.seq??0)+1,previousHash=head?.event_hash??null,payload=orderedJson(event.payload);
 requireValue(utf8(payload).length<=16384,'Audit payload too large.');
 const eventHash=await crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',seq,previousHash,event.category,event.entity,event.changeKey,event.atMs,event.actor,event.evidenceRef,event.payload])));
 return {seq,previousHash,eventHash,payload,recordedMs:event.atMs};
}
export const configAuditStatement=(audit,event,gate,values)=>sql(`INSERT INTO ops_config_audit SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate}`,
 audit.seq,audit.previousHash,audit.eventHash,event.category,event.entity,event.changeKey,event.atMs,event.actor,event.evidenceRef,audit.payload,...values);
