import {discoveryView,discoveryViewParams} from "./discovery-view";

type Mode="live"|"fixture";
type Section="saved-tokens"|"compare-tokens";
// Navigation hints only: reconstruct the known Discovery query, never redirect
// to an arbitrary destination or carry API cursors/credentials into token URLs.
export function discoveryReturnTo(value:string|null|undefined,mode:Mode,section?:Section):string{
  let search="",hash="";
  if(value&&value.length<=4096&&value.startsWith("/")&&!value.startsWith("//")&&!/[\\\u0000-\u0020]/.test(value)){
    try{
      const url=new URL(value,"https://local.invalid");
      if(url.origin==="https://local.invalid"&&url.pathname==="/discover"){
        search=url.search;
        if(["#saved-tokens","#compare-tokens"].includes(url.hash))hash=url.hash;
      }
    }catch{/* Use the known Discovery defaults. */}
  }
  const view={...discoveryView(search),mode};
  return `/discover?${discoveryViewParams(view)}${section?"#"+section:hash}`;
}
export function tokenInspectHref(address:string,mode:Mode,returnTo?:string){
  const p=new URLSearchParams();
  if(mode==="fixture")p.set("mode",mode);
  if(returnTo)p.set("returnTo",discoveryReturnTo(returnTo,mode));
  return `/token/solana/${encodeURIComponent(address)}${p.size?"?"+p:""}`;
}
export function tokenDiscoveryReturn(search:string,mode:Mode,section?:Section){
  return discoveryReturnTo(new URLSearchParams(search).get("returnTo"),mode,section);
}
