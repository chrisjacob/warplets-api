import { WindowCoverage, WindowEvidence, emptyWindow, type Window } from "./backing-window-model";
import type { Opening, Evidence } from "./backing-model";
import { hashJson } from "./solana";
import { keys } from "./wallet-rpc";

export const trackedWallets=(opening:Opening)=>opening.members.map(m=>m.address).sort().slice(0,16);
/** A lower time boundary is required. A short/empty archival response does not prove completeness. */
export function boundaryReached(opening:Opening,pages:Window["pages"]):boolean {
  return pages.some(p=>p.rows.some(r=>r.blockTime!==null&&r.blockTime>=0&&r.blockTime*1000<Date.parse(opening.starts_at)));
}
export function expectedWindowRows(opening:Opening,pages:Window["pages"]) {
  const rows=new Map<string,Window["pages"][number]["rows"][number]>();
  for(const page of pages)for(const row of page.rows)if(row.err===null&&row.blockTime!==null&&row.blockTime*1000>=Date.parse(opening.starts_at)&&row.blockTime*1000<Date.parse(opening.ends_at)) {
    const prior=rows.get(row.signature);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw new Error("backing_signature_observation_conflict");
    rows.set(row.signature,row);
  }
  return [...rows.values()].sort((a,b)=>a.slot-b.slot||a.signature.localeCompare(b.signature));
}
export async function windowCoverage(opening:Opening,window:Window,transactions:Evidence["transactions"]) {
  WindowEvidence.parse(window);
  const tracked=trackedWallets(opening),gaps=new Set<string>();
  const end=Date.parse(opening.ends_at),deadline=Date.parse(opening.deadline);
  let finalityValid=false;
  if(window.finality){
    const f=window.finality,at=Date.parse(f.fetched_at);
    if(at<end||at>deadline||f.block_time*1000>at)throw new Error("backing_finality_observation_time_mismatch");
    finalityValid=f.block_time*1000>=end;
    if(!finalityValid)gaps.add("finalized_block_time_before_cutoff");
  }else gaps.add("finalized_slot_observation_missing");
  let boundaries=0;
  for(const address of tracked){
    const pages=window.pages.filter(p=>p.address===address),seen=new Set<string>();let before:string|null=null,lastSlot=Number.MAX_SAFE_INTEGER,lastTime=Infinity;
    for(const page of pages){
      if(page.before!==before||!window.finality||page.min_context_slot!==window.finality.slot||page.fetched_at<window.finality.fetched_at||Date.parse(page.fetched_at)>deadline||await hashJson(page.rows)!==page.rows_hash)throw new Error("backing_history_page_provenance_mismatch");
      if(boundaryReached(opening,pages.slice(0,pages.indexOf(page))))throw new Error("backing_history_page_after_boundary");
      for(const row of page.rows){
        if(seen.has(row.signature)||row.slot>lastSlot)throw new Error("backing_history_cursor_or_order_mismatch");seen.add(row.signature);lastSlot=row.slot;
        if(row.confirmationStatus!=="finalized")gaps.add("signature_finality_not_reported");
        if(row.err!==null&&(typeof row.err!=="string"&&(typeof row.err!=="object"||Array.isArray(row.err))))gaps.add("signature_execution_status_unknown");
        if(row.blockTime===null||row.blockTime<0)gaps.add("signature_block_time_unknown");
        else {
          if(row.blockTime>lastTime)gaps.add("signature_block_time_nonmonotonic");lastTime=row.blockTime;
          if(row.blockTime*1000>Date.parse(page.fetched_at))gaps.add("signature_block_time_from_future");
          if(row.blockTime*1000<end&&row.slot>window.finality!.slot)gaps.add("window_signature_above_finalized_slot");
        }
      }
      before=page.rows.at(-1)?.signature??null;
      if(page.rows.length===0&&page!==pages.at(-1))throw new Error("backing_history_cursor_or_order_mismatch");
    }
    if(boundaryReached(opening,pages))boundaries++;else gaps.add("wallet_start_boundary_not_reached");
  }
  if(window.pages.some(p=>!tracked.includes(p.address)))throw new Error("backing_history_wallet_not_frozen");
  if(opening.members.length>tracked.length)gaps.add("wallet_inventory_limit_reached");
  if(!opening.members.length)gaps.add("no_linked_wallets_at_open");
  if(window.capacity_limited)gaps.add("window_index_capacity_limited");
  if(window.last_error)gaps.add(`collector_${window.last_error}`);
  const expected=expectedWindowRows(opening,window.pages),bodies=new Map(transactions.map(t=>[t.signature,t]));
  let available=0;
  for(const row of expected){
    const body=bodies.get(row.signature);
    if(!body)continue;
    if(body.transaction.slot!==row.slot||body.transaction.blockTime!==row.blockTime||body.transaction.meta?.err!==null||body.fetched_at<opening.starts_at||Date.parse(body.fetched_at)>deadline)throw new Error("backing_indexed_transaction_mismatch");
    for(const page of window.pages)if(page.rows.some(r=>r.signature===row.signature)&&!keys(body.transaction).includes(page.address))throw new Error("backing_indexed_wallet_not_referenced");
    available++;
  }
  if(expected.length>100)gaps.add("window_transaction_inventory_limit_reached");
  if(expected.length>available)gaps.add("indexed_transaction_bodies_missing");
  if(transactions.some(t=>!expected.some(r=>r.signature===t.signature)&&opening.members.some(m=>keys(t.transaction).includes(m.address))))gaps.add("cached_member_transactions_outside_index");
  // These remain limitations even when the bounded provider history reaches its lower boundary.
  const blocked=gaps.size>0;
  gaps.add("RPC_history_not_independently_exhaustive");gaps.add("independent_finality_not_verified");gaps.add("block_time_is_estimated");
  return WindowCoverage.parse({scope:"bounded_RPC_wallet_history",status:!opening.members.length?"no_linked_wallets":blocked?"incomplete":"rpc_window_covered",wallets_requested:opening.members.length,wallets_tracked:tracked.length,wallet_boundaries_reached:boundaries,pages:window.pages.length,
    signatures_in_window:expected.length,bodies_retained:available,bodies_missing:expected.length-available,finalized_slot:finalityValid?window.finality!.slot:null,finalized_block_time:window.finality?.block_time??null,reserved_calls:window.reserved_calls,independent_finality_verified:false,gaps:[...gaps].sort()});
}
export async function retainedWindow(db:D1Database,id:string):Promise<Window>{
  const row=await db.prepare("SELECT payload,reserved_calls,last_error FROM tenx_backing_window_index WHERE run_id=?").bind(id).first<{payload:string;reserved_calls:number;last_error:string|null}>();
  return WindowEvidence.parse({...(row?JSON.parse(row.payload):emptyWindow()),reserved_calls:row?.reserved_calls??0,last_error:row?row.last_error:"collector_not_started"});
}
