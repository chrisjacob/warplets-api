// Pinned saved live references, actual renderer. No provider/API collection.
import {useLayoutEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {TokenImage} from "../../app/src/discovery/TokenArtwork";
import type {ArtworkCoverageEntry} from "../discovery-artwork-coverage";

const entries:ArtworkCoverageEntry[]=await (await fetch('/cohort.json',{cache:'no-store'})).json();
const attempts=new Map<string,Set<string>>();
const lab={ready:false,page:0,setPage:(_page:number)=>{},snapshot:()=>entries.slice(lab.page*12,(lab.page+1)*12).map(entry=>{
  const card=document.querySelector(`[data-mint="${entry.address}"]`),frame=card?.querySelector<HTMLElement>('[data-artwork-state]'),img=frame?.querySelector('img'),rect=frame?.getBoundingClientRect();
  const state=frame?.dataset.artworkState??'loading';
  return {address:entry.address,visible:!!rect&&rect.width>0&&rect.height>0&&rect.top>=0&&rect.bottom<=innerHeight&&rect.left>=0&&rect.right<=innerWidth,frame_width:rect?.width??0,frame_height:rect?.height??0,state,attempted_sources:[...(attempts.get(entry.address)??[])],loaded_source:state==='loaded'?img?.src??null:null,natural_width:img?.naturalWidth??0,natural_height:img?.naturalHeight??0};
})};
Object.assign(window,{artworkCoverage:lab});
function Lab(){
  const [page,setPage]=useState(0);lab.setPage=setPage;
  useLayoutEffect(()=>{
    const record=()=>{for(const img of document.querySelectorAll<HTMLImageElement>('[data-mint] img')){const address=img.closest<HTMLElement>('[data-mint]')!.dataset.mint!,sources=attempts.get(address)??new Set<string>();sources.add(img.src);attempts.set(address,sources);}};
    record();const observer=new MutationObserver(record);observer.observe(document.getElementById('gallery')!,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});lab.page=page;lab.ready=true;
    return()=>observer.disconnect();
  },[page]);
  return <main className="tenx-discovery tenx-discovery--browse"><h1>Saved live artwork coverage</h1><p>Rendering references only. Images do not establish authenticity, organic demand or safety.</p><div id="gallery" className="tenx-ranked-cards">{entries.slice(page*12,(page+1)*12).map(e=><article className="tenx-candidate" key={e.address} data-mint={e.address}><div className="tenx-candidate-heading"><TokenImage name={e.name} symbol={e.symbol} url={e.market_url} metadataUrl={e.metadata_url}/><h2>{e.name}</h2></div><small className="tenx-address">{e.address}</small></article>)}</div></main>;
}
createRoot(document.getElementById('root')!).render(<Lab/>);
