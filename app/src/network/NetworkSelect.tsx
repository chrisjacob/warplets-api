import { useEffect, useId, useRef, useState } from 'react';
import { ChevronIcon } from './NetworkIcons';
export interface NetworkOption { value: string; label: string; disabled?: boolean }
export default function NetworkSelect({label,value,options,onChange,disabled=false}:{label:string;value:string;options:NetworkOption[];onChange:(value:string)=>void;disabled?:boolean}) {
  const id=useId(), root=useRef<HTMLDivElement>(null), input=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[index,setIndex]=useState(0);
  const matches=options.filter(o=>`${o.label} ${o.value}`.toLowerCase().includes(search.trim().toLowerCase()));
  useEffect(()=>{if(!open)return;input.current?.focus();const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
  useEffect(()=>{if(open)document.getElementById(`${id}-${index}`)?.scrollIntoView({block:'nearest'});},[index,id,open]);
  function choose(i:number){const option=matches[i];if(!option||option.disabled)return;onChange(option.value);setOpen(false);root.current?.querySelector('button')?.focus();}
  return <div className="network-select" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} onClick={()=>{setSearch('');setIndex(0);setOpen(v=>!v);}} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setSearch('');setIndex(0);setOpen(true);}}}><span>{options.find(o=>o.value===value)?.label??value}</span><ChevronIcon/></button>
    {open&&<div className="network-select-popup"><input ref={input} role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-expanded="true" aria-autocomplete="list" aria-controls={id} aria-activedescendant={matches[index]?`${id}-${index}`:undefined} value={search} placeholder="Search…" onChange={e=>{setSearch(e.target.value);setIndex(0);}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);root.current?.querySelector('button')?.focus();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setIndex(i=>Math.max(0,Math.min(matches.length-1,i+(e.key==='ArrowDown'?1:-1))));}else if(e.key==='Enter'){e.preventDefault();choose(index);}}}/>
      <div id={id} role="listbox" aria-label={label}>{matches.map((o,i)=><div key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value===value} aria-disabled={o.disabled||undefined} className={i===index?'highlighted':''} onPointerMove={()=>setIndex(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(i)}>{o.label}</div>)}{!matches.length&&<p>No matches</p>}</div>
    </div>}
  </div>;
}
