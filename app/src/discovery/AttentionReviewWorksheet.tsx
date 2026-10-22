import { useEffect, useRef, useState } from "react";
import { ATTENTION_REVIEW_KEY, AttentionReviewLabels, exportAttentionReviews, parseAttentionReviews, reviewHead, saveAttentionReview,
  type ReviewContext, type ReviewLabels, type ReviewLedger } from "./attention-review-store";
import "./attention-review.css";
import { previewAttentionReviewImport, readAttentionReviewFile, restoreAttentionReviews, type AttentionReviewImportPreview } from "./attention-review-import";

const blank:ReviewLabels={decision:"needs_evidence",relevance:"uncertain",catalyst:"",concerns:"",rationale:"",outcome:"not_followed_up",outcome_note:""};
const readable=(value:string)=>value.replaceAll("_"," ");
function errorText(cause:unknown) {
  const code=cause instanceof Error?cause.message:"";
  if(code==="review_history_changed")return"Another tab changed the review history. Reload local history, then save your retained draft.";
  if(code==="review_storage_full"||code==="review_storage_bound")return"Local review storage reached its bound. Export the retained history; no records were removed.";
  if(code==="review_lock_unavailable")return"This browser cannot lock local review storage. Saving is unavailable; your draft remains here.";
  if(code==="review_import_diverged")return"This file conflicts with the local review history. Neither history was merged or replaced.";
  if(code==="review_import_changed")return"The chosen export changed after preview. Inspect the file again before restoring.";
  if(code==="review_import_size")return"This file exceeds the review import size bound. Local history is unchanged.";
  if(code==="review_import_time")return"The export timestamps could not be admitted against this device’s clock. Local history is unchanged.";
  return"Local review history could not be verified or saved. Your draft is retained; existing history was not replaced.";
}
export function AttentionReviewWorksheet({context,onClose,onBusyChange}:{context:ReviewContext|null;onClose:()=>void;onBusyChange?:(busy:boolean)=>void}) {
  const [ledger,setLedger]=useState<ReviewLedger|null>(null),[draft,setDraft]=useState<ReviewLabels>(blank),[selected,setSelected]=useState<ReviewContext|null>(context),[busy,changeBusy]=useState(false),[message,setMessage]=useState("");
  const setBusy=(value:boolean)=>{changeBusy(value);onBusyChange?.(value);};
  const [ready,setReady]=useState(false),heading=useRef<HTMLHeadingElement>(null),active=useRef(false),alive=useRef(true);
  const [importPreview,setImportPreview]=useState<AttentionReviewImportPreview|null>(null),[importName,setImportName]=useState(""),[importConfirmed,setImportConfirmed]=useState(false),importText=useRef<string|null>(null);
  const resetImport=()=>{setImportPreview(null);setImportName("");setImportConfirmed(false);importText.current=null;};
  const load=async()=>{if(active.current)return;resetImport();active.current=true;setBusy(true);
    try{const value=await parseAttentionReviews(window.localStorage.getItem(ATTENTION_REVIEW_KEY));if(alive.current){setLedger(value);setReady(true);setMessage("");}}
    catch(cause){if(alive.current){setReady(false);setMessage(errorText(cause));}}
    finally{active.current=false;if(alive.current)setBusy(false);}};
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[]);
  useEffect(()=>{setSelected(context);setDraft(blank);setMessage("");if(context)heading.current?.focus();},[context]);
  useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key===ATTENTION_REVIEW_KEY){setReady(false);resetImport();setMessage("Review history changed in another tab. Reload local history before saving.");}};window.addEventListener("storage",changed);return()=>window.removeEventListener("storage",changed);},[]);
  const set=<K extends keyof ReviewLabels>(key:K,value:ReviewLabels[K])=>setDraft(old=>({...old,[key]:value}));
  const save=async()=>{if(active.current||!ledger||!selected||!ready)return;const labels=AttentionReviewLabels.safeParse(draft);if(!labels.success){setMessage(labels.error.issues[0]?.message??"Complete the review fields.");return;}
    active.current=true;setBusy(true);
    try{if(!navigator.locks)throw Error("review_lock_unavailable");
      const next=await navigator.locks.request(ATTENTION_REVIEW_KEY,{mode:"exclusive",signal:AbortSignal.timeout(10000)},()=>saveAttentionReview(window.localStorage,reviewHead(ledger),selected,labels.data));
      if(alive.current){setLedger(next);resetImport();setMessage("Review revision saved in this browser. Scores and launch checks are unchanged.");}
    }catch(cause){if(alive.current){setReady(false);setMessage(errorText(cause));}}
    finally{active.current=false;if(alive.current)setBusy(false);}};
  const download=async()=>{if(active.current)return;active.current=true;setBusy(true);
    try{const data=await exportAttentionReviews(window.localStorage),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download=`10x-personal-attention-reviews-${new Date().toISOString().slice(0,10)}.json`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);if(alive.current)setMessage("Verified local history exported. This export contains your notes and saved observations.");}
    catch(cause){if(alive.current)setMessage(errorText(cause));}
    finally{active.current=false;if(alive.current)setBusy(false);}};
  const inspectImport=async(file:File|undefined)=>{if(active.current)return;resetImport();if(!file)return;active.current=true;setBusy(true);
    try{const raw=await readAttentionReviewFile(file),preview=await previewAttentionReviewImport(window.localStorage,raw);
      if(alive.current){importText.current=raw;setImportName(file.name);setImportPreview(preview);setMessage("File checked. Review the restore preview; local history has not changed.");}}
    catch(cause){if(alive.current)setMessage(errorText(cause));}
    finally{active.current=false;if(alive.current)setBusy(false);}};
  const restore=async()=>{if(active.current||!ready||!importPreview||!importConfirmed||importText.current===null)return;active.current=true;setBusy(true);
    try{if(!navigator.locks)throw Error("review_lock_unavailable");const raw=importText.current,expected=importPreview;
      const result=await navigator.locks.request(ATTENTION_REVIEW_KEY,{mode:"exclusive",signal:AbortSignal.timeout(10000)},()=>restoreAttentionReviews(window.localStorage,raw,expected));
      if(alive.current){setLedger(result.ledger);resetImport();setMessage(`${result.restored_records} review revisions restored. Original timestamps and saved observations are retained.`);}}
    catch(cause){if(alive.current){setReady(false);resetImport();setMessage(errorText(cause));}}
    finally{active.current=false;if(alive.current)setBusy(false);}};
  const records=ledger?.records??[],latest=records.filter((record,index)=>!records.slice(index+1).some(other=>other.context.token.chain===record.context.token.chain&&other.context.token.address===record.context.token.address)).reverse();
  return <section className="tenx-personal-reviews" aria-labelledby="attention-personal-reviews-title"><h3 id="attention-personal-reviews-title" ref={heading} tabIndex={-1}>My attention reviews</h3>
    <p>Personal notes stay in this browser and are not synced. Each saved revision retains the observations you reviewed. Labels do not change scores, prove safety or enable a launch.</p>
    <div className="tenx-row"><button className="tenx-button tenx-button--quiet" disabled={busy} onClick={()=>void load()}>Reload local history</button><button className="tenx-button tenx-button--quiet" disabled={busy||!ready||!records.length} onClick={()=>void download()}>Export review history</button></div>
    <p role="status" aria-live="polite">{busy?"Checking local review history…":message||`${records.length} saved revision${records.length===1?"":"s"}.`}</p>
    <details className="tenx-review-import"><summary>Restore an exported review history</summary><p>Choose a JSON export from another browser or backup. The file is checked locally. Compatible revisions can be restored; existing notes will not be deleted or merged with a conflicting history.</p>
      <label>Review export file<input type="file" accept="application/json,.json" disabled={busy||!ready} onChange={e=>{const file=e.target.files?.[0];e.target.value="";void inspectImport(file);}}/></label>
      {importPreview&&<div aria-label="Review restore preview"><p><strong>{importName}</strong></p><p>Exported {new Date(importPreview.exported_at).toLocaleString()}. {importPreview.incoming_records} file revisions, {importPreview.existing_records} local revisions, {importPreview.new_records} new revisions.</p>
        <p>{importPreview.action==="unchanged"?"Local history already contains these revisions. No restore is needed.":importPreview.action==="restore"?"Restore into this empty local history.":"Append the matching continuation to local history."}</p>
        {importPreview.first_record_at&&<p>Original review dates: {new Date(importPreview.first_record_at).toLocaleString()} – {new Date(importPreview.last_record_at!).toLocaleString()}.</p>}
        <ul>{importPreview.subjects.slice(0,10).map(subject=><li key={`${subject.chain}:${subject.address}`}>{subject.symbol??"Unknown token"} · {subject.chain} · <span className="tenx-address">{subject.address}</span></li>)}</ul>{importPreview.subjects.length>10&&<p>And {importPreview.subjects.length-10} more token identities in the file.</p>}
        <p>Imported labels remain personal claims. Restoring them does not freshen observations, verify the reviewer or enable a launch.</p>
        {importPreview.action!=="unchanged"&&<><label className="tenx-review-confirm"><input type="checkbox" checked={importConfirmed} disabled={busy||!ready} onChange={e=>setImportConfirmed(e.target.checked)}/> I reviewed this file and want to restore these personal notes in this browser.</label><button className="tenx-button" disabled={busy||!ready||!importConfirmed} onClick={()=>void restore()}>Restore verified revisions</button></>}
        <button className="tenx-button tenx-button--quiet" disabled={busy} onClick={resetImport}>Cancel restore preview</button>
      </div>}
    </details>
    {selected&&<form aria-label="Personal attention review" onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy}><legend>{selected.token.symbol??"Unknown token"} · {selected.token.chain}</legend>
      <p className="tenx-address">{selected.token.address}</p><p>Observations saved at {new Date(selected.as_of).toLocaleString()}. This snapshot stays fixed while you write.</p>
      <label>My assessment<select value={draft.decision} onChange={e=>set("decision",e.target.value as ReviewLabels["decision"])}><option value="needs_evidence">Needs more evidence</option><option value="follow">Worth following</option><option value="set_aside">Set aside</option></select></label>
      <label>Meme relevance<select value={draft.relevance} onChange={e=>set("relevance",e.target.value as ReviewLabels["relevance"])}><option value="uncertain">Uncertain</option><option value="memecoin">Memecoin</option><option value="not_memecoin">Not a memecoin</option></select></label>
      <label>Current catalyst<textarea rows={2} maxLength={600} value={draft.catalyst} onChange={e=>set("catalyst",e.target.value)}/></label>
      <label>Quality concerns<textarea rows={2} maxLength={600} value={draft.concerns} onChange={e=>set("concerns",e.target.value)}/></label>
      <label>Why this assessment?<textarea required minLength={10} rows={2} maxLength={600} value={draft.rationale} onChange={e=>set("rationale",e.target.value)}/></label>
      <label>Follow-up outcome (my observation)<select value={draft.outcome} onChange={e=>set("outcome",e.target.value as ReviewLabels["outcome"])}>{["not_followed_up","still_active","attention_faded","adverse_reported","unknown"].map(o=><option key={o} value={o}>{readable(o)}</option>)}</select></label>
      <label>Outcome explanation<textarea rows={2} maxLength={600} value={draft.outcome_note} onChange={e=>set("outcome_note",e.target.value)}/></label>
      <div className="tenx-row"><button className="tenx-button" disabled={!ready}>Save review revision</button><button type="button" className="tenx-button tenx-button--quiet" onClick={()=>{setSelected(null);onClose();}}>Close draft</button></div>
    </fieldset></form>}
    {latest.length>0&&<details><summary>Saved tokens ({latest.length}) · {records.length} revisions</summary><ul>{latest.map(record=><li key={record.id}><strong>{record.context.token.symbol??record.context.token.address} · {record.context.token.chain}</strong> · {readable(record.labels.decision)} · {record.review_day} · revision {record.revision}<p>{record.labels.rationale}</p><button disabled={busy||!ready} className="tenx-button tenx-button--quiet" onClick={()=>{setSelected(structuredClone(record.context));setDraft({...record.labels});setMessage("");heading.current?.focus();}}>Follow up on saved observations</button><details><summary>Revision history</summary><ol>{records.filter(r=>r.context.token.chain===record.context.token.chain&&r.context.token.address===record.context.token.address).map(r=><li key={r.id}>{new Date(r.recorded_at).toLocaleString()} · {readable(r.labels.decision)} · {readable(r.labels.outcome)}<p>{r.labels.rationale}</p><p>{r.labels.outcome_note}</p></li>)}</ol></details></li>)}</ul></details>}
  </section>;
}
