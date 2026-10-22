// Offline original cached-wallet replay. Not a general D1/runtime backend.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {replayLegacyWallets} from "../../discovery/src/wallet-work";
import {CandidateSchema} from "../../discovery/src/model";
import {currentWalletReader} from "../../discovery/src/wallet-funding-scope";
import {withScratchEvidenceResolver,type ScratchOptions} from "../discovery-evidence-scratch.mjs";
import {readEvidenceWalletMetadata,selectEvidencePublication} from "../discovery-evidence-publication.mjs";
import {publicationEvidenceReadStore} from "./evidence-publication-read-store";
import {ProducerStatements,walletEvidenceSql,type ProducerStatement} from "./evidence-producer-plan";
import {publishEvidenceProducerBatch,type ProducerPublication,type ProducerJournal,type ProducerGrant,type ProducerPublicationOutcome} from "./evidence-producer-publication";

const Identity=z.object({address:z.string().min(1).max(4096),publicationId:z.string().uuid(),stageId:z.string().uuid()}).strict();
export type WalletReplayIdentity=z.infer<typeof Identity>;
type Publication={address:string;outcome:ProducerPublicationOutcome};
const inactive=()=>({provider_requests:0,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false} as const);
const candidatesSql="SELECT payload FROM tenx_active_candidates WHERE mode=?1 ORDER BY checked_at DESC,address LIMIT 500",receiptSql="SELECT payload_hash,address,payload,observed_at FROM tenx_wallet_evidence WHERE payload_hash=?1 AND address=?2",transactionSql="SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1";
const updateSql="UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis',json(?1)) WHERE address=?2 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?3",deleteSql="DELETE FROM tenx_wallet_work WHERE address=?1 AND source_evidence_hash=?2",profileSql="INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?1 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?3) ON CONFLICT(address,wallet) DO UPDATE SET payload_hash=excluded.payload_hash,payload=excluded.payload,observed_at=excluded.observed_at";

// Complete frozen-source admission closes BEFORE returning a body to the
// producer, then the selected target state/owner is rechecked after all file IO.
export async function readWalletReplayReceipt(source:ScratchOptions,publication:ProducerPublication,grant:ProducerGrant,hash:string,address:string){
  const saved=structuredClone({source,publication,grant,hash,address});
  const admitted=await withScratchEvidenceResolver(saved.source,async reader=>{
    const request={kind:"receipt" as const,table:"tenx_wallet_evidence" as const,hash:saved.hash,baseline:reader.receiptIdentity("tenx_wallet_evidence",saved.hash)?[saved.hash]:[]},before=await selectEvidencePublication(saved.publication,saved.grant,request),row=await publicationEvidenceReadStore(reader,saved.publication,saved.grant).walletReceipt(saved.hash,saved.address);
    return {request,before,row};
  });
  const {request,before,row}=admitted.value;
  if(!isDeepStrictEqual(await selectEvidencePublication(saved.publication,saved.grant,request),before))throw Error("wallet_replay_receipt_changed");
  return row;
}

export async function replayLegacyWalletsOnEvidenceTarget(source:ScratchOptions,publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletReplayIdentity[]){
  const publications:Publication[]=[];
  try{
    const saved=structuredClone({source,publication,journal,grant}),identities=Identity.array().max(10).parse(input);
    for(const field of ["address","publicationId","stageId"] as const)if(new Set(identities.map(item=>item[field])).size!==identities.length)throw Error("wallet_replay_identity_duplicate");
    const owned=new WeakMap<object,ProducerStatement>(),used=new Set<string>();
    function prepare(sql:string,bindings:unknown[]=[]):D1PreparedStatement{
      const statement={bind:(...values:unknown[])=>prepare(sql,[...values]),async first(column?:string){
        if(column!==undefined)throw Error("wallet_target_column_not_supported");
        if(sql===receiptSql&&bindings.length===2)return readWalletReplayReceipt(saved.source,saved.publication,saved.grant,String(bindings[0]),String(bindings[1]));
        if(sql===transactionSql&&bindings.length===1)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"transaction",signature:bindings[0]})).row;
        for(const [hop,table] of [["direct","tenx_funding_scans"],["second","tenx_second_hop_scans"]])if(sql===`SELECT payload,payload_hash FROM ${table} WHERE address=?1 AND wallet=?2 AND anchor_signature=?3`&&bindings.length===3)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"checkpoint",hop,address:bindings[0],wallet:bindings[1],anchor_signature:bindings[2]})).row;
        throw Error("wallet_target_read_not_supported");
      },async all(){
        if(sql!==candidatesSql||bindings.length!==1||bindings[0]!=="live")throw Error("wallet_target_index_not_supported");
        const result=await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"candidates"});
        const selected=result.rows.map(row=>CandidateSchema.parse(JSON.parse(row.payload))).filter(c=>c.wallet_analysis&&!currentWalletReader(c.wallet_analysis.version)).slice(0,10);
        if(selected.some(c=>!identities.some(item=>item.address===c.address)))throw Error("wallet_replay_identity_required");
        return {success:true,results:result.rows};
      }};owned.set(statement,{sql,bindings:bindings as ProducerStatement["bindings"]});return statement as unknown as D1PreparedStatement;
    }
    const db={prepare,async batch(statements:D1PreparedStatement[]){
      const rows=ProducerStatements.parse(statements.map(statement=>{const row=owned.get(statement);if(!row)throw Error("wallet_target_foreign_statement");return row;}));
      if(rows.length<3||rows[0]!.sql!==walletEvidenceSql||rows[1]!.sql!==updateSql||rows[2]!.sql!==deleteSql||rows.slice(3).some(row=>row.sql!==profileSql))throw Error("wallet_target_batch_not_supported");
      const address=String(rows[0]!.bindings[1]),identity=identities.find(item=>item.address===address);if(!identity||used.has(address))throw Error("wallet_replay_identity_required");used.add(address);
      const outcome=await publishEvidenceProducerBatch(saved.publication,saved.journal,saved.grant,{...identity,statements:rows});publications.push({address,outcome});
      if(outcome.state!=="committed")throw Error("wallet_target_publication_unconfirmed");return outcome.results;
    }} as unknown as D1Database;
    const result=await replayLegacyWallets(db);return {state:"completed" as const,result,publications,...inactive()};
  }catch{return {state:"held" as const,code:"wallet_replay_target_held",publications,...inactive()};}
}
