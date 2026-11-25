import {products} from '../public-content.mjs';
import {BrandMark} from './brand-art';
import {useState} from 'react';
import cate from './assets/collectibles/season-cate.webp';
import pepe from './assets/collectibles/season-pepe.webp';
import doge from './assets/collectibles/season-doge.webp';
import wif from './assets/collectibles/season-wif.webp';
import ansem from './assets/collectibles/season-ansem.webp';
import './collection-art.css';

export const seasonArtwork=[
 {id:'cate',label:'CATE',src:cate,description:'Cat energy. Main-character attitude.'},
 {id:'pepe',label:'PEPE',src:pepe,description:'A familiar grin. A fresh collectible.'},
 {id:'doge',label:'DOGE',src:doge,description:'Good dog. Great company.'},
 {id:'wif',label:'WIF',src:wif,description:'A little hat. A lot of character.'},
 {id:'ansem',label:'ANSEM',src:ansem,description:'Black-bull energy, in collectible form.'},
] as const;
/** Presentation samples only: never treated as an asset's committed reveal metadata. */
export function CollectionArt({name,inventoryId,level,concealed=false,theme}:{name:string;inventoryId?:string;level?:number;concealed?:boolean;theme?:string}){
 const [failed,setFailed]=useState<string|null>(null);
 const isGenesis=(inventoryId??name).toLowerCase().includes('genesis');
 const sample=seasonArtwork.find(item=>item.id===theme);
 const src=sample?.src;
 const title=isGenesis?products.genesis.name:products.season.name;
 return <figure className={'nft-art collection-art'+(concealed?' is-concealed':'')} aria-label={concealed?'NFT awaiting reveal':title+' artwork'}>
  {concealed?<div className="concealed-art"><span aria-hidden="true">?</span><strong>Your reveal is coming</strong><small>Artwork stays hidden until reveal.</small></div>:!src?<BrandMark variant={isGenesis?'permanent':'card'}/>:failed===src?<div className="concealed-art"><strong>{title}</strong><small>Artwork unavailable</small></div>:<img src={src} alt={title} width="640" height="640" loading="lazy" decoding="async" onError={()=>setFailed(src)}/>}
  <figcaption><span>{concealed?'Awaiting reveal':sample?sample.label:title}</span>{!concealed&&level!=null&&<strong>Level {level}</strong>}</figcaption>
 </figure>;
}
export function SeasonGallery(){return <section className="season-showcase" aria-labelledby="season-showcase-title"><div className="season-showcase-heading"><div><p className="eyebrow">Meme culture, collectible form</p><h2 id="season-showcase-title">Collectible artwork</h2></div><span className="category-chip">{products.season.name}</span></div><div className="season-art-grid">{seasonArtwork.map(item=><article key={item.id}><CollectionArt name={item.id} theme={item.id}/><h3>{item.label}</h3><p>{item.description}</p></article>)}</div></section>;}
