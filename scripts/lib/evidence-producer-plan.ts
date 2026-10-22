// Offline producer-plan construction. No database, oracle or execution delegate.
import {z} from "zod";
import {d1EvidenceWriteStore} from "../../discovery/src/evidence-write-store";
import {stageEvidenceAppend} from "../discovery-evidence-append-stage.mjs";
import {validateEvidencePublicationPlan} from "../discovery-evidence-publication.mjs";

const Binding=z.union([z.string().max(2000000),z.number().finite(),z.null()]);
export const ProducerStatements=z.object({sql:z.string().min(1).max(16384),bindings:Binding.array().max(100)}).strict().array().min(1).max(128);
export type ProducerStatement=z.infer<typeof ProducerStatements>[number];
export type EvidenceStage={directory:string;contextPin:string;keyFile:string};
export type ProducerBatchInput={publicationId:string;stageId:string;statements:unknown};

// Only preparation/binding is available while deriving the real writer's exact
// SQL. No D1 implementation is supplied or called, even for plan construction.
const templates:string[]=[];
const templateDb={prepare(sql:string){templates.push(sql);return {bind(){return {};}};}} as unknown as D1Database;
const writer=d1EvidenceWriteStore(templateDb),unused={payload_hash:"0".repeat(64),address:"offline-unused",slot:0,payload:"{}",observed_at:""};
writer.holder(unused);writer.wallet(unused);
export const [holderEvidenceSql,walletEvidenceSql]=templates as [string,string];

// Synchronous normalization before any asynchronous IO prevents caller changes
// from substituting SQL, bindings or identities while a stage is being opened.
export function describeEvidenceProducerBatch(stage:EvidenceStage,input:ProducerBatchInput){
  const saved=ProducerStatements.parse(input.statements);
  let table:"tenx_holder_evidence"|"tenx_wallet_evidence"|undefined,row;
  const operations=saved.map(statement=>{
    if(statement.sql!==holderEvidenceSql&&statement.sql!==walletEvidenceSql)return {kind:"sql" as const,...statement};
    if(table)throw Error("producer_batch_multiple_receipts");
    const holder=statement.sql===holderEvidenceSql,b=statement.bindings;
    if(b.length!==(holder?5:4))throw Error("producer_receipt_binding_layout");
    table=holder?"tenx_holder_evidence":"tenx_wallet_evidence";
    row=holder?{payload_hash:b[0],address:b[1],slot:b[2],payload:b[3],observed_at:b[4]}:{payload_hash:b[0],address:b[1],payload:b[2],observed_at:b[3]};
    return {kind:"receipt" as const};
  });
  if(!table||!row)throw Error("producer_batch_receipt_required");
  const preflight=validateEvidencePublicationPlan({publication_id:input.publicationId,ticket:{context_pin:stage.contextPin,stage_id:input.stageId,ticket_sha256:"0".repeat(64)},operations});
  return {table,row,preflight};
}

export async function prepareEvidenceProducerBatch(stage:EvidenceStage,input:ProducerBatchInput){
  stage={...stage};const described=describeEvidenceProducerBatch(stage,input);
  const staged=await stageEvidenceAppend(stage,{stageId:described.preflight.ticket.stage_id,table:described.table,row:described.row});
  return validateEvidencePublicationPlan({...described.preflight,ticket:staged.ticket});
}
