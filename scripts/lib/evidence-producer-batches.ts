// Offline Node recorder/plan bridge only. Never a Worker database replacement.
import {z} from "zod";
import {d1EvidenceWriteStore} from "../../discovery/src/evidence-write-store";
import {stageEvidenceAppend} from "../discovery-evidence-append-stage.mjs";
import {validateEvidencePublicationPlan} from "../discovery-evidence-publication.mjs";

const Binding=z.union([z.string().max(2000000),z.number().finite(),z.null()]);
const Statements=z.object({sql:z.string().min(1).max(16384),bindings:Binding.array().max(100)}).strict().array().min(1).max(128);
type Statement=z.infer<typeof Statements>[number];
type Batch={statements:Statement[];changes:number[]};
type Stage={directory:string;contextPin:string;keyFile:string};
type Hooks={before?:(statements:readonly Statement[])=>Promise<void>;after?:(batch:Batch)=>Promise<void>};
const size=(rows:Statement[])=>rows.reduce((n,row)=>n+Buffer.byteLength(row.sql)+row.bindings.reduce<number>((m,b)=>m+(typeof b==="string"?Buffer.byteLength(b):8),0),0);

export function recordEvidenceProducerBatches(database:D1Database,hooks:Hooks={}){
  const statements=new WeakMap<D1PreparedStatement,{sql:string;bindings:unknown[];native:D1PreparedStatement}>(),batches:Batch[]=[];
  let retainedBytes=0,reservations=0;
  function wrap(sql:string,bindings:unknown[],native:D1PreparedStatement):D1PreparedStatement{
    const proxy=new Proxy(native,{get(target,key){
      if(key==="bind")return (...values:unknown[])=>wrap(sql,[...values],database.prepare(sql).bind(...values));
      const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
    }});statements.set(proxy,{sql,bindings:[...bindings],native});return proxy;
  }
  const db=new Proxy(database,{get(target,key){
    if(key==="prepare")return (sql:string)=>wrap(sql,[],target.prepare(sql));
    if(key==="batch")return async<T>(input:D1PreparedStatement[]):Promise<D1Result<T>[]>=>{
      const owned=input.map(statement=>{const saved=statements.get(statement);if(!saved)throw Error("producer_batch_foreign_statement");return saved;});
      const isEvidence=owned.some(row=>row.sql===holderSql||row.sql===walletSql);
      if(!isEvidence)return target.batch<T>(owned.map(row=>row.native));
      const snapshot=Statements.parse(owned.map(({sql,bindings})=>({sql,bindings}))),bytes=size(snapshot);
      if(bytes>10*1024**2||retainedBytes+bytes>32*1024**2||reservations>=16)throw Error("producer_recording_bound");
      // Reserve before yielding so concurrent calls cannot exceed the bound.
      reservations++;retainedBytes+=bytes;let committed=false;
      try{
        await hooks.before?.(structuredClone(snapshot));
        const result=await target.batch<T>(owned.map(row=>row.native));
        const batch={statements:snapshot,changes:result.map(row=>row.meta.changes)};
        committed=true;batches.push(batch);await hooks.after?.(structuredClone(batch));return result;
      }catch(error){if(!committed){reservations--;retainedBytes-=bytes;}throw error;}
    };
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  // Derive exact SQL from the real writer, avoiding a permissive SQL recognizer
  // or a second hand-maintained copy. Preparation/binding executes nothing.
  const writer=d1EvidenceWriteStore(db),row={payload_hash:"0".repeat(64),address:"offline-unused",slot:0,payload:"{}",observed_at:""};
  const holderSql=statements.get(writer.holder(row))!.sql,walletSql=statements.get(writer.wallet(row))!.sql;
  function describe(input:unknown){
    const saved=Statements.parse(input);let table:"tenx_holder_evidence"|"tenx_wallet_evidence"|undefined,row;
    const operations=saved.map(statement=>{
      if(statement.sql!==holderSql&&statement.sql!==walletSql)return {kind:"sql" as const,...statement};
      if(table)throw Error("producer_batch_multiple_receipts");
      const holder=statement.sql===holderSql,b=statement.bindings;
      if(b.length!==(holder?5:4))throw Error("producer_receipt_binding_layout");
      table=holder?"tenx_holder_evidence":"tenx_wallet_evidence";
      row=holder?{payload_hash:b[0],address:b[1],slot:b[2],payload:b[3],observed_at:b[4]}:{payload_hash:b[0],address:b[1],payload:b[2],observed_at:b[3]};
      return {kind:"receipt" as const};
    });
    if(!table||!row)throw Error("producer_batch_receipt_required");
    return {table,row,operations};
  }
  return {
    db,
    recorded:()=>structuredClone(batches),
    async prepare(stage:Stage,input:{publicationId:string;stageId:string;statements:unknown}){
      const described=describe(input.statements);
      // Reuse every coordinator SQL/operation/binding bound before staging an
      // object. A placeholder ticket is replaced only after authenticated IO.
      const preflight=validateEvidencePublicationPlan({publication_id:input.publicationId,ticket:{context_pin:stage.contextPin,stage_id:input.stageId,ticket_sha256:"0".repeat(64)},operations:described.operations});
      const staged=await stageEvidenceAppend(stage,{stageId:input.stageId,table:described.table,row:described.row});
      return validateEvidencePublicationPlan({...preflight,ticket:staged.ticket});
    },
  };
}
