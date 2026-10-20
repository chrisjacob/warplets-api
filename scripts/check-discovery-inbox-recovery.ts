import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {InboxRecoveryResponse,INBOX_RECOVERY_DAILY_LIMIT,INBOX_RECOVERY_PER_TURN,TRANSACTION_READER_VERSION} from "../discovery/src/inbox-recovery-model";
import {TransactionSchema} from "../discovery/src/rpc";
import {hashJson} from "../discovery/src/solana";
const response=await fetch("http://127.0.0.1:8794/api/10x/discovery/inbox-recovery",{signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
const {data}=InboxRecoveryResponse.parse(await response.json());
assert.equal(data.reader_version,TRANSACTION_READER_VERSION);assert.equal(data.provider_requests,0);assert.equal(data.evidence_gates_changed,false);assert.ok(data.used_today<=INBOX_RECOVERY_DAILY_LIMIT);
const db=new DatabaseSync(new URL("../discovery/.wrangler/local/v3/d1/miniflare-D1DatabaseObject/daf636fcbef1c9ac586f35b886cf4aab026d59a97e006ac52cad422db0bcaf4c.sqlite",import.meta.url),{readOnly:true});
let retainedMigrationsReplayed=0;
try {
  const turns=db.prepare("SELECT job_id,count(*) AS n FROM tenx_inbox_reads WHERE is_recovery=1 GROUP BY job_id").all() as {job_id:string;n:number}[];
  assert.ok(turns.every(r=>r.n<=INBOX_RECOVERY_PER_TURN));
  for(const receipt of data.recent){
    assert.ok(receipt.prior_processed_at);assert.ok(receipt.expected_slot>=0);
    if(receipt.state==="reading"){assert.equal(receipt.outcome,null);continue;}
    assert.ok(receipt.finished_at);assert.ok(receipt.outcome);
    if(receipt.outcome!=="migration_verified")continue;
    const row=db.prepare("SELECT migration_tx FROM tenx_leads WHERE migration_signature=?").get(receipt.signature) as {migration_tx:string}|undefined;
    assert.ok(row,"Verified recovery must retain its migration body in the ordinary lead store");
    const tx=TransactionSchema.parse(JSON.parse(row.migration_tx));assert.equal(tx.slot,receipt.expected_slot);assert.equal(tx.transaction.signatures[0],receipt.signature);assert.equal(await hashJson(tx),receipt.payload_hash);retainedMigrationsReplayed++;
  }
}finally{db.close();}
console.log(JSON.stringify({at:data.at,used_today:data.used_today,limit:data.daily_limit,pending_recent:data.pending_recent,older_unsupported:data.older_unsupported,outcomes:data.recent.map(r=>r.outcome??"completion_unconfirmed"),retained_migrations_replayed:retainedMigrationsReplayed,source_requests_made_by_this_check:0,evidence_gates_changed:false,deploy:false},null,2));
