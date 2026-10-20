import {useEffect,useRef,useState} from "react";
import {z} from "zod";
import {DuplicateEvidence,DuplicateReport,DUPLICATE_MAX_BYTES} from "../../../discovery/src/content-duplicates-model";
import {contentApi as api} from "./contentApi";
type Evidence=z.infer<typeof DuplicateEvidence>;
type Report=z.infer<typeof DuplicateReport>;
export function DuplicateComparison({data}:{data:Report}){
  return <div style={{overflowWrap:"anywhere"}}><p>Captured {new Date(data.captured_at).toLocaleString()} · {data.coverage.compared} of {data.coverage.available_candidates} other active recorded excerpts compared; {data.coverage.omitted} omitted by the sample limit. External content coverage remains incomplete.</p>
    <p>{data.result.matching_candidates} excerpt matches meet the experimental 65% review threshold; {data.result.matches.length} shown. A zero-match result does not establish originality or approve content.</p>
    <ul>{data.gaps.map(gap=><li key={gap}>{gap}</li>)}</ul>
    <details><summary>Recorded subject excerpt · private</summary><p>{data.subject.events.at(-1)!.excerpt}</p></details>
    {data.result.matches.map(match=>{const candidate=data.candidates.find(c=>c.target.submission_id===match.submission_id)!;return <article key={match.submission_id} className="tenx-content-item"><h3>{match.kind==="EXACT_NORMALIZED_EXCERPT"?"Same normalized excerpt":"Similar excerpt"} · {(match.score_bps/100).toFixed(2)}%</h3><p>Submission <code>{match.submission_id}</code>. {match.shared_grams} shared / {match.union_grams} distinct combined character sequences.</p><a href={match.source_url} target="_blank" rel="ugc nofollow noopener noreferrer" referrerPolicy="no-referrer">Inspect comparison source ↗</a><p>{candidate.events.at(-1)!.excerpt}</p><p className="tenx-muted">Possible shared wording for manual review. Does not prove plagiarism, coordinated wallets or an invalid author claim.</p></article>;})}
    <p className="tenx-muted">Report checksum <code className="tenx-content-url">{data.report_hash}</code>. Retain it separately for offline checking. A checksum is not a signature or proof of complete external coverage.</p></div>;
}
export function ContentDuplicatesPanel({token}:{token:string}){
  const [id,setId]=useState(""),[evidence,setEvidence]=useState<Evidence|null>(null),[report,setReport]=useState<Report|null>(null),[loadedToken,setLoadedToken]=useState<string|null>(null);
  const [excerpt,setExcerpt]=useState(""),[reason,setReason]=useState(""),[inspected,setInspected]=useState(false),[requestId,setRequestId]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const epoch=useRef(0),currentToken=useRef(token),controller=useRef<AbortController|null>(null);currentToken.current=token;
  useEffect(()=>{if(window.location.hash==="#content-duplicates")document.getElementById("content-duplicates")?.scrollIntoView();},[]);
  useEffect(()=>{epoch.current++;controller.current?.abort();setLoadedToken(null);setEvidence(null);setReport(null);setMessage("");setBusy(false);return()=>{epoch.current++;controller.current?.abort();};},[token]);
  async function load(){
    if(!token||!z.uuid().safeParse(id).success)return;
    controller.current?.abort();controller.current=new AbortController();const signal=controller.current.signal,version=++epoch.current;
    setBusy(true);setMessage("");setEvidence(null);setReport(null);setLoadedToken(null);
    try{
      const value=DuplicateEvidence.parse(await api(`admin/attention/submissions/${encodeURIComponent(id)}/duplicate-evidence`,{token,signal}));
      if(value.target.submission_id!==id)throw Error("Excerpt evidence target mismatch");
      if(version===epoch.current&&currentToken.current===token){setEvidence(value);setLoadedToken(token);setExcerpt("");setReason("");setInspected(false);setRequestId(crypto.randomUUID());}
    }catch(e){if(!signal.aborted&&version===epoch.current&&currentToken.current===token)setMessage(e instanceof Error?e.message:"Excerpt evidence unavailable");}
    finally{if(version===epoch.current&&currentToken.current===token)setBusy(false);}
  }
  const active=evidence?.events.at(-1)?.action==="RECORD";
  async function save(){
    if(!token||loadedToken!==token||!evidence)return;const version=++epoch.current;setBusy(true);setMessage("");setReport(null);
    try{
      await api("admin/attention/duplicate-evidence",{token,body:{request_id:requestId,submission_id:evidence.target.submission_id,expected_revision:evidence.events.at(-1)?.revision??-1,action:active?"WITHDRAW":"RECORD",excerpt:active?null:excerpt,source_inspected:!active&&inspected,reason}});
      if(version===epoch.current&&currentToken.current===token){await load();if(currentToken.current===token)setMessage("Excerpt evidence recorded. Moderation, authorship, report holds and rewards are unchanged.");}
    }catch(e){if(version===epoch.current&&currentToken.current===token)setMessage(e instanceof Error?e.message:"Evidence save failed; retry unchanged or reload before a new decision");}
    finally{if(version===epoch.current&&currentToken.current===token)setBusy(false);}
  }
  async function compare(){
    if(!token||loadedToken!==token||!evidence||!active)return;const version=++epoch.current;setBusy(true);setMessage("");setReport(null);
    controller.current?.abort();controller.current=new AbortController();const signal=controller.current.signal;
    try{
      const value=DuplicateReport.parse(await api(`admin/attention/submissions/${encodeURIComponent(evidence.target.submission_id)}/duplicates`,{token,signal}));
      if(value.subject.target.submission_id!==id)throw Error("Comparison target mismatch");
      if(new TextEncoder().encode(JSON.stringify(value)).byteLength>DUPLICATE_MAX_BYTES)throw Error("Comparison exceeds size bound");
      const {report_hash,...payload}=value,bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload)));
      if([...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("")!==report_hash)throw Error("Comparison checksum mismatch");
      if(version===epoch.current&&currentToken.current===token)setReport(value);
    }catch(e){if(!signal.aborted&&version===epoch.current&&currentToken.current===token)setMessage(e instanceof Error?e.message:"Comparison unavailable");}
    finally{if(version===epoch.current&&currentToken.current===token)setBusy(false);}
  }
  function download(){if(!report||!token||loadedToken!==token)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download=`10x-private-excerpt-comparison-${report.subject.target.submission_id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section id="content-duplicates" className="tenx-panel tenx-content-form" style={{overflowWrap:"anywhere"}}><h2>Near-duplicate excerpt evidence · private</h2>
    <p>Record a short excerpt you inspected at the submitted source, then compare it with other recorded excerpts. Author claims and submission commentary are not treated as source content. Text is compared locally; no social API, scraping or media fetch occurs.</p>
    <p className="tenx-muted">Private review evidence only. Shared wording is not a plagiarism verdict. Image, video and audio similarity remain unavailable. At most 50 other active excerpts across campaigns are sampled; omitted and unobserved content stay unknown. This feature never rejects content, releases holds or grants rewards.</p>
    <label>Excerpt submission UUID<input disabled={!token||busy} value={id} onChange={e=>{setId(e.target.value.trim());setEvidence(null);setReport(null);setLoadedToken(null);setMessage("");}} placeholder="Paste a submission UUID from the private queue"/></label>
    <button className="tenx-button" disabled={!token||busy||!z.uuid().safeParse(id).success} onClick={()=>void load()}>Load private excerpt evidence</button>
    {!token&&<p>Enter the operator token to view or record private excerpts.</p>}
    {token&&loadedToken===token&&evidence&&<><p><a href={evidence.target.source_url} target="_blank" rel="ugc nofollow noopener noreferrer" referrerPolicy="no-referrer">Inspect submitted source ↗</a> · {active?"An excerpt is active":"No active excerpt"} · {evidence.events.length} retained events.</p>
      {evidence.events.length<6?<form onChange={()=>setRequestId(crypto.randomUUID())} onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy}><legend>{active?"Withdraw the active excerpt":"Record an inspected source excerpt"}</legend>{!active&&<><label>Short source excerpt<textarea required minLength={60} maxLength={600} value={excerpt} onChange={e=>setExcerpt(e.target.value)}/></label><p>Use only a relevant short excerpt you may retain for review. Do not paste a full work, personal information or credentials. Boilerplate and very short/repetitive samples cannot support this comparison.</p><label><input type="checkbox" required checked={inspected} onChange={e=>setInspected(e.target.checked)}/> I inspected this excerpt at the submitted source.</label></>}<label>Private evidence explanation<textarea required minLength={10} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="tenx-button" disabled={reason.trim().length<10||!active&&(!inspected||excerpt.trim().length<60)}>{active?"Withdraw excerpt evidence":"Record excerpt evidence"}</button></fieldset></form>:<p>This bounded history is complete. The final excerpt remains withdrawn.</p>}
      <p className="tenx-muted">At most 20 new excerpts per UTC day. Withdrawal remains available when the quota is full. Six events per submission; the final slot is reserved for withdrawal.</p>
      <button className="tenx-button" disabled={busy||!active} onClick={()=>void compare()}>Compare recorded excerpts</button>
      <details><summary>Private excerpt history</summary><ol>{evidence.events.map(event=><li key={event.id}><strong>{event.action} · revision {event.revision}</strong><p>{new Date(event.created_at).toLocaleString()} · {event.reason}</p>{event.excerpt&&<p>{event.excerpt}</p>}</li>)}</ol></details>
      {report&&<><DuplicateComparison data={report}/><p className="tenx-muted">The JSON includes every sampled excerpt and its private evidence history, including candidates below the review threshold. Download stays local; share carefully.</p><button className="tenx-button" onClick={download}>Download confidential comparison JSON</button></>}
    </>}
    <p role="status">{busy?"Checking local excerpt evidence…":message}</p>
  </section>;
}
