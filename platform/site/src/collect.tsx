import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rootRoute } from './routes';
import { client, sdk, type ProgressionRequest } from './sdk';
import type { Asset, Ballot, Inventory, ProgressQuote, Receipt, Stage } from './models';
import { Empty, Facts, friendlyError, Hero, intentKey, Loaded, Modal, Panel, pretty, Signal, sol, utc } from './common';
import { useSession } from './session';

const choiceLabel=(value:string)=>value==='ASAP'?'As soon as possible':value+' days';
type VoteChoice='ASAP'|'7'|'14'|'30';

function BallotCard({ballot,wallet}:{ballot:Ballot;wallet:string|null}){
  const cache=useQueryClient(),{open}=useSession();
  const vote=useMutation({mutationFn:async(choice:VoteChoice)=>
    (await client.castGenesisVote({path:{id:ballot.id},body:{choice}})).data,
  onSuccess:()=>cache.invalidateQueries({queryKey:['ballots']})});
  return <article className="record"><div className="entry-head"><h3>{ballot.id}</h3><span>{ballot.status}</span></div>
    <p>{ballot.votesCast} votes from {ballot.eligibleWallets} eligible wallets. {ballot.status==='scheduled'?'Opens '+utc(ballot.opensAt):'Closes '+utc(ballot.closesAt)}.</p>
    {ballot.status==='open' && (wallet?<form onSubmit={event=>{
      event.preventDefault();const value=String(new FormData(event.currentTarget).get('choice'));
      if(['ASAP','7','14','30'].includes(value))vote.mutate(value as VoteChoice);
    }}><fieldset disabled={vote.isPending||vote.isSuccess}><legend>When should the next tranche open?</legend>
      {ballot.choices.map(choice=><label className="radio" key={choice}><input type="radio" name="choice" value={choice} required/>{choiceLabel(choice)}</label>)}
      <button>Submit advisory vote</button></fieldset><output aria-live="polite">{vote.data?'Recorded your vote: '+choiceLabel(vote.data.choice)+'.':vote.error?friendlyError(vote.error):''}</output>
    </form>:<button onClick={open}>Connect wallet</button>)}
    {ballot.counts && <Facts items={ballot.choices.map(c=>[choiceLabel(c),ballot.counts![c]])}/>}
    {ballot.decision && <p><strong>Founder decision · {choiceLabel(ballot.decision.choice)}</strong><br/>{ballot.decision.rationale}<br/>
      Earliest opening: {utc(ballot.decision.earliestOpening)}.</p>}
  </article>;
}
type Review={kind:'mint';inventory:Inventory;stage:Stage} | {kind:'progress';asset:Asset;materialId?:string};
function ReviewOperation({review,wallet,onClose}:{review:Review;wallet:string;onClose:()=>void}){
  const navigate=useNavigate(),cache=useQueryClient();
  const quote=useQuery({queryKey:['private',wallet,'quote',review],enabled:review.kind==='progress',staleTime:0,
    queryFn:async()=>{
      if(review.kind!=='progress')throw Error('Select an asset.');
      const req:ProgressionRequest={kind:review.materialId?'upgrade':'visual',targetId:review.asset.id,
        expectedTargetVersion:review.asset.version!};
      if(review.materialId){
        const material=await sdk.asset(review.materialId);
        if(material.version===undefined)throw Error('The material NFT must be revealed.');
        req.materialId=material.id;req.expectedMaterialVersion=material.version;
      }
      const result=await sdk.quote(review.asset.inventoryId,req);
      return {req,result};
    }});
  const confirm=useMutation({mutationFn:async():Promise<Receipt>=>{
    if(review.kind==='mint'){
      const body={inventory:review.inventory.id,stage:review.stage.id};
      const intent=intentKey(wallet,'mint',body);
      const receipt=await sdk.mint(body.inventory,body.stage,intent.key);
      intent.done();return receipt;
    }
    if(!quote.data)throw Error('Refresh the operation quote.');
    const intent=intentKey(wallet,'progress:'+review.asset.inventoryId,quote.data.req);
    const receipt=await sdk.progress(review.asset.inventoryId,quote.data.req,intent.key);
    intent.done();return receipt;
  },onSuccess:async op=>{
    await Promise.all([cache.invalidateQueries({queryKey:['private',wallet]}),cache.invalidateQueries({queryKey:['inventories']})]);
    onClose();await navigate({to:'/collect',search:{receipt:op.id}});
  }});
  return <Modal id="collection-dialog" title={review.kind==='mint'?'Review mint reservation':review.materialId?'Review Level upgrade':'Review visual reroll'} onClose={onClose}>
    {review.kind==='mint'?<><Facts items={[['Collection',review.inventory.id],['Stage',review.stage.id],['Mint price',sol(review.stage.priceLamports)],
      ['Creation and network quote',sol(review.stage.costLamports)],['Wallet limit',review.stage.walletLimit]]}/>
      <p>Reserve one local slot and wait for its committed draw. Your wallet pays no SOL in this preview.</p></>
      :<Loaded query={quote}>{q=><QuoteDetails quote={q.result}/>}</Loaded>}
    <button disabled={confirm.isPending || (review.kind==='progress' && !quote.data)} onClick={()=>confirm.mutate()}>
      {review.kind==='mint'?'Reserve preview slot':'Record preview request'}</button>
    {confirm.error&&<Signal>{friendlyError(confirm.error)}</Signal>}
  </Modal>;
}
function QuoteDetails({quote:q}:{quote:ProgressQuote}){
  const facts:Array<[string,React.ReactNode]>=[['Target',q.targetId],['Fee quote',sol(q.feeLamports)]];
  if(q.kind==='visual')facts.push(['Traits replaced',q.fields?.join(', ')],['Cooldown after fulfillment',(q.cooldownMs??0)/3_600_000+' hours']);
  else facts.push(['Material NFT',q.materialId],['New target Level',q.nextTargetLevel],['Target expiry',q.nextTargetExpiry&&utc(q.nextTargetExpiry)]);
  return <><Facts items={facts}/>
    {q.materialProbabilities&&<details><summary>Material Level probabilities</summary>
      <Facts items={q.materialProbabilities.map(row=>['Level '+row.level,row.count+' of '+row.total])}/></details>}
    <p>The selected assets remain reserved locally until the committed result arrives.</p></>;
}

function CollectionTerms(){
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  return <Loaded query={policy}>{p=><div className="two-up"><Panel className="collection-card">
    <div className="cover genesis" aria-hidden="true">G<span>/</span></div><h2>Genesis</h2>
    <p>Permanent Vault eligibility with an immutable Level from 1 to 10.</p>
    <Facts items={[['Maximum supply',pretty(p.genesis.cap)],['Per tranche',pretty(p.genesis.trancheSize)],
      ['First whitelist price',p.genesis.firstWhitelistPriceSol+' SOL'],['Eligible wallet',p.genesis.mintsPerEligibleWalletPerStage+' mint per stage']]}/>
    <details><summary>Tranche voting</summary><p>Genesis holders and the next stage’s whitelist can vote for {p.genesis.ballotHours} hours.
      Each eligible wallet gets {p.genesis.votesPerWallet} vote.</p></details></Panel>
    <Panel className="collection-card"><div className="cover season" aria-hidden="true">S<span>/</span></div><h2>Seasons</h2>
      <p>Benefit duration follows the current Level, measured from the published Season start.</p>
      <Facts items={[['Monthly supply',pretty(p.season.monthlyCap)],['Free stage','Revealed Genesis 1X'],
        ['Eligible wallet',p.season.freeMintsPerEligibleWallet+' free mint']]}/>
      <details><summary>Upgrades and visual rerolls</summary><p>Pair two same-Level NFTs from one Season to raise the target’s Level.
        The other NFT receives a Level draw. Visual rerolls replace Model, Backdrop and Symbol.</p></details></Panel></div>}</Loaded>;
}

function PublishedStage({inventory,stage,review}:{inventory:Inventory;stage:Stage;review:(review:Review)=>void}){
  const {wallet,open}=useSession();
  const canReserve=stage.status==='open' && stage.type!=='founder' && stage.available>0;
  return <article className="stage"><div className="entry-head"><h4>{stage.id}</h4><span>{stage.status}</span></div>
    <Facts items={[['Mint price',sol(stage.priceLamports)],['Creation and network quote',sol(stage.costLamports)],
      ['Slots available',stage.available],['Limit per wallet',stage.walletLimit],['Opens',utc(stage.opensAt)],['Closes',utc(stage.closesAt)]]}/>
    {canReserve && (wallet?(stage.eligible?(stage.walletReservations??0)<stage.walletLimit?
      <button onClick={()=>review({kind:'mint',inventory,stage})}>Review reservation</button>:<p>The wallet limit for this stage has been reached.</p>
      :<p>This wallet is outside the stage eligibility list.</p>):<button onClick={open}>Connect wallet</button>)}
    {stage.openingHold&&<p>{stage.openingHold}</p>}</article>;
}
function MemberAssets({wallet,review}:{wallet:string;review:(review:Review)=>void}){
  const search=rootRoute.useSearch();
  const assets=useQuery({queryKey:['private',wallet,'collection-assets',search.owned],queryFn:({signal})=>sdk.assets(search.owned,signal)});
  const operations=useQuery({queryKey:['private',wallet,'collection-operations',search.operations],queryFn:({signal})=>sdk.receipts(search.operations,signal)});
  const receipt=useQuery({queryKey:['private',wallet,'collection-receipt',search.receipt],enabled:!!search.receipt,
    queryFn:({signal})=>sdk.receipt(search.receipt!,signal)});
  return <>
    <Panel title="Your collection"><Loaded query={assets}>{page=><>
      {!page.items.length && <Empty title="No local collection assets"/>}
      {page.items.map(asset=><article className="record" key={asset.id}><h3>{asset.id}</h3><p>{asset.inventoryId} · {asset.revealStatus}</p>
        {asset.revealStatus==='revealed' && <><Facts items={[['Level',asset.level],['Model',asset.traits?.model],['Backdrop',asset.traits?.backdrop],
          ['Symbol',asset.traits?.symbol],['Benefit expiry',asset.expiresAt?utc(asset.expiresAt):'Permanent']]}/>
          {asset.operationPending?<p>Awaiting committed draw evidence.</p>:asset.expiresAt&&<>
            <button onClick={()=>review({kind:'progress',asset})}>Preview visual reroll</button>
            {asset.level!<10&&<form className="member-form" data-upgrade={asset.id} onSubmit={event=>{
              event.preventDefault();review({kind:'progress',asset,materialId:String(new FormData(event.currentTarget).get('material'))});
            }}><label>Same-Level material NFT ID<input name="material" list="known-materials" required maxLength={128}/></label><button>Preview upgrade</button></form>}</>}
          <Link to="/vault" search={{asset:asset.id}}>Vault allocations ↗</Link></>}
      </article>)}
      <datalist id="known-materials">{page.items.filter(a=>a.expiresAt && !a.operationPending).map(a=><option key={a.id} value={a.id}/>)}</datalist>
      {page.nextCursor!==null&&<Link to="/collect" search={{owned:String(page.nextCursor)}}>Next assets →</Link>}
    </>}</Loaded></Panel>
    <Panel title="Operation history">{search.receipt && <Loaded query={receipt}>{r=><article className="receipt"><h3>Operation receipt</h3>
      <Facts items={[['ID',r.id],['State',r.status],['Requested',utc(r.createdAt)],['Action',r.kind],['Collection',r.inventoryId],
        ['Recorded price',sol(r.priceLamports??r.feeLamports)],['Result NFT',r.assetId??'Pending']]}/></article>}</Loaded>}
      <Loaded query={operations}>{page=><>{page.items.length?<ul className="rows">{page.items.map(op=><li key={op.id}><Link to="/collect" search={{receipt:op.id}}>
        <strong>{op.kind} · {op.inventoryId}</strong><span>{op.status} ↗</span></Link></li>)}</ul>:<p>No operations for this wallet.</p>}
        {page.nextCursor!==null&&<Link to="/collect" search={{operations:String(page.nextCursor)}}>Next operations →</Link>}</>}</Loaded></Panel>
  </>;
}
export function Collect(){
  const {wallet}=useSession(),search=rootRoute.useSearch();
  const [review,setReview]=useState<Review|null>(null);
  const inventories=useQuery({queryKey:['inventories',wallet,search.inventories],queryFn:({signal})=>sdk.inventories(search.inventories,signal)});
  const ballots=useQuery({queryKey:['ballots'],queryFn:({signal})=>sdk.ballots(signal)});
  return <>
    <Hero title="Collect">Explore permanent Genesis membership and monthly Season collections.</Hero>
    <CollectionTerms/>
    <Panel title="Published stages"><Loaded query={inventories}>{page=><>
      {!page.items.length&&<Empty title="No published stages"/>}
      {page.items.map(inv=><article key={inv.id} className="record"><h3>{inv.id}</h3>
        <p>{inv.counts.unsold} slots remain · {inv.counts.pending} awaiting fulfillment · {inv.counts.paid} paid mints</p>
        {inv.stages.map(s=><PublishedStage key={s.id} inventory={inv} stage={s} review={setReview}/>)}</article>)}
      {page.nextCursor!==null&&<Link to="/collect" search={{inventories:String(page.nextCursor)}}>Next collections →</Link>}
    </>}</Loaded></Panel>
    {wallet&&<MemberAssets key={wallet} wallet={wallet} review={setReview}/>}
    <Panel title="Genesis ballots"><Loaded query={ballots}>{page=>page.items.length?page.items.map(b=>
      <BallotCard key={b.id+(wallet??'')} wallet={wallet} ballot={b}/>):<Empty title="No published ballots"/>}</Loaded></Panel>
    {wallet&&review&&<ReviewOperation wallet={wallet} review={review} onClose={()=>setReview(null)}/>}
  </>;
}
