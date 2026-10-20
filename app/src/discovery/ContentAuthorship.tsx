import {useEffect,useRef,useState} from "react";
import {z} from "zod";
import {AuthorshipHistory,AuthorshipSummary,AuthorshipEvent} from "../../../discovery/src/content-authorship-model";
import {ContentRecord} from "../../../discovery/src/content-model";
import {contentApi as api} from "./contentApi";
type History=z.infer<typeof AuthorshipHistory>;
type Summary=z.infer<typeof AuthorshipSummary>;
export function AuthorshipLabel({data}:{data:Summary}){
  return <p className="tenx-notice">{data.status==="MANUAL_REVIEWED"?"Author claim reviewed manually":data.status==="WITHDRAWN"?"Manual author review withdrawn":"Author claim has no recorded manual review"}{data.reviewed_at&&<> · as of {new Date(data.reviewed_at).toLocaleString()}</>}. External account control remains unverified; rights are not certified. No reward credit.</p>;
}
export function ContentAuthorshipCheck({submissionId}:{submissionId:string}){
  const [data,setData]=useState<Summary|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),epoch=useRef(0);
  useEffect(()=>{epoch.current++;setData(null);setMessage("");setBusy(false);return()=>{epoch.current++;};},[submissionId]);
  async function check(){const version=++epoch.current;setBusy(true);setMessage("");setData(null);try{
    const value=AuthorshipSummary.parse(await api(`attention/authorship/${encodeURIComponent(submissionId)}`));
    if(value.submission_id!==submissionId)throw Error("Authorship target mismatch");if(version===epoch.current)setData(value);
  }catch{if(version===epoch.current)setMessage("Author review unavailable. The link may no longer be publicly featured; no authorship or reward qualification is assumed.");}finally{if(version===epoch.current)setBusy(false);}}
  return <div><button className="tenx-button" disabled={busy} onClick={()=>void check()}>Check recorded author review</button>{busy&&<p role="status">Checking local review…</p>}{message&&<p role="status">{message}</p>}{data?.submission_id===submissionId&&<AuthorshipLabel data={data}/>}</div>;
}
export function AuthorshipReviewEvent({event}:{event:z.infer<typeof AuthorshipEvent>}){
  return <li><strong>{event.decision==="MANUAL_REVIEWED"?"Manual source review":"Review withdrawn"} · revision {event.revision}</strong><p>{new Date(event.created_at).toLocaleString()} · {event.reason}</p>{event.evidence_url&&<a href={event.evidence_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open recorded source reference ↗</a>}<p className="tenx-muted">Author claim: {event.author_claim}. Manual operator assertion; not cryptographic account control or reward approval.</p></li>;
}
export function ContentAuthorshipPanel({token}:{token:string}){
  const [id,setId]=useState(""),[history,setHistory]=useState<History|null>(null),[target,setTarget]=useState<z.infer<typeof ContentRecord>|null>(null),[decision,setDecision]=useState<"MANUAL_REVIEWED"|"WITHDRAWN">("MANUAL_REVIEWED");
  const [reference,setReference]=useState(""),[reason,setReason]=useState(""),[checked,setChecked]=useState(false),[requestId,setRequestId]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [loadedToken,setLoadedToken]=useState<string|null>(null);
  const epoch=useRef(0),currentToken=useRef(token),controller=useRef<AbortController|null>(null);currentToken.current=token;
  useEffect(()=>{if(window.location.hash==="#content-authorship")document.getElementById("content-authorship")?.scrollIntoView();},[]);
  useEffect(()=>{epoch.current++;controller.current?.abort();setLoadedToken(null);setHistory(null);setTarget(null);setMessage("");setBusy(false);return()=>{epoch.current++;controller.current?.abort();};},[token]);
  const current=()=>history?.events.at(-1),currentRevision=()=>current()?.revision??-1;
  async function load(){
    if(!token||!z.uuid().safeParse(id).success)return;
    controller.current?.abort();controller.current=new AbortController();const signal=controller.current.signal,version=++epoch.current;setBusy(true);setMessage("");setLoadedToken(null);setHistory(null);setTarget(null);
    try{
      const [record,reviews]=await Promise.all([api(`admin/attention/submissions/${encodeURIComponent(id)}`,{token,signal}).then(v=>ContentRecord.parse(v)),api(`admin/attention/submissions/${encodeURIComponent(id)}/authorship`,{token,signal}).then(v=>AuthorshipHistory.parse(v))]);
      if(record.snapshot.id!==id||reviews.submission_id!==id)throw Error("Authorship target mismatch");
      if(version===epoch.current&&currentToken.current===token){setLoadedToken(token);setTarget(record);setHistory(reviews);setDecision(reviews.events.at(-1)?.decision==="MANUAL_REVIEWED"?"WITHDRAWN":"MANUAL_REVIEWED");setReference("");setReason("");setChecked(false);setRequestId(crypto.randomUUID());}
    }catch(e){if(!signal.aborted&&version===epoch.current&&currentToken.current===token)setMessage(e instanceof Error?e.message:"Authorship review unavailable");}
    finally{if(version===epoch.current&&currentToken.current===token)setBusy(false);}
  }
  async function save(){
    if(!token||loadedToken!==token||!history||!target)return;const version=++epoch.current;setBusy(true);setMessage("");
    try{
      await api("admin/attention/authorship/review",{token,body:{request_id:requestId,submission_id:history.submission_id,expected_revision:currentRevision(),decision,evidence_url:decision==="MANUAL_REVIEWED"?reference:null,reason,source_and_author_checked:decision==="MANUAL_REVIEWED"&&checked}});
      if(version===epoch.current&&currentToken.current===token){await load();setMessage("Authorship decision recorded. Visibility, report holds and reward eligibility are unchanged.");}
    }catch(e){if(version===epoch.current&&currentToken.current===token)setMessage(e instanceof Error?e.message:"Authorship review failed; retry the unchanged request or reload before a new decision");}
    finally{if(version===epoch.current&&currentToken.current===token)setBusy(false);}
  }
  const valid=reason.trim().length>=10&&(decision==="WITHDRAWN"||checked&&reference.trim().length>7);
  return <section id="content-authorship" className="tenx-panel tenx-content-form"><h2>Manual authorship review · private</h2>
    <p>Inspect the external source and claimed author before recording a manual review. Wallet ownership alone does not establish social authorship, permission or a unique human. References are not fetched or embedded.</p>
    <p className="tenx-muted">The public label identifies a manual operator review as of a recorded time. It exposes no private notes or evidence references. External account control, engagement and reward eligibility remain unverified. New manual reviews: at most 20 per UTC day. Withdrawal remains available when that quota is full; the final history slot is reserved for withdrawal.</p>
    <label>Authorship submission UUID<input disabled={!token||busy} value={id} onChange={e=>{setId(e.target.value.trim());setHistory(null);setTarget(null);setMessage("");}} placeholder="Paste a submission UUID from the private queue"/></label>
    <button className="tenx-button" disabled={!token||busy||!z.uuid().safeParse(id).success} onClick={()=>void load()}>Load private authorship history</button>
    {!token&&<p>Enter the operator token to review authorship.</p>}
    {token&&loadedToken===token&&target&&history&&<><p>Author claim: <strong>{target.snapshot.content.author_claim}</strong>. <a href={target.snapshot.content.canonical_url} target="_blank" rel="ugc nofollow noopener noreferrer" referrerPolicy="no-referrer">Inspect submitted source ↗</a></p><p>Latest recorded state: {current()?.decision??"UNVERIFIED"}. History revision {currentRevision()}. {target.visibility_held?"Featuring hold remains active.":"Ordinary visibility rules still apply."}</p>
      {history.events.length<10?<form onChange={()=>setRequestId(crypto.randomUUID())} onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy}><legend>{decision==="WITHDRAWN"?"Withdraw the manual author review":"Record a manual source review"}</legend>
        {decision==="MANUAL_REVIEWED"&&<><label>Source reference URL<input type="url" required maxLength={2048} value={reference} onChange={e=>setReference(e.target.value)}/></label><label><input type="checkbox" required checked={checked} onChange={e=>setChecked(e.target.checked)}/> I inspected the source and checked its relationship to this author claim.</label></>}
        <label>Private review explanation<textarea required minLength={10} maxLength={600} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="tenx-button" disabled={!valid}>{decision==="WITHDRAWN"?"Withdraw author review":"Record manual author review"}</button></fieldset></form>:<p>Bounded history is complete; the final review is withdrawn. New review requires a future reviewed process.</p>}
      <details><summary>Verified private authorship history · {history.events.length} events</summary><ol>{history.events.map(event=><AuthorshipReviewEvent key={event.id} event={event}/>)}</ol></details></>}
    <p role="status">{busy?"Checking local authorship records…":message}</p>
  </section>;
}
