import {products} from '../public-content.mjs';

export function BrandMark({variant='meme'}:{variant?:'meme'|'permanent'|'card'}){
 const title=variant==='meme'?'$10X':variant==='permanent'?products.genesis.name:products.season.name;
 return <div className={'brand-art brand-art-'+variant} role="img" aria-label={title+' brand artwork'}>
  <div className="art-tracks" aria-hidden="true"><i/><i/><i/></div>
  <span className="art-kicker">{variant==='meme'?'Think bigger.':variant==='permanent'?'The permanent collection':'Seasonal edition'}</span>
  <div className="art-emblem" aria-hidden="true"><strong>10X</strong></div>
  <span className="art-caption">{title}</span>
 </div>;
}
