import { createHash } from 'node:crypto';
import { orderedJson as stringify } from '../security/canonical.mjs';
import { transaction } from '../storage/database.mjs';
import { conflict, name, nat, requireValue } from '../earn/checks.mjs';

const FORMAT='10x-local-config-audit-v1';
const hash=v=>createHash('sha256').update(stringify(v)).digest('hex');
const eventHash=(seq,prev,e)=>hash([FORMAT,seq,prev,e.category,e.entity,e.changeKey,e.atMs,e.actor,e.evidenceRef,e.payload]);
export function appendAudit(db,e) {
  for(const field of ['category','entity','changeKey','actor','evidenceRef'])name(e[field],field);
  nat(e.atMs,'recorded time');const payload=stringify(e.payload);requireValue(payload&&Buffer.byteLength(payload)<=16*1024,'Invalid audit payload.');
  return transaction(db,()=>{
    const existing=db.prepare('SELECT * FROM ops_config_audit WHERE category=? AND entity=? AND change_key=?').get(e.category,e.entity,e.changeKey);
    if(existing){
      if(eventHash(existing.seq,existing.previous_hash,e)!==existing.event_hash)conflict('audit_conflict','A different event uses the same configuration change key.');
      return existing.event_hash;
    }
    const head=db.prepare('SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1').get();
    const seq=(head?.seq??0)+1,prev=head?.event_hash??null,digest=eventHash(seq,prev,e);
    db.prepare('INSERT INTO ops_config_audit VALUES(?,?,?,?,?,?,?,?,?,?)').run(seq,prev,digest,e.category,e.entity,e.changeKey,e.atMs,e.actor,e.evidenceRef,payload);
    return digest;
  });
}
export function verifyConfigChain(db,expectedHead) {
  let index=0,head=null;
  for(const row of db.prepare('SELECT * FROM ops_config_audit ORDER BY seq').iterate()){
    const event={category:row.category,entity:row.entity,changeKey:row.change_key,atMs:row.recorded_ms,
      actor:row.actor,evidenceRef:row.evidence_ref,payload:JSON.parse(row.payload)};
    if(row.seq!==++index||row.previous_hash!==head||eventHash(index,head,event)!==row.event_hash)conflict('audit_mismatch','Configuration event chain does not verify.');
    head=row.event_hash;
  }
  if(expectedHead!==undefined&&expectedHead!==head)conflict('audit_mismatch','Configuration history differs from the pinned head.');
  return {format:FORMAT,events:index,head};
}
export function configCheckpoint(db,expectedDigest) {
  // Fingerprint older rows and audited tables without exporting actors or private evidence.
  return transaction(db,()=>{
    const chain=verifyConfigChain(db);
    const tables={};
    for(const [table,order] of [['earn_action_catalog','id'],['earn_action_changes','action_id,effective_epoch'],
      ['earn_workload_policies','effective_epoch,recorded_ms'],['price_sources','token_id'],['ops_scope_log','scope,at_ms'],
      ['earn_issuer_grants','id'],['earn_issuer_revocations','issuer_id']]) {
      const digest=createHash('sha256');let rows=0;
      for(const row of db.prepare('SELECT * FROM '+table+' ORDER BY '+order).iterate()) {digest.update(stringify(row)+'\n');rows++;}
      tables[table]={rows,sha256:digest.digest('hex')};
    }
    const fingerprint=hash([FORMAT,chain,tables]);
    if(expectedDigest!==undefined&&fingerprint!==expectedDigest)conflict('audit_mismatch','Current configuration differs from the pinned checkpoint.');
    return {format:FORMAT,chain,tables,digest:fingerprint};
  });
}
