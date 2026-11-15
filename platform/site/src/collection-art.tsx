import {useState} from 'react';
import cate from './assets/collectibles/season-cate.webp';
import pepe from './assets/collectibles/season-pepe.webp';
import doge from './assets/collectibles/season-doge.webp';
import wif from './assets/collectibles/season-wif.webp';
import ansem from './assets/collectibles/season-ansem.webp';
import genesis1 from './assets/collectibles/genesis-1.webp';
import genesis2 from './assets/collectibles/genesis-2.webp';
import genesis3 from './assets/collectibles/genesis-3.webp';
import genesis4 from './assets/collectibles/genesis-4.webp';
import genesis5 from './assets/collectibles/genesis-5.webp';
import genesis6 from './assets/collectibles/genesis-6.webp';
import './collection-art.css';

export const seasonArtwork=[
 {id:'cate',label:'CATE',src:cate,description:'Cat energy. Main-character attitude.'},
 {id:'pepe',label:'PEPE',src:pepe,description:'A familiar grin. A fresh collectible.'},
 {id:'doge',label:'DOGE',src:doge,description:'Good dog. Great company.'},
 {id:'wif',label:'WIF',src:wif,description:'A little hat. A lot of character.'},
 {id:'ansem',label:'ANSEM',src:ansem,description:'Black-bull energy, in collectible form.'},
] as const;
const genesis=[genesis1,genesis2,genesis3,genesis4,genesis5,genesis6];
const index=(value:string,size:number)=>[...value].reduce((sum,c)=>(sum*31+c.charCodeAt(0))>>>0,0)%size;
/** Presentation samples only: never treated as an asset's committed reveal metadata. */
export function CollectionArt({name,inventoryId,level,concealed=false,theme}:{name:string;inventoryId?:string;level?:number;concealed?:boolean;theme?:string}){
 const [failed,setFailed]=useState<string|null>(null);
 const isGenesis=(inventoryId??name).toLowerCase().includes('genesis');
 const sample=seasonArtwork.find(item=>item.id===theme)??seasonArtwork[index(inventoryId??name,seasonArtwork.length)];
 const genesisIndex=name==='genesis'?0:index(name,genesis.length);
 const src=isGenesis?genesis[genesisIndex]:sample.src;
 const title=isGenesis?'10X Warplet #'+(genesisIndex+1):sample.label+' Season';
 return <figure className={'nft-art collection-art'+(concealed?' is-concealed':'')} aria-label={concealed?'NFT awaiting reveal':title+' preview artwork'}>
  {concealed?<div className="concealed-art"><span aria-hidden="true">?</span><strong>Your reveal is coming</strong><small>Artwork stays hidden until reveal.</small></div>:failed===src?<div className="concealed-art"><strong>{title}</strong><small>Artwork unavailable</small></div>:<img src={src} alt={title+' · illustrative demo artwork'} width="640" height="640" loading="lazy" decoding="async" onError={()=>setFailed(src)}/>}
  <figcaption><span>{concealed?'Awaiting reveal':isGenesis?'10X Warplets · preview':sample.label+' · concept preview'}</span>{!concealed&&level!=null&&<strong>Level {level}</strong>}</figcaption>
 </figure>;
}
export function SeasonGallery(){return <section className="season-showcase" aria-labelledby="season-showcase-title"><div className="season-showcase-heading"><div><p className="eyebrow">Meme culture, collectible form</p><h2 id="season-showcase-title">Meet your next obsession.</h2></div><span className="category-chip">Season concepts</span></div><p>Five characters. Five different energies. Explore original preview art inspired by the communities you know.</p><div className="season-art-grid">{seasonArtwork.map(item=><article key={item.id}><CollectionArt name={item.id} theme={item.id}/><h3>{item.label}</h3><p>{item.description}</p></article>)}</div><p className="fixture-label">AI-generated concept art for this demo. Themes, releases and mint terms are not finalized. No affiliation or endorsement is implied.</p></section>;}
