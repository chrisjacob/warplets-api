import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './routes';
import { sdk } from './sdk';
import { compact, Empty, Facts, Hero, Loaded, Metrics, Panel, percent, pretty, utc } from './common';
import { useSession } from './session';

function VaultRows({id,cursor}:{id:string;cursor?:string}){
  const detail=useQuery({queryKey:['nft-vault',id,cursor],queryFn:({signal})=>sdk.nftVault(id,cursor,signal)});
  return <Panel title={'Allocations for '+id}><Loaded query={detail}>{page=><>
    {page.items.length?<div className="scroller"><table><caption>Token base units · {utc(page.asOf)}</caption>
      <thead><tr>{['Campaign','Allocation','Vested','Claimed','Available'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>
        {page.items.map(item=><tr key={item.marketId}><td>{item.marketId}</td><td>{item.allocated}</td>
          <td>{item.vested}</td><td>{item.claimed}</td><td>{item.claimable}</td></tr>)}</tbody></table></div>
      :<Empty title="No allocation rows">New launch allocations appear under the corresponding ATT.</Empty>}
    {page.nextCursor && <Link to="/vault" search={{asset:id,cursor:page.nextCursor}}>Next allocations →</Link>}
  </>}</Loaded></Panel>;
}
export function Vault(){
  const {asset,cursor}=rootRoute.useSearch();
  const {wallet,open}=useSession();
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const holdings=useQuery({queryKey:['private',wallet,'vault',asset?'':cursor],enabled:!!wallet,
    queryFn:({signal})=>sdk.myVault(asset?undefined:cursor,signal)});
  return <>
    <Hero title="Vault">Genesis and active Season NFTs accrue a share of each ATT launch.</Hero>
    <Loaded query={policy}>{p=><Metrics items={[
      ['Genesis allocation',percent(p.launch.allocationBps.genesisVault),'of each launch'],
      ['Season allocation',percent(p.launch.allocationBps.seasonVault),'while Season weight is active'],
      ['Vesting period',pretty(p.vault.vestHours)+'h','after a '+p.vault.cliffHours+'h cliff'],
    ]}/>}</Loaded>
    <Panel title="Your NFTs">{wallet?<Loaded query={holdings}>{page=><>
      <p className="muted">Local holdings for {compact(wallet)}</p>
      {page.items.length?<ul className="rows">{page.items.map(nft=><li key={nft.id}><Link to="/vault" search={{asset:nft.id}}>
        <strong>{nft.id}</strong><span>View allocations ↗</span></Link></li>)}</ul>:<Empty title="No NFT holdings">This wallet has no assets in the local Vault ledger.</Empty>}
      {!asset&&page.nextCursor && <Link to="/vault" search={{cursor:page.nextCursor}}>Next holdings →</Link>}
    </>}</Loaded>:<><p>Connect a wallet to see its Genesis and Season assets.</p><button onClick={open}>Connect wallet</button></>}</Panel>
    {asset && <VaultRows id={asset} cursor={cursor}/>}
    <div className="two-up"><Panel title="How claims vest"><Loaded query={policy}>{p=><ol className="timeline">
      <li><strong>Launch</strong><p>Allocations follow each NFT’s Level, including reserved unminted slots.</p></li>
      <li><strong>After {p.vault.cliffHours} hours</strong><p>The allocation begins to vest continuously.</p></li>
      <li><strong>After {p.vault.cliffHours+p.vault.vestHours} hours</strong><p>The entire allocation is vested.</p></li>
    </ol>}</Loaded></Panel>
      <Panel title="Permanent claims"><p>The original vesting clock follows the allocation. Selling an NFT transfers its remaining Vault entitlement.</p>
        <Link to="/collect">Explore collections ↗</Link></Panel></div>
  </>;
}
export function Stake(){
  const {farm,cursor}=rootRoute.useSearch(),{wallet,open}=useSession();
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const catalog=useQuery({queryKey:['markets',undefined],queryFn:({signal})=>sdk.markets(undefined,signal)});
  const detail=useQuery({queryKey:['farm',farm],enabled:!!farm,queryFn:({signal})=>sdk.farm(farm!,signal)});
  const positions=useQuery({queryKey:['private',wallet,'stake',cursor],enabled:!!wallet,
    queryFn:({signal})=>sdk.positions(cursor,signal)});
  return <>
    <Hero title="Stake">Stake an ATT during its campaign to earn rewards in that same token.</Hero>
    <Loaded query={policy}>{p=><Metrics items={[
      ['Farm funding',percent(p.launch.allocationBps.stake),'of original ATT supply'],
      ['Campaign length',pretty(p.launch.campaignDays)+' days','from actual activation'],
      ['Accrual','Continuous','while the position is staked'],
    ]}/>}</Loaded>
    <Panel title="Farm directory"><Loaded query={catalog}>{page=>page.items.length?
      <ul className="rows">{page.items.map(row=><li key={row.id}><Link to="/stake" search={{farm:row.id}}>
        <strong>{row.symbol}</strong><span>Inspect farm ↗</span></Link></li>)}</ul>:<Empty title="No campaigns available"/>}</Loaded>
      {farm && <Loaded query={detail}>{f=><><h3>{f.marketId} · {f.status}</h3><Facts items={[
        ['Funded units',f.fundedUnits],['Total staked units',f.totalStakedUnits??'Pending'],['Harvest treasury fee',percent(f.treasuryFeeBps)],['Emissions end',utc(f.emissionEnd)],
      ]}/></>}</Loaded>}</Panel>
    <Panel title="Your positions">{wallet?<Loaded query={positions}>{page=><>
      {page.items.length?<div className="scroller"><table><caption>Local positions · amounts in token base units</caption>
        <thead><tr>{['Campaign','Principal','Earned gross','Available gross','Harvested gross'].map(s=><th key={s}>{s}</th>)}</tr></thead>
        <tbody>{page.items.map(p=><tr key={p.marketId}><td><Link to="/stake" search={{farm:p.marketId}}>{p.marketId}</Link></td><td>{p.principalUnits}</td>
          <td>{p.earnedGrossUnits}</td><td>{p.claimableGrossUnits}</td><td>{p.harvestedGrossUnits}</td></tr>)}</tbody></table></div>:<Empty title="No recorded positions"/>}
      {page.nextCursor!==null && <Link to="/stake" search={{cursor:String(page.nextCursor)}}>Next positions →</Link>}
    </>}</Loaded>:<><p>Connect a wallet to view recorded stake and harvests.</p><button onClick={open}>Connect wallet</button></>}</Panel>
  </>;
}
