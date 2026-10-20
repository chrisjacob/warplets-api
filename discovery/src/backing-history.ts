import { z } from "zod";
import { CandidateSchema } from "./model";
import { CutoffEvidence, PriceReference, type Opening, type Result, type Evidence } from "./backing-model";
import { hashJson } from "./solana";

type Cutoff = z.infer<typeof CutoffEvidence>;
/** No transport: only the bounded journal committed by candidate-write triggers. */
export async function retainedCutoff(db: D1Database, opening: Opening, admittedAt: string, limited: boolean) {
  const rows = await db.prepare("SELECT sequence,address,recorded_at,payload FROM tenx_backing_candidate_history WHERE run_id=? ORDER BY sequence LIMIT 201")
    .bind(opening.id).all<{sequence:number;address:string;recorded_at:string;payload:string}>();
  if (rows.results.length > 200) throw new Error("backing_history_capacity_mismatch");
  const selected = new Map(opening.candidates.map(candidate => [candidate.address, { candidate, sequence:null as number|null, recorded_at:admittedAt }]));
  const prices: Cutoff["prices"] = [];
  function price(candidate: Opening["candidates"][number], sequence:number|null, recorded_at:string) {
    const m=candidate.market;
    if(m) prices.push({address:candidate.address,sequence,recorded_at,source:m.source,fetched_at:m.fetched_at,observed_at:m.observed_at,price_usd:m.price_usd});
  }
  for (const c of opening.candidates) price(c,null,admittedAt);
  for (const row of rows.results) {
    const candidate=CandidateSchema.parse(JSON.parse(row.payload));
    if (!selected.has(row.address) || candidate.address!==row.address || candidate.mode!=="live" || row.recorded_at<admittedAt || row.recorded_at>opening.ends_at) throw new Error("backing_history_snapshot_mismatch");
    selected.set(row.address,{candidate,sequence:row.sequence,recorded_at:row.recorded_at});
    price(candidate,row.sequence,row.recorded_at);
  }
  const snapshots=[...selected.values()].sort((a,b)=>a.candidate.address<b.candidate.address?-1:1);
  return { closing:snapshots.map(s=>s.candidate), cutoff:CutoffEvidence.parse({version:"candidate-journal-v1",baseline_recorded_at:admittedAt,history_limited:limited,
    selected:await Promise.all(snapshots.map(async s=>({address:s.candidate.address,sequence:s.sequence,recorded_at:s.recorded_at,payload_hash:await hashJson(s.candidate)}))),prices}) };
}

export async function validateCutoff(opening:Opening,evidence:Evidence) {
  const cutoff=evidence.cutoff;
  if (!opening.cutoff_evidence_version) { if(cutoff) throw new Error("backing_unexpected_cutoff_history"); return; }
  if (!cutoff || cutoff.version!==opening.cutoff_evidence_version || cutoff.baseline_recorded_at<opening.starts_at || cutoff.baseline_recorded_at>opening.ends_at || cutoff.selected.length!==opening.candidates.length || cutoff.selected.length!==evidence.closing_candidates.length) throw new Error("backing_cutoff_history_missing_or_mismatched");
  const seen=new Set<string>();
  for(const s of cutoff.selected){
    const c=evidence.closing_candidates.find(c=>c.address===s.address),baseline=opening.candidates.find(c=>c.address===s.address);
    if(seen.has(s.address)||!c||!baseline||s.recorded_at<cutoff.baseline_recorded_at||s.recorded_at>opening.ends_at||await hashJson(c)!==s.payload_hash||(s.sequence===null&&(s.recorded_at!==cutoff.baseline_recorded_at||await hashJson(baseline)!==s.payload_hash))) throw new Error("backing_cutoff_snapshot_mismatch");
    seen.add(s.address);
  }
  for(const p of cutoff.prices) if(!seen.has(p.address)||p.recorded_at<cutoff.baseline_recorded_at||p.recorded_at>opening.ends_at) throw new Error("backing_price_snapshot_mismatch");
}

// Exact arithmetic on the captured JSON number, including scientific notation.
// This cannot recover precision already lost at the market provider/JSON boundary.
export function referenceMicros(baseRaw:string, decimals:number, price:number):string {
  const [mantissa, exponent="0"]=price.toString().toLowerCase().split("e"), [whole,fraction=""]=mantissa!.split(".");
  const numerator=BigInt(whole!+fraction)*BigInt(baseRaw)*1000000n;
  const scale=decimals+fraction.length-Number(exponent);
  return (scale>=0?numerator/(10n**BigInt(scale)):numerator*(10n**BigInt(-scale))).toString();
}
export function priceReferences(entries:Result["entries"],evidence:Evidence):z.infer<typeof PriceReference>[] {
  return entries.map(entry=>{
    const tx=evidence.transactions.find(t=>t.signature===entry.signature)!.transaction;
    const decimals=[...new Set([...(tx.meta?.preTokenBalances??[]),...(tx.meta?.postTokenBalances??[])].filter(b=>b.mint===entry.mint).map(b=>b.uiTokenAmount.decimals))];
    const block=Date.parse(entry.block_time);
    // Both source fetch and the local database write timestamp must precede the trade.
    // SQLite's timestamp is not an independent commit receipt or trusted clock.
    const snapshot=evidence.cutoff!.prices.filter(p=>p.address===entry.mint&&Date.parse(p.recorded_at)<=block&&Date.parse(p.fetched_at)<=Date.parse(p.recorded_at)&&(!p.observed_at||Date.parse(p.observed_at)<=Date.parse(p.recorded_at)))
      .sort((a,b)=>Date.parse(b.recorded_at)-Date.parse(a.recorded_at)||(b.sequence??0)-(a.sequence??0))[0];
    const gaps:string[]=["historical_USD_valuation_unverified","local_write_time_not_independent_commit_receipt"];
    if(evidence.cutoff!.history_limited)gaps.push("price_history_incomplete");
    if(decimals.length!==1)gaps.push("mint_decimals_missing_or_ambiguous");
    if(!snapshot)gaps.push("no_pre_trade_price_available");
    else {
      if(block-Date.parse(snapshot.fetched_at)>180000 || (snapshot.observed_at&&block-Date.parse(snapshot.observed_at)>180000))gaps.push("pre_trade_price_stale");
      if(snapshot.price_usd===null||snapshot.price_usd<=0)gaps.push("positive_price_missing");
      if(!snapshot.observed_at)gaps.push("provider_publication_time_unknown");
    }
    let value=decimals.length===1&&snapshot&&snapshot.price_usd!==null&&snapshot.price_usd>0&&!gaps.includes("pre_trade_price_stale")?referenceMicros(entry.base_amount_raw,decimals[0]!,snapshot.price_usd):null;
    if(value!==null&&value.length>80){value=null;gaps.push("price_reference_out_of_bounds");}
    return PriceReference.parse({mint:entry.mint,signature:entry.signature,instruction_index:entry.instruction_index,reference_usd_micros:value,verified_usd_micros:null,decimals:decimals.length===1?decimals[0]:null,
      snapshot_sequence:snapshot?.sequence??null,snapshot_recorded_at:snapshot?.recorded_at??null,source:snapshot?.source??null,fetched_at:snapshot?.fetched_at??null,status:value!==null?"provider_reference_only":"unavailable",gaps});
  });
}
