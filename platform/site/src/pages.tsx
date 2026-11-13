import {CategoryCompetition,RewardSummary} from './performance';
import {Diagnostics,TokenArt,Journey,useExperience,ProgressBar} from './experience';
import { useRuntimeQuery } from './capabilities';
import { useEffect,useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { rootRoute } from './routes';
import { sdk } from './sdk';
import { compact, Empty, Facts, Hero, Loaded, Metrics, MobileRecords, Panel, percent, pretty, usePageMeta, utc } from './common';
import { useSession } from './session';

function VaultRows({id,cursor}:{id:string;cursor?:string}){
  const {technical}=useExperience(),[shown,setShown]=useState(6);
  useEffect(()=>setShown(6),[id,cursor]);
  const cache=useQueryClient();
  const detail=useRuntimeQuery('/api/v1/nfts/{id}/vault',{queryKey:['nft-vault',id,cursor],queryFn:({signal})=>sdk.nftVault(id,cursor,signal)});
  return <Panel title={'Allocations for '+id}><Loaded query={detail} restart={<Link to="/airdrops" search={{asset:id}} onClick={()=>cache.removeQueries({queryKey:['nft-vault',id,undefined],exact:true})}>Restart allocations</Link>}>{page=><>
    {page.items.length?<><MobileRecords entries={page.items.slice(0,technical?page.items.length:shown).map(i=>({id:i.marketId,summary:i.marketId+' · '+i.claimable+' base units available',
      facts:[['Allocation',i.allocated],['Vested',i.vested],['Claimed',i.claimed],['Available',i.claimable],['Manifest digest',i.manifestDigest],['Original activation',i.activatedAt?utc(i.activatedAt):'Unavailable'],['Cliff ends',i.cliffEndsAt?utc(i.cliffEndsAt):'Unavailable'],['Fully vested',i.fullyVestedAt?utc(i.fullyVestedAt):'Unavailable']]}))}/>
    <div className="scroller wide-table"><table><caption>Token base units · {utc(page.asOf)}</caption>
      <thead><tr>{['Campaign','Allocation','Vested','Claimed','Available'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>
        {page.items.slice(0,technical?page.items.length:shown).map(item=><tr key={item.marketId}><td>{item.marketId}</td><td>{item.allocated}</td>
          <td>{item.vested}</td><td>{item.claimed}</td><td>{item.claimable}</td></tr>)}</tbody></table></div></>
      :<Empty title="No allocation rows">New launch allocations appear under the corresponding ATT.</Empty>}
    {page.items.length>0&&<Diagnostics><details><summary>Original allocation vesting clocks</summary><Facts items={page.items.map(i=>[i.marketId,
      'Activated '+(i.activatedAt?utc(i.activatedAt):'unavailable')+' · cliff ends '+(i.cliffEndsAt?utc(i.cliffEndsAt):'unavailable')+' · fully vested '+(i.fullyVestedAt?utc(i.fullyVestedAt):'unavailable')])}/></details></Diagnostics>}
    <Diagnostics><p>Owner evidence observed: {page.ownerObservedAt?utc(page.ownerObservedAt):'Unavailable'}.</p><p>Amounts are token base units, not fiat values. Fiat pricing is unavailable. This paginated view does not establish a complete combined balance.</p></Diagnostics>
    {!technical&&shown<page.items.length&&<button onClick={()=>setShown(n=>n+6)}>Show more allocations ({shown} of {page.items.length})</button>}
    {page.nextCursor && <Link to="/airdrops" search={{asset:id,cursor:String(page.nextCursor)}}>Next allocations →</Link>}
  </>}</Loaded></Panel>;
}
export function Vault(){
  const {technical}=useExperience();
  const cache=useQueryClient();
  usePageMeta('Airdrops','NFT allocations, vesting and historical ATT claims.','/airdrops');
  const {asset,cursor}=rootRoute.useSearch();
  const {wallet,open}=useSession();
  const [shownHoldings,setShownHoldings]=useState(6),[shownRewards,setShownRewards]=useState(6);
  useEffect(()=>{setShownHoldings(6);setShownRewards(6);},[wallet,asset,cursor]);
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const holdings=useRuntimeQuery('/api/v1/vault',{queryKey:['private',wallet,'solana','vault',asset?'':cursor],enabled:!!wallet,
    queryFn:({signal})=>sdk.myVault(asset?undefined:cursor,signal)});
  return <>
    <Hero title="Airdrops">Every reward, one place. Track your lifetime awards and what’s available to claim.</Hero>
    <Journey steps={[['Take part','Collect NFTs, stake ATT or create eligible content.'],['Track your awards','See lifetime token awards across all three categories.'],['Check what’s available','Claimable amounts and vesting stay separate from valuations.']]}/>
    <Loaded query={policy}>{p=><Metrics items={[
      ['Genesis allocation',percent(p.launch.allocationBps.genesisVault),'of each launch'],
      ['Season allocation',percent(p.launch.allocationBps.seasonVault),'while Season weight is active'],
      ['Vesting period',pretty(p.vault.vestHours)+'h','after a '+p.vault.cliffHours+'h cliff'],
    ]}/>}</Loaded>
    {wallet&&<RewardSummary wallet={wallet}/>}
    <Panel title="Your NFT allocations">{wallet?<Loaded query={holdings} restart={<Link to="/airdrops" search={{}} onClick={()=>cache.removeQueries({queryKey:['private',wallet,'solana','vault',undefined],exact:true})}>Restart holdings</Link>}>{page=><>
      <Diagnostics><p className="muted">Local holdings for {compact(wallet)} · projection as of {utc(page.asOf)}. This is a local fixture ledger, not verified chain coverage.</p></Diagnostics>
      {page.items.length?<ul className="rows vault-holdings">{page.items.slice(0,technical?page.items.length:shownHoldings).map(nft=><li key={nft.id}><Link to="/airdrops" search={{asset:nft.id}}>
        <TokenArt name={nft.id}/><strong>{nft.id}</strong><span>View airdrops →</span></Link></li>)}</ul>:<Empty title="No NFT holdings">This wallet has no assets in the local Vault ledger.</Empty>}
      {!technical&&shownHoldings<page.items.length&&<button onClick={()=>setShownHoldings(n=>n+6)}>Show more holdings ({shownHoldings} of {page.items.length})</button>}
      <h3>{technical?'Combined local Vault allocations':'Your token rewards'}</h3>
      {page.summary?.status==='complete'?<><Diagnostics><p>Complete local ledger snapshot across {page.summary.assetCount} owned NFTs as of {utc(page.summary.asOf)}. Token base units are separate for each campaign; fiat prices are unavailable.</p></Diagnostics>
        {technical?<Facts items={page.summary.items.map(i=>[i.marketId,i.allocated+' allocated · '+i.vested+' vested · '+i.claimed+' claimed · '+i.claimable+' available base units'])}/>:<div className="position-grid vault-rewards">{page.summary.items.slice(0,shownRewards).map(i=><article className="position-card" key={i.marketId}><TokenArt name={i.marketId}/><h3>{i.marketId}</h3><strong>{BigInt(i.claimable).toLocaleString()} available</strong><ProgressBar value={i.vested} total={i.allocated} label={'Unlocked rewards for '+i.marketId}/><small>Raw token units · {BigInt(i.claimed).toLocaleString()} already collected</small></article>)}</div>}
        {!technical&&shownRewards<page.summary.items.length&&<button onClick={()=>setShownRewards(n=>n+6)}>Show more token rewards ({shownRewards} of {page.summary.items.length})</button>}
      </>:<p>Combined amounts unavailable: {page.summary?.reason??'complete snapshot not supplied'}. No visible-page subtotal is presented.</p>}
      {!asset&&page.nextCursor && <Link to="/airdrops" search={{cursor:String(page.nextCursor)}}>Next holdings →</Link>}
    </>}</Loaded>:<><p>Connect a wallet to see its Genesis and Season assets.</p><button onClick={open}>Connect wallet</button></>}</Panel>
    <p className="muted">Selling an NFT transfers its remaining rewards. Season expiry does not erase past allocations.</p>
    {asset && <VaultRows id={asset} cursor={cursor}/>}
    <Diagnostics><div className="two-up"><Panel title="How claims vest"><Loaded query={policy}>{p=><ol className="timeline">
      <li><strong>Launch</strong><p>Allocations follow each NFT’s Level, including reserved unminted slots.</p></li>
      <li><strong>After {p.vault.cliffHours} hours</strong><p>The allocation begins to vest continuously.</p></li>
      <li><strong>After {p.vault.cliffHours+p.vault.vestHours} hours</strong><p>The entire allocation is vested.</p></li>
    </ol>}</Loaded></Panel>
      <Panel title="Permanent claims"><p>The original vesting clock follows the allocation. Selling an NFT transfers its remaining Vault entitlement. Season expiry and Level changes preserve historical allocations; they do not restart vesting or restore already claimed amounts.</p>
        <Link to="/nfts">Explore collections ↗</Link></Panel></div></Diagnostics>
    <CategoryCompetition category="airdrops"/>
  </>;
}
export function Stake(){
  const {technical}=useExperience();
  const cache=useQueryClient();
  usePageMeta('Stake','Continuous same-token campaign rewards and recorded staking positions.','/stake');
  const {farm,cursor,campaigns}=rootRoute.useSearch(),{wallet,open}=useSession();
  const [shownCampaigns,setShownCampaigns]=useState(6),[shownPositions,setShownPositions]=useState(6);
  useEffect(()=>setShownCampaigns(6),[campaigns]);
  useEffect(()=>setShownPositions(6),[wallet,cursor]);
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const catalog=useRuntimeQuery('/api/v1/markets',{queryKey:['markets',campaigns],queryFn:({signal})=>sdk.markets(campaigns,signal)});
  const detail=useRuntimeQuery('/api/v1/farms/{id}',{queryKey:['farm',farm],enabled:!!farm,queryFn:({signal})=>sdk.farm(farm!,signal)});
  const positions=useRuntimeQuery('/api/v1/stake/positions',{queryKey:['private',wallet,'solana','stake',cursor],enabled:!!wallet,
    queryFn:({signal})=>sdk.positions(cursor,signal)});
  return <>
    <Hero title="Stake">Stake an ATT during its campaign to earn rewards in that same token.</Hero>
    <Journey steps={[['Choose an ATT','Open its campaign and review the reward terms.'],['Stake to participate','A corresponding $10 stake is required for Earn at entry and cutoff.'],['Track your rewards','View your positions and compare lifetime staking awards.']]}/>
    <Loaded query={policy}>{p=><Metrics items={[
      ['Farm funding',percent(p.launch.allocationBps.stake),'of original ATT supply'],
      ['Campaign length',pretty(p.launch.campaignDays)+' days','from actual activation'],
      ['Accrual','Continuous','while the position is staked'],
    ]}/>}</Loaded>
    <Panel title="Find a token to stake"><Loaded query={catalog}>{page=>page.items.length?
      <><ul className="rows stake-campaigns">{page.items.slice(0,technical?page.items.length:shownCampaigns).map(row=><li key={row.id}><Link to="/stake" search={{farm:row.id,cursor,campaigns}}>
        <TokenArt name={row.symbol}/><strong>{row.symbol}</strong><span>View campaign →</span></Link></li>)}</ul>{!technical&&shownCampaigns<page.items.length&&<button onClick={()=>setShownCampaigns(n=>n+6)}>Show more campaigns ({shownCampaigns} of {page.items.length})</button>}
        <div className="board-pagination">{campaigns&&<Link to="/stake" search={{farm,cursor}}>First campaigns →</Link>}{page.nextCursor&&<Link to="/stake" search={{farm,cursor,campaigns:page.nextCursor}}>Next campaigns →</Link>}</div></>:<Empty title="No campaigns available"/>}</Loaded>
      {farm && <Loaded query={detail}>{f=><><h3>{f.marketId} · {f.status}</h3><Facts items={[
        ['Funded units',f.fundedUnits],['Total staked units',f.totalStakedUnits??'Pending'],['Harvest treasury fee',percent(f.treasuryFeeBps)],['Emissions end',utc(f.emissionEnd)],
      ]}/></>}</Loaded>}</Panel>
    <Panel title="Your positions"><p className="status-pill">Demo balances · Deposits and withdrawals are not enabled</p>{wallet?<Loaded query={positions} restart={<Link to="/stake" search={{farm,campaigns}} onClick={()=>cache.removeQueries({queryKey:['private',wallet,'solana','stake',undefined],exact:true})}>Restart positions</Link>}>{page=><>
      {page.items.length?technical?<><MobileRecords entries={page.items.map(p=>({id:p.marketId,summary:p.marketId+' · '+p.principalUnits+' base units staked',
        facts:[['Principal',p.principalUnits],['Earned gross',p.earnedGrossUnits],['Available gross',p.claimableGrossUnits],['Harvested gross',p.harvestedGrossUnits]]}))}/>
      <div className="scroller wide-table"><table><caption>Local positions · amounts in token base units</caption>
        <thead><tr>{['Campaign','Principal','Earned gross','Available gross','Harvested gross'].map(s=><th key={s}>{s}</th>)}</tr></thead>
        <tbody>{page.items.map(p=><tr key={p.marketId}><td><Link to="/stake" search={{farm:p.marketId,cursor,campaigns}}>{p.marketId}</Link></td><td>{p.principalUnits}</td>
          <td>{p.earnedGrossUnits}</td><td>{p.claimableGrossUnits}</td><td>{p.harvestedGrossUnits}</td></tr>)}</tbody></table></div></>:<div className="position-grid stake-positions">{page.items.slice(0,shownPositions).map(p=><article className="position-card" key={p.marketId}><TokenArt name={p.marketId}/><h3><Link to="/stake" search={{farm:p.marketId,cursor,campaigns}}>{p.marketId}</Link></h3><Facts items={[['Staked',p.principalUnits],['Rewards available before fees',p.claimableGrossUnits],['Rewards collected before fees',p.harvestedGrossUnits]]}/><small>Amounts in raw token units. Harvest fees apply.</small></article>)}</div>:<Empty title="No recorded positions"/>}
      {!technical&&shownPositions<page.items.length&&<button onClick={()=>setShownPositions(n=>n+6)}>Show more positions ({shownPositions} of {page.items.length})</button>}
      {page.nextCursor!==null && <Link to="/stake" search={{farm,campaigns,cursor:String(page.nextCursor)}}>Next positions →</Link>}
    </>}</Loaded>:<><p>Connect a wallet to view recorded stake and harvests.</p><button onClick={open}>Connect wallet</button></>}</Panel>
    <CategoryCompetition category="stake"/>
  </>;
}
