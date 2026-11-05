import { useEffect, useRef, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { PlatformApiError } from './sdk';

export const compact=(address:string)=>address.length>16?address.slice(0,6)+'…'+address.slice(-6):address;
export const percent=(bps:number|null)=>bps===null?'Unavailable':new Intl.NumberFormat('en-US').format(bps/100)+'%';
export const utc=(iso:string)=>new Date(iso).toISOString().slice(0,16).replace('T',' ')+' UTC';
export function sol(value:string|null){
  if(value===null)return 'Unavailable';
  const amount=BigInt(value);
  const fraction=(amount%1_000_000_000n).toString().padStart(9,'0').replace(/0+$/,'');
  return (amount/1_000_000_000n).toString()+(fraction?'.'+fraction:'')+' SOL';
}
export const pretty=(value:number)=>new Intl.NumberFormat('en-US').format(value);
export function friendlyError(err:unknown){
  if(err instanceof PlatformApiError)return err.message;
  if(err instanceof Error && err.name==='ZodError')return 'This response did not match the expected data format.';
  return err instanceof Error?err.message:'This request could not be completed.';
}
export function Hero({title,children}:{title:string;children:ReactNode}){
  return <header className="page-hero"><h1>{title}</h1><p>{children}</p></header>;
}
export function Panel({title,children,className=''}:{title?:ReactNode;children:ReactNode;className?:string}){
  return <section className={'panel '+className}>{title && <h2>{title}</h2>}{children}</section>;
}
export function Empty({title,children}:{title:string;children?:ReactNode}){
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function Signal({children}:{children:ReactNode}) {return <p className="notice" role="status">{children}</p>;}
export function Loaded<T>({query,children}:{query:UseQueryResult<T,Error>;children:(data:T)=>ReactNode}){
  if(query.isError)return <div><Signal>{friendlyError(query.error)}</Signal><button onClick={()=>void query.refetch()}>Retry</button></div>;
  if(query.data===undefined)return <p className="loading" role="status">Loading…</p>;
  return <>{children(query.data)}</>;
}
export function Metrics({items}:{items:Array<[string,string,string]>}){
  return <section className="metrics" aria-label="Program metrics">{items.map(([label,value,note])=>
    <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</section>;
}
export function Facts({items}:{items:Array<[string,ReactNode]>}){
  return <dl className="facts">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
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
