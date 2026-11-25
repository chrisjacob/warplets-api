import {futureTimeline} from './timeline';
import {Link} from '@tanstack/react-router';
import {brand,products,firstLaunch,campaignSchedule,roadmap} from '../public-content.mjs';
import {Facts,Panel,pretty,Disclosure} from './common';
import {BrandMark} from './brand-art';

export function FirstMeme(){
 return <section className="first-meme" id="tenx-meme" aria-labelledby="first-meme-title">
  <BrandMark/>
  <div className="first-meme-copy"><p className="eyebrow">10X Memes · Original memecoins</p>
   <h2 id="first-meme-title">{firstLaunch.name} <span>({firstLaunch.ticker})</span></h2>
   <p className="lead-copy">{brand.mindset}</p>
   <span className="launch-status">Not launched</span>
   <p>Our first original memecoin. Inspired by extraordinary achievements and the power of attention.</p>
   <Disclosure title="Launch details">
    <Facts items={[[ 'Product',products.original.name],['Season',firstLaunch.seasonLabel],['Launch date','To be announced'],['Verified contract','Not available']]}/>
    <p>Holding $10X does not confer governance, revenue sharing or ecosystem reward rights. Its paired Attention Token is a separate asset, with dates and contract to be confirmed.</p>
   </Disclosure>
   <Link className="action-link" to="/nfts" hash="season-0">Discover the Season 0 cards</Link>
  </div>
 </section>;
}
export function BetaPlan(){
 return <section id="season-0" aria-labelledby="beta-title" className="collection-offer offer-season">
  <BrandMark variant="card"/>
  <div className="offer-copy"><p className="eyebrow">Seasonal edition · {firstLaunch.seasonLabel}</p><h2 id="beta-title">{products.season.name}</h2>
   <p>Collect a piece of $10X. Seasonal benefits, lasting ownership.</p>
   <div className="offer-terms"><strong>US$1 <small>planned beta mint</small></strong><span>{pretty(firstLaunch.collectibleSupply)} cards</span></div>
   <span className="launch-status">Mint not open · Date to be announced</span>
   <Disclosure title="Edition details"><Facts items={[[ 'Intended standard mint','US$'+firstLaunch.standardMintUsd],['Beta discount','90%'],['Paired Attention Token campaign',campaignSchedule()]]}/>
    <p>Benefits expire according to Level and the season start. Ownership and historical allocations persist. The campaign end and utility expiry are separate dates.</p>
   </Disclosure>
  </div>
 </section>;
}
export function Roadmap(){
 const items=futureTimeline?[
  {title:'The next original',status:'Coming next',detail:'A new cultural idea. Watch for the next 10X Meme reveal.'},
  {title:'Another edition to keep',status:'Next season',detail:'Discover the next 1,000-card edition. Earlier seasons stay in your collection.'},
  {title:'New attention, every day',status:'Ongoing',detail:'Explore new Attention Tokens and join active campaigns.'},
 ]:roadmap;
 return <section aria-labelledby="roadmap-title" className="roadmap-content">
  <h2 id="roadmap-title">{futureTimeline?'The next chapter.':'Start with one. Grow from there.'}</h2>
  <div className="roadmap-grid">{items.map(item=><article key={item.title}><span className="launch-status">{item.status}</span><h3>{item.title}</h3><p>{item.detail}</p></article>)}</div>
 </section>;
}
export function ProductHelp(){
 return <Panel title="One brand. Four products."><p className="brand-purpose">{brand.mission} {brand.culture}</p>
  <p><strong>10X Memes</strong> are our original memecoins. <strong>Attention Tokens</strong> are separate tokens supporting campaigns around selected memes.</p>
  <p><strong>10X NFT</strong> is the permanent 10,000 collection. <strong>10X Cards</strong> are limited seasonal editions of 1,000 collectibles.</p>
  <details><summary>What happens when a season ends?</summary><p>Seasonal utility expires according to Level. You keep your cards and historical allocations. A Season identifies an edition and campaign period.</p></details>
  <details><summary>What about Base Warplets?</summary><p>Base Warplets are historical assets with their original identity and provenance. They are separate from the new 10X NFT collection; no ongoing utility is implied.</p></details>
 </Panel>;
}
