import {futureTimeline,EditionArt} from './timeline';
import {products,collectionName} from '../public-content.mjs';
import {presentationName} from './presentation-name';
import {NftArt,TokenArt} from './experience';
import {QaTokenDetails} from './qa-identity';
import {InventoryEvidence,AssetEvidence} from './collection-details';
import {PublishedStage} from './collect';
import {rootRoute} from './routes';
import { useRuntimeQuery, principalKey } from './capabilities';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useSession } from './session';
import { sdk } from './sdk';
import { Empty, Facts, Hero, Loaded, Panel, percent, pretty, ShareLink, usePageMeta, utc } from './common';
import { Earn } from './earn';
import { QuotePanel,quoteServices } from './quote-panel';

export function CanonicalMarket(){
  const {marketId}=useParams({from:'/markets/$marketId'});
  const market=useRuntimeQuery('/api/v1/markets/{id}',{queryKey:['market',marketId],queryFn:({signal})=>sdk.market(marketId,signal)});
  const title=market.data?market.data.symbol+' / '+market.data.ogSymbol:products.attention.name;
  usePageMeta(title,'A separate Attention Token, its selected underlying meme and recorded campaign terms.','/markets/'+encodeURIComponent(marketId),true);
  return <><Hero title={title}>A separate Attention Token paired with its selected underlying meme. Review the recorded terms below.</Hero>
    <Loaded query={market}>{m=><Panel title="Market details"><div className="token-detail-hero"><TokenArt name={m.id}/><QaTokenDetails id={m.id}/></div><Facts items={[['Product',products.attention.name],['Chain','Solana'],['Attention Token ticker',m.symbol],['Selected meme ticker',m.ogSymbol],['Campaign status',m.status],
      ['Activated',utc(m.activatedAt)],['Current fee',percent(m.feeBps)],['ATT mint',m.attMint],['Selected meme mint',m.ogMint],['Pool',m.poolAddress]]}/>
      <p><Link to="/stake" search={{farm:m.id}}>Stake this token →</Link></p></Panel>}</Loaded>
    {market.data&&<QuotePanel marketId={marketId} symbol={market.data.symbol} ogSymbol={market.data.ogSymbol} services={quoteServices}/>}
    <ShareLink path={'/markets/'+encodeURIComponent(marketId)} title={title}/><Link to="/tokens">All tokens →</Link></>;
}

export function CanonicalGenesis(){
  usePageMeta(products.genesis.name,'Permanent 10X NFT collection terms and release stages.','/collections/genesis',true);
  const terms=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const {wallet}=useSession(),search=rootRoute.useSearch();
  const inventories=useRuntimeQuery('/api/v1/collect/inventories',{queryKey:principalKey(wallet,'inventories',search.inventories),queryFn:({signal})=>sdk.inventories(search.inventories,signal)});
  return <><Hero title={products.genesis.name}>One permanent collection. 10,000 collectibles, with Level-based benefits and published eligibility rules.</Hero><p className="launch-status">Planned · production mint not scheduled</p>
    <div className="collection-detail-art"><NftArt name="genesis"/></div><Panel title="Collection terms"><Loaded query={terms}>{p=><Facts items={[['Maximum supply',pretty(p.genesis.cap)],
      ['Tranche size',pretty(p.genesis.trancheSize)],['First whitelist stage',p.genesis.firstWhitelistPriceSol+' SOL'],
      ['Stage notice',p.genesis.noticeHours+' hours'],['Mint limit',p.genesis.mintsPerEligibleWalletPerStage+' per eligible wallet per stage']]}/>}</Loaded></Panel>
    <Panel title="Release updates"><p>Follow community updates for upcoming releases. New stages require founder approval and published notice.</p><Link to="/nfts">View published stages ↗</Link></Panel>
    <Panel title="Published tranches"><Loaded query={inventories}>{page=><>
      {page.items.filter(i=>i.kind==='genesis').map(i=><article className="record" key={i.id}><h3>{presentationName(i.id)} · tranche {i.tranche}</h3><InventoryEvidence inventory={i}/>{i.stages.map(stage=><PublishedStage key={stage.id} inventory={i} stage={stage}/>)}</article>)}
      {!page.items.some(i=>i.kind==='genesis')&&<p>No 10X NFT tranches on this page.</p>}
      {page.nextCursor!==null&&<Link to="/collections/genesis" search={{inventories:String(page.nextCursor)}}>Next collections →</Link>}
    </>}</Loaded><Link to="/nfts">Open collection studio ↗</Link></Panel>
    <ShareLink path="/collections/genesis" title={products.genesis.name}/></>;
}

export function CanonicalSeason(){
  const {seasonId}=useParams({from:'/seasons/$seasonId'});
  usePageMeta(presentationName(seasonId),products.season.name+' edition inventory and stage terms.','/seasons/'+encodeURIComponent(seasonId),true);
  const {wallet}=useSession();
  const inventory=useRuntimeQuery('/api/v1/collect/inventories/{id}',{queryKey:principalKey(wallet,'season',seasonId),queryFn:({signal})=>sdk.inventory(seasonId,signal)});
  return <><Hero title={products.season.name+" · "+presentationName(seasonId)}>Seasonal collectible inventory and benefit periods. Campaign dates and collectible utility expiry are separate.</Hero>
    <Loaded query={inventory}>{inv=>inv.kind==='season'?<>
      <div className="collection-detail-art">{futureTimeline?.editions.find(e=>e.id===inv.id)?<EditionArt edition={futureTimeline.editions.find(e=>e.id===inv.id)!}/>:<NftArt name={inv.id} inventoryId={inv.id}/>}</div><Panel title="Season inventory"><Facts items={[['Product',collectionName(inv.kind)],['Edition ID',inv.id],['Season start',inv.seasonStart?utc(inv.seasonStart):'Unavailable'],
        ['Total slots',pretty(inv.capacity)],['Slots available',pretty(inv.counts.unsold)],['Awaiting fulfillment',inv.counts.pending],
        ['Collection',presentationName(inv.id)]]}/><InventoryEvidence inventory={inv}/></Panel>
      <Panel title="Published stages">{inv.stages.length?inv.stages.map(s=><PublishedStage key={s.id} stage={s} inventory={inv}/>):<Empty title="No published stages"/>}
        <Link to="/nfts">Open collection studio ↗</Link></Panel>
    </>:<Empty title="Season not found"/>}</Loaded><ShareLink path={'/seasons/'+encodeURIComponent(seasonId)} title={presentationName(seasonId)}/></>;
}

export function CanonicalAsset(){
  const {assetId}=useParams({from:'/nfts/$assetId'});
  usePageMeta('NFT · '+assetId,'Publicly revealed NFT metadata and ownership.','/nfts/'+encodeURIComponent(assetId),true);
  const asset=useRuntimeQuery('/api/v1/collect/assets/{id}',{queryKey:['public-asset',assetId],queryFn:({signal})=>sdk.asset(assetId,signal)});
  return <><Hero title={assetId}>Collection metadata and current ownership.</Hero><Loaded query={asset}>{a=>
    <Panel title={a.revealStatus==='revealed'?'Collectible details':'Awaiting reveal'}><NftArt name={a.id} inventoryId={a.inventoryId} level={a.level} concealed={a.revealStatus!=='revealed'}/>
      <Facts items={[['Collection',presentationName(a.inventoryId)],['Owner',a.owner],['Status',a.revealStatus],...(a.revealStatus==='revealed'?[['Utility expiry',a.expiresAt?utc(a.expiresAt):'Permanent under published rules']] as [string,React.ReactNode][]:[]),
        ...(a.revealStatus==='revealed'?[['Level',a.level],['Model',a.traits?.model],['Backdrop',a.traits?.backdrop],['Symbol',a.traits?.symbol]] as [string,React.ReactNode][]:[])]}/>
      <AssetEvidence asset={a}/>{a.revealStatus==='revealed'&&<p><Link to="/airdrops" search={{asset:a.id}}>View rewards ↗</Link></p>}
    </Panel>}</Loaded><ShareLink path={'/nfts/'+encodeURIComponent(assetId)} title={'NFT · '+assetId}/></>;
}
export function CanonicalBoard(){
  const {epochId}=useParams({from:'/earn/$epochId'});
  if(!z.iso.date().safeParse(epochId).success)return <><Hero title="Board not found">Use a UTC calendar date to find a board.</Hero><Link to="/attention">Daily leaderboard →</Link></>;
  return <Earn epochId={epochId}/>;
}
