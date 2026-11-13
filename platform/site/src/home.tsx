import {Link} from '@tanstack/react-router';
import {Hero,Panel,usePageMeta} from './common';
import {PerformanceBoard,RecentActivity,type Category} from './performance';
import {NftArt,TokenArt} from './experience';
const sections:{category:Category;title:string;description:string;action:string}[]=[
 {category:'tokens',title:'Find a community worth your attention',description:'Discover Attention Tokens paired with memecoins and crypto project tokens. Review each pair and its trading terms.',action:'Explore tokens'},
 {category:'nfts',title:'Collect a place in the ecosystem',description:'Genesis offers permanent membership. Seasons have a benefit period. NFT ownership is optional and can unlock allocation benefits and reward boosts.',action:'Explore NFTs'},
 {category:'airdrops',title:'See the rewards adding up',description:'Track awards from NFTs, staking and content in one place. Lifetime valuations are separate from amounts available to claim.',action:'Explore airdrops'},
 {category:'stake',title:'Put your ATT to work',description:'Stake an Attention Token for its campaign rewards. A corresponding $10 stake also helps you qualify to submit content.',action:'Explore staking'},
 {category:'earn',title:'Create attention. Earn rewards.',description:'Publish original content, submit your link and follow its review. Eligible top-ranked contributions can receive ATT awards.',action:'Explore Earn'},
];
export function Home(){
 usePageMeta('10X.meme','Discover tokens, collect NFTs and create attention. Explore participant rewards across the ecosystem.','/',true);
 return <><header className="home-hero"><div><p className="eyebrow">A home for attention</p><Hero title="Your attention. More possibility.">Discover communities, create something worth sharing and see how participation can build token rewards.</Hero><div className="home-actions"><Link className="primary-link" to="/tokens">Explore tokens →</Link><Link className="action-link" to="/earn">Start creating →</Link></div></div><div className="home-art" aria-hidden="true"><NftArt name="10x-home" level={1}/><TokenArt name="10X"/></div></header>
 <Panel title="Find your way into 10X"><ol className="flywheel" aria-label="Ways to participate">{[['Discover','/tokens'],['Collect','/nfts'],['Stake','/stake'],['Earn','/earn'],['Claim','/airdrops']].map(([label,to],index)=><li key={label}><span>{index+1}</span><Link to={to as '/tokens'}>{label}</Link></li>)}</ol><p>These activities work together—you choose where to start. They are not required steps, and NFTs are optional. Claims and other financial actions remain disabled in this local demo.</p></Panel>
 <div className="home-categories">{sections.map(s=><Panel key={s.category} className="home-category"><div className="category-intro"><p className="eyebrow">{s.category==='nfts'?'NFTs':s.category[0].toUpperCase()+s.category.slice(1)}</p><h2>{s.title}</h2><p>{s.description}</p><Link className="action-link" to={'/'+s.category as '/tokens'}>{s.action} →</Link></div><PerformanceBoard category={s.category} preview/><Link to={'/'+s.category as '/tokens'} hash={'performance-'+s.category} className="full-board-link">View top 100 →</Link></Panel>)}</div>
 <RecentActivity/>
 <p className="valuation-disclosure">All displayed performance is synthetic QA data. Peak values are historical theoretical valuations, not profit or cash proceeds. Market values use the snapshot price. Each award is counted once across the ecosystem.</p>
 </>;
}
