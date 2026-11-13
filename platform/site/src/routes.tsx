import {ExperienceProvider,TechnicalToggle} from './experience';
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Link, Outlet, useRouterState, type RouteComponent } from '@tanstack/react-router';
import { useIsFetching } from '@tanstack/react-query';
import { SessionProvider, useSession } from './session';
import { compact } from './common';

const destinations=[['','Home'],['tokens','Tokens'],['nfts','NFTs'],['airdrops','Airdrops'],['stake','Stake'],['earn','Earn']] as const;
const searchKeys=['market','cursor','campaigns','asset','farm','date','submissions','awards','owned','operations','inventories','receipt'] as const;
export type Search=Partial<Record<typeof searchKeys[number],string>>;
function validateSearch(input:Record<string,unknown>):Search{
  const result:Search={};
  for(const key of searchKeys){
    const value=input[key];
    if((typeof value==='string'||typeof value==='number')&&String(value).length<=(key==='cursor'?1024:256))result[key]=String(value);
  }
  return result;
}
function Shell(){
  const {wallet,open}=useSession();
  const fetching=useIsFetching();
  const path=useRouterState({select:s=>s.location.pathname});
  const section=path.split('/')[1];
  const current=!section?'':({markets:'tokens',vault:'airdrops',collect:'nfts',collections:'nfts',seasons:'nfts',attention:'earn',leaderboards:'earn'} as Record<string,string>)[section]??section;
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header"><div className="frame mast">
      <Link to="/" aria-label="10X.MEME home" className="brand"><i>10X</i>.MEME</Link>
      <nav aria-label="Main navigation">{destinations.map(([name,label])=><Link key={name} to={'/'+name as '/tokens'}
        aria-label={label} aria-current={name===current?'page':undefined}>{name?label:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/></svg>}</Link>)}</nav>
      <button className="wallet-button" id="wallet-button" onClick={open}><span aria-hidden="true">◎</span> <span id="wallet-name">{wallet?compact(wallet):'Connect wallet'}</span></button>
    </div></header>
    <main id="main" tabIndex={-1} className="frame main"><div className="environment"><i aria-hidden="true"/> Demo · No real funds <span/> Solana</div>
      <div id="view" aria-busy={fetching>0}><Outlet/></div></main>
    <footer><div className="frame footer-row"><Link to="/" className="brand">10X.MEME</Link><span>Solana preview</span><TechnicalToggle/></div></footer>
  </>;
}
export const rootRoute=createRootRoute({validateSearch,component:()=> <ExperienceProvider><SessionProvider><Shell/></SessionProvider></ExperienceProvider>});
const route=<const P extends string,>(path:P,component:RouteComponent)=>createRoute({getParentRoute:()=>rootRoute,path,component});
const Markets=lazyRouteComponent(()=>import('./markets'),'Markets');
const routes=[route('/',lazyRouteComponent(()=>import('./home'),'Home')),route('/markets',Markets),route('/tokens',Markets),
  route('/participants/$wallet',lazyRouteComponent(()=>import('./performance'),'Participant')),
  route('/airdrops',lazyRouteComponent(()=>import('./pages'),'Vault')),
  route('/nfts',lazyRouteComponent(()=>import('./collect'),'Collect')),
  route('/attention',lazyRouteComponent(()=>import('./earn'),'Attention')),
  route('/leaderboards',lazyRouteComponent(()=>import('./earn'),'Leaderboards')),
  route('/vault',lazyRouteComponent(()=>import('./pages'),'Vault')),
  route('/stake',lazyRouteComponent(()=>import('./pages'),'Stake')),
  route('/earn',lazyRouteComponent(()=>import('./earn'),'Earn')),
  route('/collect',lazyRouteComponent(()=>import('./collect'),'Collect')),
  route('/markets/$marketId',lazyRouteComponent(()=>import('./details'),'CanonicalMarket')),
  route('/collections/genesis',lazyRouteComponent(()=>import('./details'),'CanonicalGenesis')),
  route('/seasons/$seasonId',lazyRouteComponent(()=>import('./details'),'CanonicalSeason')),
  route('/nfts/$assetId',lazyRouteComponent(()=>import('./details'),'CanonicalAsset')),
  route('/earn/$epochId',lazyRouteComponent(()=>import('./details'),'CanonicalBoard'))];
export const router=createRouter({routeTree:rootRoute.addChildren(routes),defaultPreload:'intent'});
declare module '@tanstack/react-router' {interface Register {router:typeof router}}
