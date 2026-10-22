import { z } from "zod";

const Kind=z.enum(["missing","null","object","array","string","number","boolean","other"]),Count=z.number().int().min(0).max(1_000_000).nullable();
export const GmgnActivityCheck=z.object({field:z.string().max(100).regex(/^(?:root|(?:activities|next|tx_hash|token|address|event_type|type|timestamp|token_amount|cost_usd)(?:\.(?:activities|next|tx_hash|token|address|event_type|type|timestamp|token_amount|cost_usd))*)$/),
  code:z.enum(["invalid_type","too_big","too_small","invalid_format","invalid_value","custom","other"]),check:z.enum(["event_type_missing_or_conflicting","unspecified"])}).strict();
export type GmgnActivityCheckResult=z.infer<typeof GmgnActivityCheck>;
export const GmgnActivityShape=z.object({version:z.literal("gmgn-activity-shape-v1"),accepted_event_limit:z.union([z.literal(20),z.literal(50)]).optional(),root:Kind,activities:Kind,activities_count:Count,
  data:Kind,data_activities:Kind,data_activities_count:Count,list:Kind,list_count:Count,next:Kind,data_next:Kind,validation_checks:z.array(GmgnActivityCheck).max(12)}).strict()
  .refine(v=>(v.activities==="array")===(v.activities_count!==null)&&(v.data_activities==="array")===(v.data_activities_count!==null)&&(v.list==="array")===(v.list_count!==null),"activity_shape_count_mismatch");
export type GmgnActivityShapeResult=z.infer<typeof GmgnActivityShape>;
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const own=(v:unknown,key:string)=>{const row=object(v);return row&&Object.hasOwn(row,key)?row[key]:undefined;};
const kind=(v:unknown):z.infer<typeof Kind>=>v===undefined?"missing":v===null?"null":Array.isArray(v)?"array":typeof v==="object"?"object":typeof v==="string"?"string":typeof v==="number"?"number":typeof v==="boolean"?"boolean":"other";
const count=(v:unknown)=>Array.isArray(v)?v.length:null;
// No keys, values, row contents, message text, cursors, lengths of strings or
// provider exception text leave this projection. It never changes acceptance.
export function describeGmgnActivity(raw:unknown,checks:GmgnActivityCheckResult[]=[],acceptedEventLimit?:20|50):GmgnActivityShapeResult {
  const activities=own(raw,"activities"),data=own(raw,"data"),nested=own(data,"activities"),list=own(raw,"list");
  return GmgnActivityShape.parse({version:"gmgn-activity-shape-v1",...(acceptedEventLimit===undefined?{}:{accepted_event_limit:acceptedEventLimit}),root:kind(raw),activities:kind(activities),activities_count:count(activities),
    data:kind(data),data_activities:kind(nested),data_activities_count:count(nested),list:kind(list),list_count:count(list),next:kind(own(raw,"next")),data_next:kind(own(data,"next")),validation_checks:checks});
}
