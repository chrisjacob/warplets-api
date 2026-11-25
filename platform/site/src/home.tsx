import {futureTimeline,currentEdition,EditionArt} from './timeline';
import {Link} from '@tanstack/react-router';
import {usePageMeta,Disclosure} from './common';
import {brand,products,firstLaunch} from '../public-content.mjs';
import {Roadmap,ProductHelp} from './brand';
import {BrandMark} from './brand-art';
import hero from './assets/brand/warplet-exponential.png';

export function Home(){
 usePageMeta(brand.headline,brand.description,'/',true);
 return <div className="campaign-home">
  <section className="launch-hero" aria-labelledby="page-title">
   <img className="launch-photo" src={hero} width="1536" height="1024" alt="" fetchPriority="high"/>
   <div className="launch-shade" aria-hidden="true"/>
   <div className="launch-content"><div className="launch-copy">
    <p className="brand-worldview">{brand.worldview}</p><p className="brand-mindset">{brand.mindset}</p>
    <h1 id="page-title" tabIndex={-1}>10X<br/><span>Everything.</span></h1>
    <p className="launch-description">{futureTimeline?<>Original memecoins. New frontiers.</>:<>Meet $10X. Our first original memecoin.</>}</p>
    <Link className="primary-link" to="/tokens" hash="tenx-meme">{futureTimeline?'Explore the memes':'Explore $10X'}</Link>
    <p className="launch-footnote"><strong>{futureTimeline?'10X Memes':'$10X'}</strong><span>{futureTimeline?'Originals. Attention. Collectibles.':'The first 10X Meme · Not launched'}</span></p>
   </div></div>
  </section>
  <section className="season-feature" aria-labelledby="season-feature-title">
   <div className="season-feature-copy"><p className="eyebrow">10X Cards · {currentEdition?'Season '+currentEdition.number:firstLaunch.seasonLabel}</p><h2 id="season-feature-title">{currentEdition?<>Beyond the<br/>ordinary.</>:<>Collect the<br/>beginning.</>}</h2><p>{currentEdition?<>Meet ${currentEdition.symbol}. The latest 10X Cards edition.</>:<>The first seasonal collectible edition, inspired by $10X.</>}</p>
    <div className="edition-stats"><div><strong>1,000</strong><span>cards in the edition</span></div><div><strong>{currentEdition?String(currentEdition.number).padStart(2,'0'):'US$1'}</strong><span>{currentEdition?'the latest season':'planned beta mint'}</span></div></div>
    <div className="feature-action">{currentEdition?<><Link className="action-link" to="/seasons/$seasonId" params={{seasonId:currentEdition.id}}>Explore Season {currentEdition.number}</Link><Link className="action-link" to="/nfts" hash="season-archive">All seasons</Link></>:<><Link className="action-link" to="/nfts" hash="season-0">Explore Season 0</Link><span className="launch-status">Mint not open</span></>}</div>
   </div>
   <div className="season-feature-art"><div className="edition-backplate" aria-hidden="true"/>{currentEdition?<EditionArt edition={currentEdition}/>:<BrandMark variant="card"/>}</div>
  </section>
  <section className="explore-section" aria-labelledby="explore-title"><div className="section-heading"><h2 id="explore-title">Find your edge.</h2><span>Explore. Collect. Participate.</span></div>
   <div className="discovery-grid">
    <Link className="discovery-card discovery-attention" to="/tokens" hash="attention-tokens"><div className="discovery-visual" aria-hidden="true"><span>FOCUS.</span><i/></div><div className="discovery-copy"><h3>{products.attention.plural}</h3><p>Discover tokens and campaigns around selected memes.</p><span className="discovery-action">Explore tokens</span></div></Link>
    <Link className="discovery-card discovery-permanent" to="/collections/genesis"><div className="discovery-visual" aria-hidden="true"><span>10X</span><i/></div><div className="discovery-copy"><h3>{products.genesis.name}</h3><p>One permanent collection. Your lasting connection to 10X.</p><span className="discovery-action">Explore the collection</span></div></Link>
    <Link className="discovery-card discovery-earn" to="/earn"><div className="discovery-visual" aria-hidden="true"><span>CREATE.</span><i/></div><div className="discovery-copy"><h3>Make your mark.</h3><p>Create content for a campaign. Earn rewards for eligible contributions.</p><span className="discovery-action">Explore Earn</span></div></Link>
   </div>
  </section>
  <div className="home-more"><Disclosure title="About 10X" id="how-it-works"><ProductHelp/></Disclosure><Disclosure title="What comes next" id="roadmap"><Roadmap/></Disclosure></div>
 </div>;
}
