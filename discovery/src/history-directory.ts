import {z} from "zod";
import {HistoryQuery,HistoryCursor,HistoryDirectory,type HistoryDirectory as Directory} from "./history-directory-model";
import {RequestSecurityError} from "./request-security";

/** Two indexed SELECTs; never loads Candidate objects, evaluates scores or writes. */
export async function historyDirectory(db:D1Database,raw:unknown,now=new Date()):Promise<Directory>{
  const query=HistoryQuery.parse(raw),mint=query.mint??null;let after="";
  if(query.cursor){
    try{const cursor=HistoryCursor.parse(JSON.parse(atob(query.cursor)));
      if(cursor.mode!==query.mode||cursor.mint!==mint)throw Error("scope");after=cursor.after;
    }catch{throw new RequestSecurityError("history_cursor_invalid",400);}
  }
  const results=await db.batch([
    db.prepare("SELECT count(*) AS total FROM tenx_candidates WHERE mode=?1").bind(query.mode),
    // At most 101 * 16 KB of JSON is parsed for metadata. Larger candidate
    // records remain addressable as held directory hints, never truncated.
    db.prepare(`SELECT address,CASE WHEN length(checked_at)<=40 THEN checked_at ELSE NULL END AS checked_at,CASE WHEN length(CAST(payload AS BLOB))<=16000 AND json_valid(payload) THEN
      json_object('address',CASE WHEN json_type(payload,'$.address')='text' AND length(json_extract(payload,'$.address'))<=44 THEN json_extract(payload,'$.address') ELSE NULL END,
        'mode',CASE WHEN json_type(payload,'$.mode')='text' AND length(json_extract(payload,'$.mode'))<=7 THEN json_extract(payload,'$.mode') ELSE NULL END,
        'name',CASE WHEN json_type(payload,'$.name')='text' AND length(json_extract(payload,'$.name'))<=100 THEN json_extract(payload,'$.name') ELSE NULL END,
        'symbol',CASE WHEN json_type(payload,'$.symbol')='text' AND length(json_extract(payload,'$.symbol'))<=32 THEN json_extract(payload,'$.symbol') ELSE NULL END,
        'checked_at',CASE WHEN json_type(payload,'$.checked_at')='text' AND length(json_extract(payload,'$.checked_at'))<=40 THEN json_extract(payload,'$.checked_at') ELSE NULL END)
      ELSE NULL END AS metadata FROM tenx_candidates WHERE mode=?1 AND address>?2 ${mint?"AND address=?4":""} ORDER BY address LIMIT ?3`)
      .bind(query.mode,after,query.limit+1,...mint?[mint]:[]),
  ]);
  const total=z.object({total:z.number().int().safe().nonnegative()}).parse(results[0]!.results[0]).total;
  const saved=z.array(z.object({address:z.string(),checked_at:z.string().nullable(),metadata:z.string().nullable()})).max(101).parse(results[1]!.results);
  const rows:Directory["rows"]=saved.slice(0,query.limit).map(row=>{
    let metadata;
    try{metadata=z.object({address:z.literal(row.address),mode:z.literal(query.mode),name:z.string().max(100),symbol:z.string().max(32),checked_at:z.string().datetime()}).strict().parse(JSON.parse(row.metadata??"null"));
      if(metadata.checked_at!==row.checked_at)metadata=undefined;
    }catch{metadata=undefined;}
    return {address:row.address,name:metadata?.name??null,symbol:metadata?.symbol??null,checked_at:metadata?.checked_at??null,metadata_status:metadata?"available":"held"};
  });
  const next_cursor=saved.length>query.limit?btoa(JSON.stringify({version:"history-directory-v1",mode:query.mode,mint,after:rows.at(-1)!.address})):null;
  try{return HistoryDirectory.parse({version:"history-directory-v1",read_at:now.toISOString(),mode:query.mode,mint,rows,total_retained:total,next_cursor,
    scope:"retained_identity_directory",pagination:"live_keyset_not_snapshot",ordering:"address_ascii_ascending",ranked:false,provider_requests:0,database_writes:0});}
  catch{throw new RequestSecurityError("history_metadata_unavailable",503);}
}
