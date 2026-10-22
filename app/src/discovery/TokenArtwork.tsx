import {useEffect,useRef,useState} from "react";
import {tokenImageSources} from "../../../discovery/src/images";

export const ARTWORK_IMAGE_TIMEOUT_MS=8000;
export function TokenImage({url,metadataUrl,name,symbol,large=false,metadataLoading=false}:{url?:string|null;metadataUrl?:string|null;name:string;symbol:string;large?:boolean;metadataLoading?:boolean}){
  const sources=tokenImageSources(url,metadataUrl);
  return <ArtworkImage key={JSON.stringify(sources)} sources={sources} name={name} symbol={symbol} large={large} metadataLoading={metadataLoading}/>;
}
function ArtworkImage({sources,name,symbol,large,metadataLoading}:{sources:string[];name:string;symbol:string;large:boolean;metadataLoading:boolean}){
  const [attempt,setAttempt]=useState({index:0,loaded:false}),[nearby,setNearby]=useState(large),frame=useRef<HTMLSpanElement>(null),image=useRef<HTMLImageElement>(null);
  const src=sources[attempt.index],size=large?144:88;
  const fail=()=>setAttempt(current=>current.index===attempt.index&&!current.loaded?{index:current.index+1,loaded:false}:current);
  const decode=(element:HTMLImageElement)=>{
    if(!element.naturalWidth||!element.naturalHeight){fail();return;}
    const ready=typeof element.decode==="function"?element.decode():Promise.resolve();
    void ready.then(()=>setAttempt(current=>current.index===attempt.index&&!current.loaded?{...current,loaded:true}:current),fail);
  };
  useEffect(()=>{
    if(nearby)return;
    if(typeof IntersectionObserver==="undefined"){setNearby(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setNearby(true);observer.disconnect();}},{rootMargin:"160px"});
    if(frame.current)observer.observe(frame.current);return()=>observer.disconnect();
  },[nearby]);
  useEffect(()=>{
    if(!src||attempt.loaded||!nearby)return;
    // Lazy off-screen images get no deadline until they approach the viewport.
    const timer=window.setTimeout(fail,ARTWORK_IMAGE_TIMEOUT_MS),element=image.current;
    if(element?.complete)decode(element);
    return()=>window.clearTimeout(timer);
    // The keyed source set and attempt index bind late load/error/decode events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[src,attempt.index,attempt.loaded,nearby]);
  const state=src?(attempt.loaded?"loaded":"loading"):metadataLoading?"loading":"unavailable";
  return <span ref={frame} className={`tenx-token-image tenx-artwork-frame${large?" tenx-token-image--large":""}`} role="img" aria-label={`${name}: ${state==="loaded"?"token artwork":state==="loading"?"artwork loading":"image unavailable"}`} data-artwork-state={state}>
    {src&&<img key={src} ref={image} className="tenx-artwork-bitmap" src={src} alt="" aria-hidden="true" width={size} height={size} loading={large?"eager":"lazy"} decoding="async" referrerPolicy="no-referrer" style={{opacity:attempt.loaded?1:0}} onLoad={event=>decode(event.currentTarget)} onError={fail}/>}
    {state!=="loaded"&&<span className="tenx-artwork-placeholder" aria-hidden="true"><span>{symbol.slice(0,2)}</span><small>{state==="loading"?"Loading artwork…":"Image unavailable"}</small></span>}
  </span>;
}
