import { useEffect, useState } from "react";
import { selectNews, validNewsItem, type NewsItem, type NewsResponse } from "../shared/stonkletsNews";
const cache=new Map<string,{items:NewsItem[];at:number}>(), listeners=new Map<string,Set<()=>void>>();
let timer:number|undefined,debounce:number|undefined,running=false,queued=false;
const visible=()=>{if(!document.hidden)void refresh();};
async function refresh(){
 if(document.hidden)return;if(running){queued=true;return;}running=true;
 try{
 const keys=[...listeners.keys()].filter(key=>Date.now()-(cache.get(key)?.at??0)>55000);
 const groups:string[][]=[];if(keys.includes("hero"))groups.push(["hero"]);
 const pairs=keys.filter(key=>key!=="hero");for(let i=0;i<pairs.length;i+=20)groups.push(pairs.slice(i,i+20));
 for(const group of groups){try{
 const response=await fetch(`/api/stonklets/news${group[0]==="hero"?"":`?pairs=${group.map(encodeURIComponent).join(",")}`}`,{signal:AbortSignal.timeout(10000)});if(!response.ok)continue;
 const result=await response.json() as NewsResponse;
 for(const key of group){const items=key==="hero"?result.entries:result.byPair?.[key];if(!Array.isArray(items))continue;cache.set(key,{items:items.filter(validNewsItem),at:Date.now()});listeners.get(key)?.forEach(fn=>fn());}
 }catch{/* Keep cached news through outages. Expired items are filtered at display time. */}}
 }finally{running=false;if(queued){queued=false;window.clearTimeout(debounce);debounce=window.setTimeout(()=>void refresh(),40);}}
}
export function useStonkletNews(pairId:string|undefined,enabled:boolean):NewsItem[]{
 const key=pairId??"hero";const [,changed]=useState(0);
 useEffect(()=>{
 if(!enabled)return;const notify=()=>changed(value=>value+1);const group=listeners.get(key)??new Set();group.add(notify);listeners.set(key,group);
 window.clearTimeout(debounce);debounce=window.setTimeout(()=>void refresh(),40);
 if(timer===undefined){timer=window.setInterval(()=>{listeners.forEach(group=>group.forEach(fn=>fn()));void refresh();},60000);document.addEventListener("visibilitychange",visible);}
 notify();
 return()=>{group.delete(notify);if(!group.size)listeners.delete(key);if(!listeners.size){window.clearInterval(timer);timer=undefined;window.clearTimeout(debounce);document.removeEventListener("visibilitychange",visible);}};
 },[key,enabled]);
 return selectNews(cache.get(key)?.items??[],pairId);
}
