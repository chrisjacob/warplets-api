import {useEffect,useState} from "react";
import {ArtworkResponseSchema,type Artwork} from "../../../discovery/src/artwork-model";
import {getJson} from "./client";

export const ARTWORK_METADATA_TIMEOUT_MS=10000;
// One current 100-card page plus the existing 100-entry browser shortlist.
// The cache-only endpoint's 100-address limit is unchanged.
export function artworkBatches(addresses:string[]){
  const unique=[...new Set(addresses)].sort();
  if(unique.length>200)throw Error("artwork_view_size");
  const result:string[][]=[];for(let i=0;i<unique.length;i+=100)result.push(unique.slice(i,i+100));return result;
}
export function useTokenArtwork(addresses:string[]){
  const key=[...new Set(addresses)].sort().join(","),[artwork,setArtwork]=useState<Record<string,Artwork|null>>({});
  useEffect(()=>{
    const wanted=key?key.split(","):[],wantedSet=new Set(wanted);let disposed=false,active:AbortController|null=null,deadline:number|undefined;
    setArtwork(current=>Object.fromEntries(Object.entries(current).filter(([address])=>wantedSet.has(address))));
    if(!key)return;
    const load=async()=>{
      if(active||disposed)return;
      const controller=new AbortController();active=controller;
      const timeout=window.setTimeout(()=>controller.abort(),ARTWORK_METADATA_TIMEOUT_MS);
      deadline=timeout;
      try{
        await Promise.all(artworkBatches(wanted).map(async batch=>{
          try{
            const response=await getJson(`/api/10x/artwork?${new URLSearchParams({addresses:batch.join(",")})}`,ArtworkResponseSchema,controller.signal);
            if(!disposed&&!controller.signal.aborted)setArtwork(current=>({...current,...Object.fromEntries(batch.map(address=>[address,response.data[address]??null]))}));
          }catch{if(!disposed)setArtwork(current=>({...current,...Object.fromEntries(batch.map(address=>[address,current[address]??null]))}));}
        }));
      }catch{if(!disposed)setArtwork(current=>Object.fromEntries(wanted.map(address=>[address,current[address]??null])));}
      finally{window.clearTimeout(timeout);if(deadline===timeout)deadline=undefined;if(active===controller)active=null;}
    };
    void load();const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},60000);
    return()=>{disposed=true;active?.abort();if(deadline!==undefined)window.clearTimeout(deadline);window.clearInterval(timer);};
  },[key]);
  return artwork;
}
