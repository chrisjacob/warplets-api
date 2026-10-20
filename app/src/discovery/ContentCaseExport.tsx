import {useEffect,useRef,useState} from "react";
import {z} from "zod";
import {ContentCaseExport,CONTENT_EXPORT_MAX_BYTES} from "../../../discovery/src/content-export-model";
import {contentApi as api} from "./contentApi";
type CaseExport=z.infer<typeof ContentCaseExport>;

export function ContentCaseExportSummary({data}:{data:CaseExport}){
  return <div><p>Submission <code>{data.content.snapshot.id}</code> · captured {new Date(data.captured_at).toLocaleString()}.</p>
    <p>{data.manifest.events} verified history events · {data.manifest.reports} private reports · {data.manifest.hold_reviews} contributor follow-ups.</p>
    {data.version==="content-case-export-v2"&&<p>{data.manifest.authorship_events} manual authorship history events. Authorship and reward qualification remain separate from visibility.</p>}
    <p>Featuring hold: {data.visibility_held?"active":"none at capture"}. Closing a follow-up does not release an upheld report.</p>
    <p className="tenx-muted">Checksum <code className="tenx-content-url">{data.export_hash}</code>. Keep a separate copy to check the original artifact later. Checksums verify retained history consistency; they are not signatures, proof of authorship or proof an allegation is true.</p></div>;
}
export function ContentCaseExportPanel({token}:{token:string}){
  const [id,setId]=useState(""),[data,setData]=useState<CaseExport|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loadedToken,setLoadedToken]=useState<string|null>(null);
  const epoch=useRef(0),currentToken=useRef(token),controller=useRef<AbortController|null>(null);currentToken.current=token;
  useEffect(()=>{if(window.location.hash==="#content-case-export")document.getElementById("content-case-export")?.scrollIntoView();},[]);
  useEffect(()=>{epoch.current++;controller.current?.abort();setData(null);setLoadedToken(null);setError("");setBusy(false);return()=>{epoch.current++;controller.current?.abort();};},[token]);
  async function load(){
    if(!token||!z.uuid().safeParse(id).success)return;
    controller.current?.abort();controller.current=new AbortController();const signal=controller.current.signal,version=++epoch.current;
    setBusy(true);setError("");setData(null);setLoadedToken(null);
    try{
      const value=ContentCaseExport.parse(await api(`admin/attention/submissions/${encodeURIComponent(id)}/export`,{token,signal}));
      if(value.content.snapshot.id!==id)throw Error("Case identity mismatch");
      const text=JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>CONTENT_EXPORT_MAX_BYTES)throw Error("Case exceeds export size bound");
      const {export_hash,...payload}=value,bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload)));
      if([...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("")!==export_hash)throw Error("Case checksum mismatch");
      if(version===epoch.current&&currentToken.current===token){setData(value);setLoadedToken(token);}
    }catch(e){if(!signal.aborted&&version===epoch.current&&currentToken.current===token)setError(e instanceof Error?e.message:"Case export unavailable");}
    finally{if(version===epoch.current&&currentToken.current===token)setBusy(false);}
  }
  function download(){
    if(!data||!token||loadedToken!==token)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"})),link=document.createElement("a");
    link.href=url;link.download=`10x-private-case-${data.content.snapshot.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section id="content-case-export" className="tenx-panel tenx-content-form"><h2>Private moderation case export</h2>
    <p>Download one submission with its campaign, review history, reports and contributor follow-ups. Includes confidential reporter identities, allegations and private notes. Store and share the file carefully. Nothing is uploaded or downloaded automatically.</p>
    <p className="tenx-muted">Local records only; zero provider requests. At most 10 reports, 20 follow-ups and 1 MiB per case. Larger cases fail explicitly. Exporting does not delete, publish, release holds or grant rewards. Automated archival and retention policies remain unconfigured.</p>
    <label>Submission UUID<input value={id} disabled={!token||busy} onChange={e=>{setId(e.target.value.trim());setData(null);setError("");}} placeholder="Paste a submission UUID from the review queue"/></label>
    <button className="tenx-button" disabled={!token||busy||!z.uuid().safeParse(id).success} onClick={()=>void load()}>Verify private case</button>
    {!token&&<p>Enter the operator token to export a private case.</p>}{token&&busy&&<p role="status">Verifying retained case history…</p>}{token&&error&&<p role="alert">{error}</p>}
    {token&&loadedToken===token&&data&&<><ContentCaseExportSummary data={data}/><button className="tenx-button" onClick={download}>Download confidential JSON</button></>}
  </section>;
}
