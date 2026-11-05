import { createRootRoute, createRoute, createRouter, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { SessionProvider, useSession } from './session';
import { compact } from './common';
import { Markets } from './markets';
import { Vault, Stake, Earn, Collect } from './pages';

const destinations=['markets','vault','stake','earn','collect'] as const;
const searchKeys=['market','cursor','asset','farm','date','submissions','awards','owned','operations','inventories','receipt'] as const;
export type Search=Partial<Record<typeof searchKeys[number],string>>;
function validateSearch(input:Record<string,unknown>):Search{
  const result:Search={};
  for(const key of searchKeys){
    const value=input[key];
    if((typeof value==='string'||typeof value==='number')&&String(value).length<=256)result[key]=String(value);
  }
  return result;
}
function Shell(){
  const {wallet,open}=useSession();
  const fetching=useIsFetching();
  const path=useRouterState({select:s=>s.location.pathname});
  const current=path==='/'?'markets':path.slice(1);
  useEffect(()=>{document.title=current[0]?.toUpperCase()+current.slice(1)+' · 10X.MEME';},[current]);
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-header"><div className="frame mast">
      <Link to="/markets" aria-label="10X.MEME markets" className="brand"><i>10X</i>.MEME</Link>
      <nav aria-label="Main navigation">{destinations.map(name=><Link key={name} to={'/'+name as '/markets'}
        aria-current={name===current?'page':undefined}>{name[0].toUpperCase()+name.slice(1)}</Link>)}</nav>
      <button className="wallet-button" id="wallet-button" onClick={open}><span aria-hidden="true">◎</span> <span id="wallet-name">{wallet?compact(wallet):'Connect wallet'}</span></button>
    </div></header>
    <main id="main" tabIndex={-1} className="frame main"><div className="environment"><i aria-hidden="true"/> Local preview <span/> Solana</div>
      <div id="view" aria-busy={fetching>0}><Outlet/></div></main>
    <footer><div className="frame footer-row"><Link to="/markets" className="brand">10X.MEME</Link><span>Solana preview</span><a href="/api/v1/openapi.json">API reference ↗</a></div></footer>
  </>;
}
export const rootRoute=createRootRoute({validateSearch,component:()=> <SessionProvider><Shell/></SessionProvider>});
const route=<const P extends string,>(path:P,component:()=>React.JSX.Element)=>createRoute({getParentRoute:()=>rootRoute,path,component});
const routes=[route('/',Markets),route('/markets',Markets),route('/vault',Vault),route('/stake',Stake),
  route('/earn',Earn),route('/collect',Collect)];
export const router=createRouter({routeTree:rootRoute.addChildren(routes),defaultPreload:'intent'});
declare module '@tanstack/react-router' {interface Register {router:typeof router}}
