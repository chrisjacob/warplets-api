import {z} from "zod";
import {RecoveryList,RecoveryRecord,RecoveryRequest} from "./launch-recovery-model";
import {evaluateRecovery,RecoveryError} from "./launch-recovery-math";
import {hashJson} from "./solana";
export const RECOVERY_DAILY_LIMIT=10;
type Record=z.infer<typeof RecoveryRecord>;
const metadata=(r:Record)=>({id:r.id,created_at:r.created_at,reason:r.reason,request_hash:r.request_hash,input_hash:r.input_hash,result_hash:r.result_hash});
export async function replayRecovery(raw:unknown){
  const r=RecoveryRecord.parse(raw);
  if(Date.parse(r.inputs.as_of)>Date.parse(r.created_at)||await hashJson({reason:r.reason,scenario:r.inputs})!==r.request_hash||await hashJson(r.inputs)!==r.input_hash||await hashJson(r.result)!==r.result_hash||await hashJson(metadata(r))!==r.record_hash||await hashJson(evaluateRecovery(r.inputs))!==r.result_hash)throw new RecoveryError("recovery_replay_mismatch",503);
  return r;
}
export async function recoveryRecord(db:D1Database,id:string){
  const row=await db.prepare("SELECT id,created_at,inputs,result,metadata FROM tenx_launch_recovery_labs WHERE id=?").bind(z.uuid().parse(id)).first<{id:string;created_at:string;inputs:string;result:string;metadata:string}>();
  if(!row)return null;const r=await replayRecovery({...JSON.parse(row.metadata),inputs:JSON.parse(row.inputs),result:JSON.parse(row.result)});
  if(r.id!==row.id||r.created_at!==row.created_at)throw new RecoveryError("recovery_metadata_mismatch",503);return r;
}
export async function createRecovery(db:D1Database,body:unknown,now=new Date()){
  const request=RecoveryRequest.parse(body),requestHash=await hashJson({reason:request.reason,scenario:request.scenario});
  const prior=await recoveryRecord(db,request.request_id);if(prior){if(prior.request_hash!==requestHash)throw new RecoveryError("recovery_request_conflict",409);return prior;}
  if(Date.parse(request.scenario.as_of)>now.getTime())throw new RecoveryError("recovery_future_as_of");
  if(new TextEncoder().encode(JSON.stringify(request)).length>16000)throw new RecoveryError("recovery_input_limit",413);
  const inputs=request.scenario,result=evaluateRecovery(inputs),meta={id:request.request_id,created_at:now.toISOString(),reason:request.reason,request_hash:requestHash,input_hash:await hashJson(inputs),result_hash:await hashJson(result)};
  const record=RecoveryRecord.parse({...meta,record_hash:await hashJson(meta),inputs,result}),inputText=JSON.stringify(inputs),resultText=JSON.stringify(result);
  if(new TextEncoder().encode(inputText+resultText).length>100000)throw new RecoveryError("recovery_record_limit",413);
  const day=`${now.toISOString().slice(0,10)}T00:00:00.000Z`,next=`${new Date(now.getTime()+86400000).toISOString().slice(0,10)}T00:00:00.000Z`;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenx_launch_recovery_labs(id,created_at,inputs,result,metadata) SELECT ?1,?2,?3,?4,?5 WHERE (SELECT COUNT(*) FROM tenx_launch_recovery_labs WHERE created_at>=?6 AND created_at<?7)<?8").bind(record.id,record.created_at,inputText,resultText,JSON.stringify({...meta,record_hash:record.record_hash}),day,next,RECOVERY_DAILY_LIMIT),
    db.prepare("INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?1,'launch_recovery_lab','local-operator',?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_launch_recovery_labs WHERE id=?5 AND json_extract(metadata,'$.record_hash')=?3)").bind(`launch-recovery:${record.id}`,request.reason,record.record_hash,record.created_at,record.id),
  ]);
  const saved=await recoveryRecord(db,record.id);if(!saved)throw new RecoveryError("recovery_daily_limit",429);if(saved.request_hash!==requestHash)throw new RecoveryError("recovery_request_conflict",409);return saved;
}
export async function recoveryList(db:D1Database){
  const rows=await db.prepare("SELECT id FROM tenx_launch_recovery_labs ORDER BY created_at DESC,id LIMIT 5").all<{id:string}>(),runs=[];
  for(const row of rows.results){const {inputs:_inputs,reason:_reason,request_hash:_request,input_hash:_input,...summary}=(await recoveryRecord(db,row.id))!;runs.push(summary);}
  return RecoveryList.parse({scope:"local_launch_recovery_exercises",runs});
}
