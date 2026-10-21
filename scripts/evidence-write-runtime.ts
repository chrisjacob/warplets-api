// Synthetic-only native D1 fixture. Never an application route or binding.
import {d1EvidenceWriteStore} from "../discovery/src/evidence-write-store";
import type {HolderReceipt} from "../discovery/src/evidence-read-store";
import type {LocalEnv} from "../discovery/src/worker";
export default {async fetch(_request:Request,env:Pick<LocalEnv,"TENX_DB">){
  const db=env.TENX_DB,store=d1EvidenceWriteStore(db),cases:{kind:string;mode:string;passed:boolean}[]=[];
  for(const kind of ["holder","wallet"] as const)for(const mode of ["retry","address","payload",kind==="holder"?"slot":"observed_at","late_failure",...(kind==="holder"?["later_observation"]:[])]){
    const id=kind+"-"+mode,table=kind==="holder"?"tenx_holder_evidence":"tenx_wallet_evidence";
    const row:HolderReceipt={payload_hash:id,address:"synthetic-mint",slot:42,payload:'{"text":"漢😀","zero":0}',observed_at:"2026-10-22T00:00:00.000Z"};
    const append=(r:HolderReceipt)=>kind==="holder"?store.holder(r):store.wallet(r);
    let passed=false;
    if(mode==="retry"||mode==="later_observation"){
      const inserted=await db.batch([append(row)]),retried=await db.batch([append({...row,observed_at:mode==="later_observation"?"2026-10-22T00:01:00.000Z":row.observed_at})]);
      const saved=await db.prepare(`SELECT * FROM ${table} WHERE payload_hash=?1`).bind(id).first();
      const expected=kind==="holder"?row:{payload_hash:row.payload_hash,address:row.address,payload:row.payload,observed_at:row.observed_at};
      passed=inserted[0]!.meta.changes===1&&retried[0]!.meta.changes===0&&JSON.stringify(saved)===JSON.stringify(expected);
    }else{
      if(mode!=="late_failure")await db.batch([append(row)]);
      // Spent before publication; rollback must not refund it.
      await db.prepare("INSERT INTO study_spent VALUES(?1,3)").bind(id).run();
      const before=await db.prepare(`SELECT * FROM ${table} WHERE payload_hash=?1`).bind(id).first();
      const changed={...row,...(mode==="address"?{address:"other-mint"}:mode==="payload"?{payload:row.payload+" "}:mode==="slot"?{slot:43}:mode==="observed_at"?{observed_at:"2026-10-22T00:01:00.000Z"}:{})};
      let rejected=false;
      try{await db.batch([
        db.prepare("INSERT INTO study_publications VALUES(?1,'before')").bind(id),append(changed),
        mode==="late_failure"?db.prepare("INSERT INTO study_publications VALUES(?1,NULL)").bind(id+"-after"):db.prepare("INSERT INTO study_publications VALUES(?1,'after')").bind(id+"-after"),
      ]);}catch{rejected=true;}
      const after=await db.prepare(`SELECT * FROM ${table} WHERE payload_hash=?1`).bind(id).first(),published=await db.prepare("SELECT count(*) AS n FROM study_publications WHERE id=?1 OR id=?2").bind(id,id+"-after").first<{n:number}>(),spent=await db.prepare("SELECT used FROM study_spent WHERE id=?1").bind(id).first<{used:number}>();
      passed=rejected&&JSON.stringify(after)===JSON.stringify(before)&&published?.n===0&&spent?.used===3;
    }
    if(!passed)throw Error("native_evidence_write_contract_failed");cases.push({kind,mode,passed});
  }
  return Response.json({cases});
}};
