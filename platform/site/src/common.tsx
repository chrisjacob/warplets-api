import {useExperience} from './experience';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PlatformApiError } from './sdk';

export const compact=(address:string)=>address.length>16?address.slice(0,6)+'…'+address.slice(-6):address;
export const percent=(bps:number|null)=>bps===null?'Unavailable':new Intl.NumberFormat('en-US').format(bps/100)+'%';
export const utc=(iso:string)=>new Date(iso).toISOString().slice(0,16).replace('T',' ')+' UTC';
export function dayDate(day:number){
  const date=new Date(day*86_400_000);
  return Number.isSafeInteger(day)&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en',{dateStyle:'medium',timeZone:'UTC'}).format(date):'Date unavailable';
}
export function sol(value:string|null){
  if(value===null)return 'Unavailable';
  const amount=BigInt(value);
  const fraction=(amount%1_000_000_000n).toString().padStart(9,'0').replace(/0+$/,'');
  return (amount/1_000_000_000n).toString()+(fraction?'.'+fraction:'')+' SOL';
}
export const pretty=(value:number)=>new Intl.NumberFormat('en-US').format(value);
export function usePageMeta(title:string,description:string,canonicalPath:string,publicPage=false){
  useEffect(()=>{
    document.title=title+' · 10X.MEME';
    const canonical=new URL(canonicalPath,location.origin).href;
    const entries:[string,string,string][]=[
      ['name','description',description],['name','robots',publicPage?'noindex, follow':'noindex, nofollow'],
      ['property','og:title',document.title],['property','og:description',description],
      ['property','og:url',canonical],['property','og:type','website'],['property','og:image',location.origin+'/social-card.png'],
      ['name','twitter:card','summary_large_image'],
    ];
    for(const [attribute,key,value] of entries){
      const tag=document.head.querySelector<HTMLMetaElement>('meta['+attribute+'="'+key+'"]')??document.createElement('meta');
      tag.setAttribute(attribute,key);tag.content=value;
      if(!tag.isConnected)document.head.appendChild(tag);
    }
    const link=document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')??document.createElement('link');
    link.rel='canonical';link.href=canonical;if(!link.isConnected)document.head.appendChild(link);
  },[title,description,canonicalPath,publicPage]);
}
export function friendlyError(err:unknown){
  if(err instanceof PlatformApiError)return err.message;
  if(err instanceof Error && err.name==='ZodError')return 'This response did not match the expected data format.';
  return err instanceof Error?err.message:'This request could not be completed.';
}
export function Hero({title,children}:{title:string;children:ReactNode}){
  return <header className="page-hero"><h1 id="page-title" tabIndex={-1}>{title}</h1><p>{children}</p></header>;
}
export function Panel({title,children,className='',technicalOnly=false}:{title?:ReactNode;children:ReactNode;className?:string;technicalOnly?:boolean}){
  const {technical}=useExperience();
  if(technicalOnly&&!technical)return null;
  return <section className={'panel '+className}>{title && <h2>{title}</h2>}{children}</section>;
}
export function Empty({title,children}:{title:string;children?:ReactNode}){
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function Signal({children}:{children:ReactNode}) {return <p className="notice" role="status">{children}</p>;}
export function Loaded<T>({query,children,restart}:{query:{data:T|undefined;isError:boolean;error:Error|null;refetch:()=>unknown;availability?:{allowed:boolean;pending:boolean;reason:string;refresh:()=>void}};children:(data:T)=>ReactNode;restart?:ReactNode}){
  if(query.availability && !query.availability.allowed)return <div role="status"><p>{query.availability.pending?'Checking runtime support...':query.availability.reason}</p>
    {!query.availability.pending&&<button onClick={query.availability.refresh}>Refresh runtime support</button>}</div>;
  if(query.isError)return <div><Signal>{friendlyError(query.error)}</Signal>{restart&&query.error instanceof PlatformApiError&&['stale_cursor','invalid_cursor'].includes(query.error.code)?restart:<button onClick={()=>void query.refetch()}>Retry</button>}</div>;
  if(query.data===undefined)return <p className="loading" role="status">Loading…</p>;
  return <>{children(query.data)}</>;
}
export function Metrics({items}:{items:Array<[string,string,string]>}){
  if(!useExperience().technical)return null;
  return <section className="metrics" aria-label="Program metrics">{items.map(([label,value,note])=>
    <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</section>;
}
export function Facts({items}:{items:Array<[string,ReactNode]>}){
  const {technical}=useExperience();
  const visible=technical?items:items.filter(([label])=>!/(digest|micro-USD|source|evidence|observed|verified action|purchase token-days|tenths)/i.test(label)&&!['ATT mint','OG mint','Original token mint','Pool','ID','Requested','Projection as of','Published','Accepted opening-cut digest'].includes(label));
  return <dl className="facts">{visible.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export function MobileRecords({entries}:{entries:{id:string;summary:ReactNode;facts:Array<[string,ReactNode]>}[]}){
  return <div className="mobile-records">{entries.map(entry=><details key={entry.id}><summary>{entry.summary}</summary>
    <Facts items={entry.facts}/></details>)}</div>;
}
export function ShareLink({path,title}:{path:string;title:string}){
  const [fallback,setFallback]=useState(false),[message,setMessage]=useState('');
  const url=new URL(path,location.origin).href;
  const share=async()=>{
    try {
      if(typeof navigator.share==='function'){await navigator.share({title,url});return;}
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);setMessage('Link copied.');return;}
    }catch(error){if(error instanceof Error && error.name==='AbortError')return;}
    setFallback(true);
  };
  return <div className="share"><button onClick={()=>void share()}>Share link</button><output aria-live="polite">{message}</output>
    {fallback&&<label>Public link<input readOnly value={url} onFocus={e=>e.target.select()}/></label>}</div>;
}
/** Keep keyboard readers at the first newly revealed item, including the final
 * batch where the reveal button disappears. No data or page limits change. */
export function RevealMore({children,items,shown,onReveal}:{children:ReactNode;items:string;shown:number;onReveal:()=>void}){
  return <button type="button" onClick={event=>{
    const region=event.currentTarget.closest('section');
    onReveal();
    requestAnimationFrame(()=>{
      const entry=[...region?.querySelectorAll<HTMLElement>(items)??[]].filter(node=>node.getClientRects().length>0)[shown];
      if(!entry?.isConnected)return;
      const target=entry.querySelector<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')??entry.querySelector<HTMLElement>('h3,h4,strong')??entry;
      if(!target.matches('a[href],button,input,select,summary')){target.tabIndex=-1;target.setAttribute('data-reveal-focus','');}
      target.focus();
    });
  }}>{children}</button>;
}
export function Modal({title,children,onClose,id}:{title:string;children:ReactNode;onClose:()=>void;id?:string}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current!;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog.showModal();
    return ()=>{dialog.close();opener?.focus();};
  },[]);
  return <dialog ref={ref} id={id} onCancel={e=>{e.preventDefault();onClose();}}
    aria-label={title}><div className="modal-head"><h2>{title}</h2>
    <button className="icon" onClick={onClose} aria-label={'Close '+title}>×</button></div>{children}</dialog>;
}
/** Persist the key across a reload until a successful acknowledgement. A failed
 * or uncertain response can be retried without preparing a duplicate operation.
 */
export function intentKey(wallet:string,action:string,body:unknown){
  const name='10x.preview.intent:'+JSON.stringify([wallet,action,body]);
  const key=sessionStorage.getItem(name)??crypto.randomUUID();
  sessionStorage.setItem(name,key);
  return {key,done:()=>sessionStorage.removeItem(name)};
}
/** Persist retry identity without retaining private appeal text in storage keys. */
export async function privateIntentKey(wallet:string,action:string,body:unknown){
  const identity=JSON.stringify([wallet,action,body]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  const name='10x.private-intent:'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const legacy='10x.preview.intent:'+identity;
  const key=sessionStorage.getItem(name)??sessionStorage.getItem(legacy)??crypto.randomUUID();
  sessionStorage.setItem(name,key);sessionStorage.removeItem(legacy);
  return {key,done:()=>sessionStorage.removeItem(name)};
}
