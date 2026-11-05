import {InventoryEvidence,AssetEvidence} from './collection-details';
import {PublishedStage,BallotCard} from './collect';
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
  const title=market.data?market.data.symbol+' / '+market.data.ogSymbol:'ATT market';
  usePageMeta(title,'Campaign timing, fee and the paired original token.','/markets/'+encodeURIComponent(marketId),true);
  return <><Hero title={title}>Campaign timing, launch fee and verified market identifiers.</Hero>
    <Loaded query={market}>{m=><Panel title="Market details"><Facts items={[['Source','Local fixture'],['Campaign status',m.status],
      ['Activated',utc(m.activatedAt)],['Current fee',percent(m.feeBps)],['ATT mint',m.attMint],['OG mint',m.ogMint],['Pool',m.poolAddress]]}/>
      <p><Link to="/stake" search={{farm:m.id}}>Inspect farm ↗</Link></p></Panel>}</Loaded>
    {market.data&&<QuotePanel marketId={marketId} symbol={market.data.symbol} ogSymbol={market.data.ogSymbol} services={quoteServices}/>}
    <ShareLink path={'/markets/'+encodeURIComponent(marketId)} title={title}/><Link to="/markets">All markets →</Link></>;
}

export function CanonicalGenesis(){
  usePageMeta('Genesis','Permanent collection terms and Genesis tranche stages.','/collections/genesis',true);
  const terms=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const {wallet}=useSession(),search=rootRoute.useSearch();
  const inventories=useRuntimeQuery('/api/v1/collect/inventories',{queryKey:principalKey(wallet,'inventories',search.inventories),queryFn:({signal})=>sdk.inventories(search.inventories,signal)});
  const ballots=useRuntimeQuery('/api/v1/genesis/ballots',{queryKey:['ballots'],queryFn:({signal})=>sdk.ballots(signal)});
  return <><Hero title="Genesis">Permanent membership in a collection with ten tranches and fixed Levels.</Hero>
    <Panel title="Collection terms"><Loaded query={terms}>{p=><Facts items={[['Maximum supply',pretty(p.genesis.cap)],
      ['Tranche size',pretty(p.genesis.trancheSize)],['First whitelist stage',p.genesis.firstWhitelistPriceSol+' SOL'],
      ['Stage notice',p.genesis.noticeHours+' hours'],['Mint limit',p.genesis.mintsPerEligibleWalletPerStage+' per eligible wallet per stage']]}/>}</Loaded></Panel>
    <Panel title="Tranche voting"><p>Genesis holders and whitelisted wallets vote on the next tranche’s timing.
      The founder publishes the decision and rationale.</p><Link to="/collect">View published stages and ballots ↗</Link></Panel>
    <Panel title="Published tranches"><Loaded query={inventories}>{page=><>
      {page.items.filter(i=>i.kind==='genesis').map(i=><article className="record" key={i.id}><h3>{i.id} · tranche {i.tranche}</h3><InventoryEvidence inventory={i}/>{i.stages.map(stage=><PublishedStage key={stage.id} inventory={i} stage={stage}/>)}</article>)}
      {!page.items.some(i=>i.kind==='genesis')&&<p>No Genesis tranches on this page.</p>}
      {page.nextCursor!==null&&<Link to="/collections/genesis" search={{inventories:String(page.nextCursor)}}>Next collections →</Link>}
    </>}</Loaded><Link to="/collect">Open collection studio ↗</Link></Panel>
    <Panel title="Published ballots"><Loaded query={ballots}>{page=>page.items.length?page.items.map(ballot=><BallotCard key={ballot.id} ballot={ballot} wallet={wallet}/>):<Empty title="No published ballots"/>}</Loaded></Panel>
    <ShareLink path="/collections/genesis" title="Genesis"/></>;
}

export function CanonicalSeason(){
  const {seasonId}=useParams({from:'/seasons/$seasonId'});
  usePageMeta('Season · '+seasonId,'Monthly Season inventory and stage terms.','/seasons/'+encodeURIComponent(seasonId),true);
  const {wallet}=useSession();
  const inventory=useRuntimeQuery('/api/v1/collect/inventories/{id}',{queryKey:principalKey(wallet,'season',seasonId),queryFn:({signal})=>sdk.inventory(seasonId,signal)});
  return <><Hero title={'Season · '+seasonId}>Monthly collection inventory and benefit periods.</Hero>
    <Loaded query={inventory}>{inv=>inv.kind==='season'?<>
      <Panel title="Season inventory"><Facts items={[['Season start',inv.seasonStart?utc(inv.seasonStart):'Unavailable'],
        ['Total slots',pretty(inv.capacity)],['Slots available',pretty(inv.counts.unsold)],['Awaiting fulfillment',inv.counts.pending],
        ['Collection',inv.id]]}/><InventoryEvidence inventory={inv}/></Panel>
      <Panel title="Published stages">{inv.stages.length?inv.stages.map(s=><PublishedStage key={s.id} stage={s} inventory={inv}/>):<Empty title="No published stages"/>}
        <Link to="/collect">Open collection studio ↗</Link></Panel>
    </>:<Empty title="Season not found"/>}</Loaded><ShareLink path={'/seasons/'+encodeURIComponent(seasonId)} title={'Season · '+seasonId}/></>;
}

export function CanonicalAsset(){
  const {assetId}=useParams({from:'/nfts/$assetId'});
  usePageMeta('NFT · '+assetId,'Publicly revealed NFT metadata and ownership.','/nfts/'+encodeURIComponent(assetId),true);
  const asset=useRuntimeQuery('/api/v1/collect/assets/{id}',{queryKey:['public-asset',assetId],queryFn:({signal})=>sdk.asset(assetId,signal)});
  return <><Hero title={assetId}>Collection metadata and current ownership.</Hero><Loaded query={asset}>{a=>
    <Panel title={a.revealStatus==='revealed'?'Revealed metadata':'Awaiting reveal'}>
      <Facts items={[['Collection',a.inventoryId],['Owner',a.owner],['Status',a.revealStatus],
        ...(a.revealStatus==='revealed'?[['Level',a.level],['Model',a.traits?.model],['Backdrop',a.traits?.backdrop],['Symbol',a.traits?.symbol]] as [string,React.ReactNode][]:[])]}/>
      <AssetEvidence asset={a}/>{a.revealStatus==='revealed'&&<p><Link to="/vault" search={{asset:a.id}}>View Vault allocations ↗</Link></p>}
    </Panel>}</Loaded><ShareLink path={'/nfts/'+encodeURIComponent(assetId)} title={'NFT · '+assetId}/></>;
}
export function CanonicalBoard(){
  const {epochId}=useParams({from:'/earn/$epochId'});
  if(!z.iso.date().safeParse(epochId).success)return <><Hero title="Board not found">Use a UTC calendar date to find a board.</Hero><Link to="/earn">Daily leaderboard →</Link></>;
  return <Earn epochId={epochId}/>;
}
