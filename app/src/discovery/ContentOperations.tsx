import {useEffect,useRef,useState} from "react";
import {z} from "zod";
import {ContentOperations} from "../../../discovery/src/content-operations-model";
import {contentApi as api} from "./contentApi";
type Operations=z.infer<typeof ContentOperations>;
const queueLabels={pending:"Pending content",flagged:"Flagged content",appealed:"Content appeals",open_reports:"Unreviewed reports",open_hold_reviews:"New hold reviews",resubmitted_hold_reviews:"Contributor responses",contributor_response:"Awaiting contributor"};
const quotaLabels={open_campaigns:"Occupied campaign slots",campaigns:"New campaigns",submissions:"New submissions",content_events:"Content history events",reports:"New reports",report_events:"Report history events",hold_reviews:"New hold review requests",hold_events:"Hold review history events"};
const links={pending:"#content-review",flagged:"#content-review",appealed:"#content-review",open_reports:"#report-review",open_hold_reviews:"#hold-review",resubmitted_hold_reviews:"#hold-review",contributor_response:"#hold-review"};
const bytes=(value:number)=>value<1024?`${value} B`:`${(value/1024).toFixed(1)} KiB`;
function wait(seconds:number|null){if(seconds===null)return "—";if(seconds<3600)return `${Math.floor(seconds/60)}m`;if(seconds<86400)return `${Math.floor(seconds/3600)}h`;return `${Math.floor(seconds/86400)}d ${Math.floor(seconds%86400/3600)}h`;}

export function ContentOperationsSummary({data}:{data:Operations}){
  return <><p className="tenx-muted">Observed {new Date(data.as_of).toLocaleString()}. Projection counts only; individual histories must still be verified before a decision.</p>
    <div className="tenx-table-scroll"><table><caption>Work awaiting action · age since the last state change</caption><thead><tr><th scope="col">Queue</th><th scope="col">Waiting on</th><th scope="col">Items</th><th scope="col">At least 24h</th><th scope="col">Oldest wait</th></tr></thead><tbody>{data.queues.map(q=><tr key={q.id}><th scope="row"><a href={links[q.id]}>{queueLabels[q.id]}</a></th><td>{q.waiting_on}</td><td>{q.count}</td><td>{q.waiting_24h}</td><td title={q.oldest_updated_at??undefined}>{wait(q.oldest_wait_seconds)}</td></tr>)}</tbody></table></div>
    <p>{data.holds.upheld_reports} upheld report holds across {data.holds.held_submissions} submissions; {data.holds.visible_but_held} would otherwise be visible. A held submission can have several independent holds. Counts do not certify complaint validity.</p>
    <p>Manual author reviews today: {data.authorship.manual_reviews_today} / {data.authorship.manual_review_limit}; {data.authorship.remaining} new-review slots remain until the UTC reset. {data.authorship.withdrawals_today} withdrawals recorded. Withdrawal does not consume the new-review quota; each submission still has a bounded history.</p>
    <div className="tenx-table-scroll"><table><caption>Local global limits · UTC day ending {new Date(data.day_end).toLocaleString()}</caption><thead><tr><th scope="col">Resource</th><th scope="col">Used / limit</th><th scope="col">Remaining</th></tr></thead><tbody>{data.quotas.map(q=><tr key={q.id}><th scope="row">{quotaLabels[q.id]}</th><td>{q.used} / {q.limit}</td><td>{q.remaining}{q.remaining===0?" · full":""}{q.resets_at===null?" · frees as campaigns end":""}</td></tr>)}</tbody></table></div>
    <p>Each new submission, report or hold review also needs a history-event slot. Remaining capacity is an observation, not a reservation. Signed identities are additionally limited to {data.identity_daily_limits.submissions} submissions, {data.identity_daily_limits.reports} reports and {data.identity_daily_limits.hold_reviews} new hold review requests per UTC day. Sessions, campaign windows, target limits, duplicate checks and evidence gates still apply.</p>
    <details><summary>Stored-data sample & retention gaps</summary><p>At most {data.storage.sample_limit} newest rows per table are measured. These are serialized payload bytes only, excluding indexes, row metadata and database overhead. No full-size extrapolation or remote D1 billing estimate is made.</p><div className="tenx-table-scroll"><table><caption>Local retained records · source messages stay private</caption><thead><tr><th scope="col">Records</th><th scope="col">Total rows</th><th scope="col">Measured rows</th><th scope="col">Payload bytes</th><th scope="col">Coverage</th></tr></thead><tbody>{data.storage.tables.map(t=><tr key={t.id}><th scope="row">{t.id.replaceAll("_"," ")}</th><td>{t.total_rows}</td><td>{t.sampled_rows}</td><td>{bytes(t.sampled_bytes)}</td><td>{t.complete?"All current payloads":"Newest 200 only"}</td></tr>)}</tbody></table></div><p>Automatic deletion is off. No archival policy is configured. Immutable content, complaint and conversation histories are retained; this panel cannot delete or release anything. Remote capacity, retention rules and moderation staffing remain unverified.</p></details>
  </>;
}

export function ContentOperationsPanel({token}:{token:string}){
  const [data,setData]=useState<Operations|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),epoch=useRef(0),currentToken=useRef(token);currentToken.current=token;
  const [version,setVersion]=useState(0),[loadedToken,setLoadedToken]=useState<string|null>(null);
  useEffect(()=>{if(window.location.hash==="#content-operations")document.getElementById("content-operations")?.scrollIntoView();},[]);
  useEffect(()=>{
    setData(null);setLoadedToken(null);setError("");setBusy(false);if(!token)return;
    let controller:AbortController|undefined;
    async function refresh(){controller?.abort();controller=new AbortController();const signal=controller.signal,current=++epoch.current;setBusy(true);try{
      const value=ContentOperations.parse(await api("admin/attention/operations",{token,signal}));
      if(current===epoch.current&&currentToken.current===token){setData(value);setLoadedToken(token);setError("");}
    }catch(e){if(!signal.aborted&&current===epoch.current&&currentToken.current===token){setData(null);setLoadedToken(null);setError(e instanceof Error?e.message:"Content operations unavailable");}}
    finally{if(current===epoch.current&&currentToken.current===token)setBusy(false);}}
    void refresh();const focus=()=>void refresh();window.addEventListener("focus",focus);const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void refresh();},60000);
    return()=>{epoch.current++;controller?.abort();window.clearInterval(timer);window.removeEventListener("focus",focus);};
  },[token,version]);
  return <section className="tenx-panel tenx-content-form" id="content-operations"><h2>Content operations · private</h2><p>Review backlog, daily limits and a bounded storage sample. This view uses local data only and makes no moderation, eligibility or reward decisions.</p><button className="tenx-button" disabled={!token||busy} onClick={()=>setVersion(v=>v+1)}>Refresh content operations</button>{!token&&<p>Enter the operator token to view private capacity counts.</p>}{token&&error&&<p role="alert">{error}</p>}{busy&&<p role="status">Reading local capacity…</p>}{token&&loadedToken===token&&data&&<ContentOperationsSummary data={data}/>}</section>;
}
