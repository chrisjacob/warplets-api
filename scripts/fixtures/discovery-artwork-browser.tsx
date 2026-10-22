// Synthetic component lab only. Never imported by the application entry point.
import {useState} from "react";
import {createRoot} from "react-dom/client";
import {TokenImage} from "../../app/src/discovery/TokenArtwork";
import {useTokenArtwork} from "../../app/src/discovery/token-artwork-client";
import {ShortlistPanel} from "../../app/src/discovery/Shortlist";
import {DiscoveryTable} from "../../app/src/discovery/DiscoveryWorkspace";
import {fixtureCandidates} from "../../discovery/src/fixtures";
import {toBase58} from "../../discovery/src/solana";
import {assess,DEFAULT_POLICY} from "../../discovery/src/model";
import {candidateCard} from "../../discovery/src/candidate-card";
import type {ShortlistState} from "../../app/src/discovery/shortlist-store";

const origin="https://cdn.dexscreener.com/",at=new Date("2026-10-22T01:00:00Z"),sample=(await fixtureCandidates(at))[0]!;
const mint=(i:number)=>{const b=new Uint8Array(32).fill(6);new DataView(b.buffer).setUint32(0,i);return toBase58(b);};
const addresses=Array.from({length:200},(_,i)=>mint(i+1)),saved=addresses.at(-1)!;
function MetadataLab(){
  const [selection,setSelection]=useState(addresses),[opened,setOpened]=useState(false),artwork=useTokenArtwork(selection);
  const state:ShortlistState={mode:"live",status:"saved",message:"",entries:[{address:selection.at(-1)!,name:"Saved outside results",symbol:"SAVE",chain:"solana",mode:"live",saved_at:at.toISOString()}]};
  return <section id="metadata"><h2>Saved artwork · synthetic cache</h2><button id="metadata-switch" onClick={()=>setSelection([mint(300)])}>Change current selection</button><button id="metadata-prune" onClick={()=>setSelection(v=>v.slice(0,-1))}>Retain existing selection</button>
    <output id="metadata-state">{JSON.stringify(Object.fromEntries(selection.map(a=>[a,artwork[a]===undefined?"pending":artwork[a]?.image_url??"missing"])))}</output>
    <span id="saved-open-state" data-open={opened}/><ShortlistPanel state={state} candidates={[]} artwork={artwork} selected={[]} onRemove={()=>{}} onClear={()=>{}} onCompare={()=>{}} onOpenChange={setOpened}/>
  </section>;
}
function Lab(){
  const [reset,setReset]=useState(false),[metadataVersion,setMetadataVersion]=useState(0);
  const c={...candidateCard(assess(sample,DEFAULT_POLICY,at)),name:"Table artwork",market:sample.market?{...sample.market,image_url:origin+"good.svg"}:null};
  return <main className="tenx-discovery tenx-discovery--browse"><h1>Synthetic artwork acceptance</h1><p>Component checks only. No real token evidence, provider collection or scoring acceptance.</p>
    <div className="artwork-cases">{[
      {id:"good",url:origin+"good.svg"},{id:"fallback",url:origin+"broken.png",metadataUrl:origin+"fallback.svg"},
      {id:"all-broken",url:origin+"broken-a.png",metadataUrl:origin+"broken-b.png"},{id:"invalid-data",url:origin+"invalid.png",metadataUrl:origin+"fallback.svg"},{id:"stalled",url:origin+"stall.png",metadataUrl:origin+"fallback.svg"},
      {id:"late-decode",url:origin+"late-decode.svg",metadataUrl:origin+"fallback.svg"},{id:"missing"},
      {id:"large",url:origin+"good.svg",large:true},{id:"unsafe",url:"http://127.0.0.1/private.png",metadataUrl:"data:image/png;base64,AA=="}
    ].map(item=><section key={item.id} id={item.id}><h2>{item.id}</h2><TokenImage {...item} name={item.id} symbol="QA"/></section>)}
    <section id="reset"><h2>Updated source reference</h2><button id="image-reset" onClick={()=>setReset(v=>!v)}>Use new saved image</button><TokenImage name="reset" symbol="RS" url={origin+(reset?"good.svg":"broken-reset.png")}/></section></div>
    <button id="metadata-reload" onClick={()=>setMetadataVersion(n=>n+1)}>Remount cache fixture</button><MetadataLab key={metadataVersion}/>
    <DiscoveryTable candidates={[c]} artwork={{}} scoredAt={at.toISOString()}/>
    <section id="offscreen" style={{marginTop:2400}}><h2>Initially off screen</h2><TokenImage name="offscreen" symbol="OF" url={origin+"offscreen-stall.png"} metadataUrl={origin+"fallback.svg"}/></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Lab/>);
document.documentElement.dataset.labReady="true";
export {saved};
