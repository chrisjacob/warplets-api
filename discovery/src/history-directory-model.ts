import {z} from "zod";
import {Address} from "./model";

export const HistoryQuery=z.object({mode:z.enum(["live","fixture"]).default("live"),limit:z.coerce.number().int().min(1).max(100).default(100),
  mint:Address.optional(),cursor:z.string().max(512).optional()}).strict();
export const HistoryCursor=z.object({version:z.literal("history-directory-v1"),mode:z.enum(["live","fixture"]),mint:Address.nullable(),after:Address}).strict();
export const HistoryEntry=z.object({address:Address,name:z.string().max(100).nullable(),symbol:z.string().max(32).nullable(),checked_at:z.string().datetime().nullable(),
  metadata_status:z.enum(["available","held"])}).strict().refine(r=>r.metadata_status==="available"?r.name!==null&&r.symbol!==null&&r.checked_at!==null:r.name===null&&r.symbol===null&&r.checked_at===null);
export const HistoryDirectory=z.object({version:z.literal("history-directory-v1"),read_at:z.string().datetime(),mode:z.enum(["live","fixture"]),mint:Address.nullable(),
  rows:z.array(HistoryEntry).max(100),total_retained:z.number().int().safe().nonnegative(),next_cursor:z.string().min(1).max(512).nullable(),
  scope:z.literal("retained_identity_directory"),pagination:z.literal("live_keyset_not_snapshot"),ordering:z.literal("address_ascii_ascending"),
  ranked:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0)}).strict().superRefine((r,ctx)=>{
    if(r.rows.some((row,i)=>i>0&&row.address<=r.rows[i-1]!.address)||r.rows.some(row=>r.mint!==null&&row.address!==r.mint)||r.rows.length>r.total_retained||r.next_cursor!==null&&r.rows.length===0)
      ctx.addIssue({code:"custom",message:"history_directory_partition_or_order"});
  });
export type HistoryDirectory=z.infer<typeof HistoryDirectory>;
