import {MarketBatchSummarySchema,MarketBatchRecordSchema,MarketBatchesSchema,type MarketBatchRecord} from "./market-batch-model";
import {replayMarketBatch} from "./market-batch";
import {hashJson} from "./solana";

export function marketBatchWrites(db:D1Database,record:MarketBatchRecord,owner:string) {
  const payload=JSON.stringify(record),slots=record.report.accepted<record.report.requested?["latest","latest_issue"]:["latest"];
  return slots.map(slot=>db.prepare(`INSERT INTO tenx_market_batch_cache(slot,captured_at,payload) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM tenx_market_control WHERE id=1 AND last_commit_owner=?4)
    ON CONFLICT(slot) DO UPDATE SET captured_at=excluded.captured_at,payload=excluded.payload WHERE excluded.captured_at>=tenx_market_batch_cache.captured_at`).bind(slot,record.report.at,payload,owner));
}
export async function marketBatches(db:D1Database) {
  const rows=await db.prepare("SELECT slot,json_remove(payload,'$.inputs') AS summary FROM tenx_market_batch_cache ORDER BY slot").all<{slot:string;summary:string}>();
  const result:{latest:ReturnType<typeof MarketBatchSummarySchema.parse>|null;latest_issue:ReturnType<typeof MarketBatchSummarySchema.parse>|null}={latest:null,latest_issue:null};
  for(const row of rows.results){
    const s=MarketBatchSummarySchema.parse(JSON.parse(row.summary));
    if(await hashJson(s.report)!==s.report_hash||await hashJson({version:"dex-market-report-v1",input_hash:s.input_hash,report_hash:s.report_hash})!==s.record_hash)throw new Error("market_batch_summary_hash_mismatch");
    if(row.slot==="latest"||row.slot==="latest_issue")result[row.slot]=s;
  }
  return MarketBatchesSchema.parse({retention:"latest_response_and_latest_issue",...result,provider_requests:0});
}
export async function marketBatchRecord(db:D1Database,slot:"latest"|"latest_issue") {
  const row=await db.prepare("SELECT payload FROM tenx_market_batch_cache WHERE slot=?1").bind(slot).first<{payload:string}>();
  if(!row)return null;
  const record=MarketBatchRecordSchema.parse(JSON.parse(row.payload));return {record,replay:await replayMarketBatch(record)};
}
