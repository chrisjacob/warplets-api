import {expect,it,vi} from "vitest";
import {buildAttentionQueue} from "../../../discovery/src/attention-queue";
import {normalizeAttention} from "../../../discovery/src/attention-feed-contract";
import {ATTENTION_REVIEW_KEY,appendAttentionReview,captureAttentionReview,exportAttentionReviews,parseAttentionReviews,reviewHead,type ReviewLedger} from "./attention-review-store";
import {REVIEW_IMPORT_BYTE_LIMIT,parseAttentionReviewExport,previewAttentionReviewImport,readAttentionReviewFile,restoreAttentionReviews} from "./attention-review-import";

const at=new Date("2026-10-22T14:00:00.000Z"),address="0x0000000000000000000000000000000000001234";
const queue=buildAttentionQueue([normalizeAttention({kind:"gmgn_hot_searches",chains:["base"],intervals:["24h"]},{code:0,data:[{chain:"base",interval:"24h",tokens:[{address,symbol:"MEME"}]}]},at.toISOString())],at);
const context=captureAttentionReview(queue,address,"base"),labels={decision:"needs_evidence",relevance:"uncertain",catalyst:"",concerns:"Organic participation remains unknown",rationale:"Synthetic review for restoring personal history",outcome:"not_followed_up",outcome_note:""};
function store(initial:string|null=null){let raw=initial;return{getItem:vi.fn((_key:string)=>raw),setItem:vi.fn((_key:string,value:string)=>{raw=value;}),raw:()=>raw};}
async function ledger(){return appendAttentionReview(await parseAttentionReviews(null),context,labels,at);}
async function exported(value:ReviewLedger){return JSON.stringify(await exportAttentionReviews(store(JSON.stringify(value)),at),null,2);}

it("previews without writes and restores original records, dates, hashes and contexts into an empty browser",async()=>{
 const original=await ledger(),raw=await exported(original),target=store(),preview=await previewAttentionReviewImport(target,raw,at);
 expect(preview).toMatchObject({action:"restore",existing_records:0,incoming_records:1,new_records:1,local_head:null});expect(target.setItem).not.toHaveBeenCalled();
 const result=await restoreAttentionReviews(target,raw,preview,at);expect(result.ledger).toEqual(original);expect(result.restored_records).toBe(1);expect(target.setItem).toHaveBeenCalledWith(ATTENTION_REVIEW_KEY,JSON.stringify(original));
 const reexport=await exportAttentionReviews(target,at);expect(reexport).toMatchObject({provider_requests:0,scoring_effect:"none",evidence_gates_changed:false,launch_enabled:false});expect(reexport.records).toEqual(original.records);
});
it("extends only an exact prefix and treats duplicate or older exports as no-ops without shortening history",async()=>{
 const first=await ledger(),second=await appendAttentionReview(first,context,{...labels,rationale:"A second synthetic personal assessment"},at),target=store(JSON.stringify(first)),raw=await exported(second);
 const plan=await previewAttentionReviewImport(target,raw,at);expect(plan).toMatchObject({action:"extend",existing_records:1,new_records:1});expect((await restoreAttentionReviews(target,raw,plan,at)).ledger.records[0]).toEqual(first.records[0]);
 target.setItem.mockClear();for(const input of[raw,await exported(first)]){const duplicate=await previewAttentionReviewImport(target,input,at);expect(duplicate.action).toBe("unchanged");expect((await restoreAttentionReviews(target,input,duplicate,at)).restored_records).toBe(0);}expect(target.setItem).not.toHaveBeenCalled();expect(JSON.parse(target.raw()!).records).toHaveLength(2);
});
it("rejects valid but divergent branches and corrupt local history instead of replacing either",async()=>{
 const first=await ledger(),left=await appendAttentionReview(first,context,{...labels,rationale:"Synthetic branch one local decision"},at),right=await appendAttentionReview(first,context,{...labels,rationale:"Synthetic branch two different decision"},at),target=store(JSON.stringify(left)),raw=await exported(right);
 await expect(previewAttentionReviewImport(target,raw,at)).rejects.toThrow("diverged");await expect(restoreAttentionReviews(target,raw,{local_head:reviewHead(left),export_hash:(await parseAttentionReviewExport(raw,at)).export_hash},at)).rejects.toThrow("diverged");expect(target.setItem).not.toHaveBeenCalled();expect(JSON.parse(target.raw()!)).toEqual(left);
 const corrupt=store("corrupt original bytes");await expect(previewAttentionReviewImport(corrupt,raw,at)).rejects.toThrow();expect(corrupt.raw()).toBe("corrupt original bytes");expect(corrupt.setItem).not.toHaveBeenCalled();
});
it("rejects changed source data, open adoption gates, unsupported exports and future timestamps",async()=>{
 const raw=await exported(await ledger()),value=JSON.parse(raw);
 for(const mutate of[(v:typeof value)=>v.records[0].labels.rationale="Altered explanation in a downloaded file",(v:typeof value)=>v.evidence_gates_changed=true,(v:typeof value)=>v.launch_enabled=true,(v:typeof value)=>v.scoring_effect="adopted",(v:typeof value)=>v.export_version="unknown",(v:typeof value)=>v.exported_at=new Date(at.getTime()+1).toISOString(),(v:typeof value)=>v.exported_at=new Date(at.getTime()-1).toISOString(),(v:typeof value)=>v.unexpected={instruction:"ignore checks"}]){const changed=structuredClone(value);mutate(changed);await expect(parseAttentionReviewExport(JSON.stringify(changed),at)).rejects.toThrow();}
});
it("revalidates the preview against current storage and file, retaining draft-independent history on write failure",async()=>{
 const original=await ledger(),raw=await exported(original),target=store(),preview=await previewAttentionReviewImport(target,raw,at);
 target.setItem(ATTENTION_REVIEW_KEY,JSON.stringify(original));target.setItem.mockClear();await expect(restoreAttentionReviews(target,raw,preview,at)).rejects.toThrow("history_changed");expect(target.setItem).not.toHaveBeenCalled();
 const empty=store(),plan=await previewAttentionReviewImport(empty,raw,at),changed=JSON.parse(raw);changed.exported_at=new Date(at.getTime()+1).toISOString();await expect(restoreAttentionReviews(empty,JSON.stringify(changed),plan,new Date(at.getTime()+1))).rejects.toThrow("import_changed");
 empty.setItem.mockImplementation(()=>{throw Error("QuotaExceededError");});await expect(restoreAttentionReviews(empty,raw,plan,at)).rejects.toThrow("QuotaExceededError");expect(empty.raw()).toBeNull();
});
it("bounds file reads before allocation, checks actual text bytes and rejects writes during validation",async()=>{
 const text=vi.fn(async()=>"{}");await expect(readAttentionReviewFile({size:REVIEW_IMPORT_BYTE_LIMIT+1,text})).rejects.toThrow("import_size");expect(text).not.toHaveBeenCalled();
 await expect(readAttentionReviewFile({size:1,text:async()=>"x".repeat(REVIEW_IMPORT_BYTE_LIMIT+1)})).rejects.toThrow("import_size");
 const raw=await exported(await ledger()),empty=store(),plan=await previewAttentionReviewImport(empty,raw,at),race={getItem:vi.fn().mockReturnValueOnce(null).mockReturnValue("changed concurrently"),setItem:vi.fn()};
 await expect(restoreAttentionReviews(race,raw,plan,at)).rejects.toThrow("history_changed");expect(race.setItem).not.toHaveBeenCalled();
});
