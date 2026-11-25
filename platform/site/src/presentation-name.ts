import {futureTimeline} from './timeline';
import {products} from '../public-content.mjs';
// Display labels only. IDs, wallet addresses and stored records remain unchanged.
export function presentationName(value:string){
 const edition=futureTimeline?.editions.find(e=>e.id===value);
 if(edition)return 'Season '+edition.number+' · '+edition.symbol;
 if(value==='demo-genesis')return products.genesis.name;
 if(value==='demo-season')return products.season.name;
 if(value.startsWith('Synthetic QA owner'))return '10X member';
 return value;
}
