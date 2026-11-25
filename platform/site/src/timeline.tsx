import {z} from 'zod';
import {useState} from 'react';
import {Link} from '@tanstack/react-router';
const editionModel=z.object({id:z.string().regex(/^[a-z0-9-]+$/),number:z.number().int().min(0).max(12),symbol:z.string().max(24),line:z.string().max(100),startsAt:z.iso.datetime(),current:z.boolean(),supply:z.number().int().positive()});
const model=z.object({mode:z.enum(['season-0','six-months']),historyDays:z.number().int().min(0).max(180),launchCount:z.number().int().min(0).max(180),editions:z.array(editionModel).max(12)});
function readTimeline(){
 if(typeof document==='undefined')return null;
 const text=document.getElementById('tenx-timeline')?.textContent;
 if(!text||text.length>16384)return null;
 try{const result=model.safeParse(JSON.parse(text));return result.success?result.data:null;}catch{return null;}
}
// The QA host explicitly supplies this manifest. Published builds have no timeline controls.
export const timeline=readTimeline();
export const futureTimeline=timeline?.mode==='six-months'?timeline:null;
export type Edition=z.infer<typeof editionModel>;
export const currentEdition=futureTimeline?.editions.find(e=>e.current);
export function TimelineSwitch(){
 if(!timeline)return null;
 return <nav className="timeline-switch" aria-label="Platform timeline"><span>Timeline</span><a href="/__timeline/season-0" aria-current={timeline.mode==='season-0'?'true':undefined}>Season 0</a><a href="/__timeline/six-months" aria-current={timeline.mode==='six-months'?'true':undefined}>Six months</a></nav>;
}
export function EditionArt({edition}:{edition:Edition}){
 return <div className={'edition-art edition-tone-'+edition.number%4} role="img" aria-label={'Season '+edition.number+' · $'+edition.symbol+' artwork'}>
 <span>10X Cards · Season {edition.number}</span><strong>{edition.number===0?'10X':edition.symbol}</strong><small>{edition.line}</small></div>;
}
export function CurrentEditionOffer(){
 if(!currentEdition)return null;
 return <section className="collection-offer offer-season"><EditionArt edition={currentEdition}/><div className="offer-copy"><p className="eyebrow">Latest edition · Season {currentEdition.number}</p><h2>{currentEdition.symbol}</h2><p>{currentEdition.line} {currentEdition.supply.toLocaleString()} cards in this edition.</p><Link className="action-link" to="/seasons/$seasonId" params={{seasonId:currentEdition.id}}>Explore edition</Link><a className="action-link archive-shortcut" href="#season-archive">Browse every season</a></div></section>;
}
export function SeasonArchive(){
 const [search,setSearch]=useState(''),[page,setPage]=useState(0);
 if(!futureTimeline)return null;
 const editions=[...futureTimeline.editions].reverse().filter(e=>('Season '+e.number+' '+e.symbol).toLowerCase().includes(search.trim().toLowerCase()));
 const shown=editions.slice(page*6,page*6+6),pages=Math.max(1,Math.ceil(editions.length/6));
 return <section id="season-archive" className="season-archive" aria-labelledby="season-archive-title">
 <div className="catalog-header"><div><p className="eyebrow">Every edition. Yours to keep.</p><h2 id="season-archive-title">The seasons.</h2></div><span>{futureTimeline.editions.length} editions</span></div>
 <label className="catalog-search">Find an edition<input type="search" value={search} placeholder="Search season or meme" onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>
 <div className="edition-grid">{shown.map(e=><Link className="edition-tile" key={e.id} to="/seasons/$seasonId" params={{seasonId:e.id}}><EditionArt edition={e}/><div><h3>{e.symbol}</h3><p>Season {e.number} · {e.current?'Latest edition':'Past edition'}</p><span>Explore edition →</span></div></Link>)}</div>
 {!shown.length&&<p role="status">No editions match. Try a season number or meme name.</p>}
 <div className="catalog-pagination"><span role="status">{editions.length} {editions.length===1?'edition':'editions'} · Page {page+1} of {pages}</span><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous editions</button><button disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>Next editions</button></div>
 </section>;
}
export function OriginalMemes(){
 const [expanded,setExpanded]=useState(false);
 if(!futureTimeline||!currentEdition)return null;
 const ordered=[...futureTimeline.editions].reverse(),shown=expanded?ordered:ordered.slice(0,3);
 return <section id="tenx-meme" className="original-catalog" aria-labelledby="originals-title"><div className="catalog-header"><div><p className="eyebrow">Original memecoins</p><h2 id="originals-title">10X Memes</h2></div><span>{ordered.length} originals</span></div>
 <div className="original-grid">{shown.map(e=><article key={e.id} className={'original-tile edition-tone-'+e.number%4}><span>Season {e.number}{e.current?' · Latest':''}</span><h3>$<wbr/>{e.symbol}</h3><p>{e.line}</p><Link to="/seasons/$seasonId" params={{seasonId:e.id}}>Explore the season →</Link></article>)}</div>
 <button className="archive-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Show latest originals':'View all '+ordered.length+' originals'}</button></section>;
}
