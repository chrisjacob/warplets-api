// Offline Node recorder/plan bridge only. Never a Worker database replacement.
import {ProducerStatements as Statements,holderEvidenceSql as holderSql,walletEvidenceSql as walletSql,prepareEvidenceProducerBatch,type ProducerStatement as Statement} from "./evidence-producer-plan";
type Batch={statements:Statement[];changes:number[]};
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
  return {
    db,
    recorded:()=>structuredClone(batches),
    prepare:prepareEvidenceProducerBatch,
  };
}
