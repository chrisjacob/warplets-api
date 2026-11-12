import {Diagnostics,NftArt,Journey,useExperience} from './experience';
import {AssetEvidence,InventoryEvidence,StageEvidence,eligibleMaterials} from './collection-details';
import {ProgressionAssetContext} from './progression-review';
import {CollectionOperationHold,CollectionOperationFairness} from './collection-operation';
import { Capability, useRuntimeQuery, useCapability, principalKey } from './capabilities';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rootRoute } from './routes';
import { client, sdk, PlatformApiError, type ProgressionRequest } from './sdk';
import {progressionJournal,matchesProgressionReceipt,type ProgressionAttempt,type ProgressionJournalEntry} from './progression-intent';
import {mintJournal,mintReviewAvailable,matchesMintReceipt,type MintAttempt,type MintJournalEntry} from './mint-intent';
import type { Asset, Ballot, Inventory, ProgressQuote, Receipt, Stage } from './models';
import { Empty, Facts, friendlyError, Hero, Loaded, Modal, Panel, pretty, Signal, sol, usePageMeta, utc } from './common';
import { useSession } from './session';

const choiceLabel=(value:string)=>value==='ASAP'?'As soon as possible':value+' days';
type VoteChoice='ASAP'|'7'|'14'|'30';

export function BallotCard({ballot,wallet}:{ballot:Ballot;wallet:string|null}){
  const cache=useQueryClient(),{open}=useSession();
  const vote=useMutation({mutationFn:async(choice:VoteChoice)=>
    (await client.castGenesisVote({path:{id:ballot.id},body:{choice}})).data,
  onSuccess:()=>cache.invalidateQueries({queryKey:['ballots']})});
  return <article className="record"><div className="entry-head"><h3>{ballot.id}</h3><span>{ballot.status}</span></div>
    <p>{ballot.votesCast} votes from {ballot.eligibleWallets} eligible wallets. {ballot.status==='scheduled'?'Opens '+utc(ballot.opensAt):'Closes '+utc(ballot.closesAt)}.</p>
    {ballot.status==='open' && <Capability method="POST" path="/api/v1/genesis/ballots/{id}/votes">{(wallet?<form onSubmit={event=>{
      event.preventDefault();const value=String(new FormData(event.currentTarget).get('choice'));
      if(['ASAP','7','14','30'].includes(value))vote.mutate(value as VoteChoice);
    }}><fieldset disabled={vote.isPending||vote.isSuccess}><legend>When should the next tranche open?</legend>
      {ballot.choices.map(choice=><label className="radio" key={choice}><input type="radio" name="choice" value={choice} required/>{choiceLabel(choice)}</label>)}
      <button>Submit advisory vote</button></fieldset><output aria-live="polite">{vote.data?'Recorded your vote: '+choiceLabel(vote.data.choice)+'.':vote.error?friendlyError(vote.error):''}</output>
    </form>:<button onClick={open}>Connect wallet</button>)}</Capability>}
    {ballot.counts && <Facts items={ballot.choices.map(c=>[choiceLabel(c),ballot.counts![c]])}/>}
    {ballot.decision && <p><strong>Founder decision · {choiceLabel(ballot.decision.choice)}</strong><br/>{ballot.decision.rationale}<br/>
      Earliest opening: {utc(ballot.decision.earliestOpening)}.</p>}
  </article>;
}
type Review={kind:'mint';inventory:Pick<Inventory,'id'>;stage:Stage} | {kind:'progress';asset:Asset;materialId?:string};
type QuoteSelection={req:ProgressionRequest;target:Asset;material?:Asset};
function ReviewOperation({review,wallet,onClose}:{review:Review;wallet:string;onClose:()=>void}){
  const navigate=useNavigate(),cache=useQueryClient(),mounted=useRef(true),attempt=useRef<ProgressionAttempt|null>(null),mintAttempt=useRef<MintAttempt|null>(null);
  const journal=useMemo(()=>typeof sessionStorage==='undefined'?null:progressionJournal(sessionStorage,wallet),[wallet]);
  const [pending,setPending]=useState<ProgressionJournalEntry|null>(()=>review.kind==='progress'?journal?.read(review.asset.inventoryId,review.asset.id,review.materialId)??null:null);
  const mintRequests=useMemo(()=>typeof sessionStorage==='undefined'?null:mintJournal(sessionStorage,wallet),[wallet]);
  const [pendingMint,setPendingMint]=useState<MintJournalEntry|null>(()=>review.kind==='mint'?mintRequests?.read(review.inventory.id,review.stage.id)??null:null);
  const [quoteSession,setQuoteSession]=useState<{key:string;allowUpdated:boolean;captured?:QuoteSelection}>(()=>({key:crypto.randomUUID(),allowUpdated:false}));
  const [now,setNow]=useState(Date.now),[needsRefresh,setNeedsRefresh]=useState(false);
  const reserveCapability=useCapability('POST','/api/v1/collect/inventories/{id}/progression');
  const mintCapability=useCapability('POST','/api/v1/collect/inventories/{id}/stages/{stage}/reservations');
  useEffect(()=>{mounted.current=true;const interval=setInterval(()=>setNow(Date.now()),500);return()=>{mounted.current=false;clearInterval(interval);};},[]);
  const quote=useRuntimeQuery('/api/v1/collect/assets/{id}',{queryKey:['private',wallet,'solana','progression-quote',quoteSession.key],enabled:review.kind==='progress'&&!pending,staleTime:Infinity,retry:false,refetchOnWindowFocus:false,refetchOnMount:false,
    queryFn:async({signal})=>{
      if(review.kind!=='progress')throw Error('Select an asset.');
      if(!quoteSession.captured){
        const target=await sdk.asset(review.asset.id,signal);
        if(target.owner!==wallet||target.revealStatus!=='revealed'||target.version===undefined||(!quoteSession.allowUpdated&&target.version!==review.asset.version))
          throw Error('The target ownership, reveal or version changed. Refresh the selected asset.');
        const req:ProgressionRequest={kind:review.materialId?'upgrade':'visual',targetId:target.id,expectedTargetVersion:target.version};let material:Asset|undefined;
        if(review.materialId){
          material=await sdk.asset(review.materialId,signal);
          if(material.owner!==wallet||material.revealStatus!=='revealed'||material.version===undefined)throw Error('The material ownership or reveal changed. Refresh the selected pair.');
          req.materialId=material.id;req.expectedMaterialVersion=material.version;
        }
        signal.throwIfAborted();quoteSession.captured={req,target,material};
      }
      const captured=quoteSession.captured,result=await sdk.quote(review.asset.inventoryId,captured.req,quoteSession.key,signal);
      return {...captured,result};
    }});
  const reviewed=pending?.kind==='pending'?pending.attempt.quote:quote.data?.result,expired=!!reviewed&&now>=reviewed.quoteExpiresMs;
  const confirm=useMutation({mutationFn:async():Promise<Receipt>=>{
    if(review.kind==='mint'){
      if(!mintRequests)throw Error('This browser cannot retain a recoverable request.');
      if(pendingMint?.kind==='invalid')throw Error('The retained mint request is unreadable. Review existing operation receipts.');
      if(needsRefresh)throw Error('Refresh the published stage before reviewing a new reservation.');
      const captured=pendingMint?.kind==='pending'?pendingMint.attempt:mintRequests.capture(review.inventory.id,review.stage);
      mintAttempt.current=captured;setPendingMint({kind:'pending',name:'',attempt:captured});
      const receipt=await sdk.mint(captured.inventoryId,captured.stageId,captured.body.expectedTermsDigest,captured.key);
      if(!matchesMintReceipt(captured,receipt))throw Error('The response did not match the retained mint request. Retry the original request.');
      mintRequests.complete(captured);return receipt;
    }
    if(!journal)throw Error('This browser cannot retain a recoverable request.');
    if(pending?.kind==='invalid')throw Error('The retained request is unreadable. Review existing operation receipts.');
    if(!pending&&(!quote.data||quote.isError||Date.now()>=quote.data.result.quoteExpiresMs||needsRefresh))throw Error('Refresh the expired or changed quote before confirming.');
    const captured=pending?.kind==='pending'?pending.attempt:journal.capture(quote.data!.result,{target:quote.data!.target,material:quote.data!.material});
    attempt.current=captured;setPending({kind:'pending',name:'',attempt:captured});
    const receipt=await sdk.progress(captured.inventoryId,captured.body,captured.key);
    if(!matchesProgressionReceipt(captured,receipt))throw Error('The response did not match the retained request. Retry the original request.');
    journal.complete(captured);return receipt;
  },onSuccess:async op=>{
    if(!mounted.current)return;
    await Promise.all([cache.invalidateQueries({queryKey:['private',wallet]}),cache.invalidateQueries({predicate:q=>q.queryKey.includes('inventories')})]);
    if(!mounted.current)return;
    onClose();await navigate({to:'/collect',search:{receipt:op.id}});
  },onError:error=>{
    const mintRejected=error instanceof PlatformApiError&&((error.status===409&&['stage_unavailable','stage_wallet_limit','sold_out','mint-window-expired'].includes(error.code))||(error.status===403&&error.code==='wallet_ineligible'));
    if(review.kind==='mint'&&mintRejected&&mintAttempt.current){mintRequests?.complete(mintAttempt.current);mintAttempt.current=null;if(mounted.current){setPendingMint(null);setNeedsRefresh(true);}return;}
    const definitive=error instanceof PlatformApiError&&error.status===409&&(error.code.startsWith('quote-')||['wrong_owner','stale_asset_version','asset_reserved','reroll_cooldown','ineligible_upgrade_level','owner-changed','asset-version-changed','asset-reserved'].includes(error.code));
    if(definitive&&attempt.current){journal?.complete(attempt.current);attempt.current=null;if(mounted.current){setPending(null);setNeedsRefresh(true);}}
  }});
  return <Modal id="collection-dialog" title={review.kind==='mint'?'Review mint reservation':review.materialId?'Review Level upgrade':'Review visual reroll'} onClose={onClose}>
    {review.kind==='mint'?pendingMint?.kind==='invalid'?<Signal>A stored mint request is unreadable. Review existing operation receipts before creating a new request.</Signal>:<>
      <MintTerms inventoryId={review.inventory.id} stage={pendingMint?.kind==='pending'?pendingMint.attempt.stage:review.stage}/>
      {pendingMint?.kind==='pending'?<><Signal>The result of this original mint request is unresolved. Retry its retained key and reviewed terms to recover the result.</Signal>
        {now>=Date.parse(pendingMint.attempt.stage.closesAt)&&<p>The original stage has closed. An identical retry can still recover an already accepted reservation.</p>}</>
        :(needsRefresh||!mintReviewAvailable(review.stage,now))&&<Signal>The stage is no longer available for a new reservation. Close this review and refresh the published stage.</Signal>}</>
      :pending?.kind==='invalid'?<Signal>A stored request is unreadable. Review your existing operation receipts before creating a new request.</Signal>
      :pending?.kind==='pending'?<><QuoteDetails quote={pending.attempt.quote}/><Signal>The result of this original reviewed request is unresolved. Retry its retained key and terms to recover the result.</Signal>
        {expired&&<p>The original quote has expired. An identical retry can still recover an already accepted request.</p>}</>
      :<Loaded query={quote}>{q=><><QuoteDetails quote={q.result}/><Diagnostics><div className="two-up">
        <ProgressionAssetContext asset={q.target} wallet={wallet} label="Target"/>
        {q.material&&<ProgressionAssetContext asset={q.material} wallet={wallet} label="Material"/>}
      </div></Diagnostics></>}</Loaded>}
    {review.kind==='progress'&&!pending&&<>{expired&&<Signal>This quote has expired. Refresh it and review the new terms before confirming.</Signal>}
      {needsRefresh&&<Signal>The request was not accepted. Refresh the quote and review current ownership and terms.</Signal>}
      <button disabled={confirm.isPending} onClick={()=>{confirm.reset();setNeedsRefresh(false);setQuoteSession({key:crypto.randomUUID(),allowUpdated:true});}}>Refresh quote</button></>}
    <button disabled={confirm.isPending || (review.kind==='mint'?(!mintCapability.allowed||pendingMint?.kind==='invalid'||needsRefresh||(!pendingMint&&!mintReviewAvailable(review.stage,now))):(!reserveCapability.allowed||pending?.kind==='invalid'||(!pending&&(!quote.data||quote.isError||expired||needsRefresh))))} onClick={()=>confirm.mutate()}>
      {review.kind==='mint'?pendingMint?'Retry original request':'Reserve preview slot':pending?'Retry original request':'Record preview request'}</button>
    {review.kind==='mint'&&!mintCapability.allowed&&<Signal>{mintCapability.reason}</Signal>}
    {review.kind==='progress'&&!reserveCapability.allowed&&<Signal>{reserveCapability.reason}</Signal>}
    {confirm.error&&<Signal>{friendlyError(confirm.error)}</Signal>}
  </Modal>;
}
function MintTerms({inventoryId,stage}:{inventoryId:string;stage:Stage}){
 return <><Facts items={[
   ['Collection',inventoryId],['Stage',stage.id],['Mint price',sol(stage.priceLamports)],['Local creation cost',sol(stage.costLamports)],
   ['Network cost','Unknown'],['Total cost','Unknown'],['Wallet limit',stage.walletLimit],['Stage closes',utc(stage.closesAt)]
 ]}/><p>These are the disclosed local components. Network and total costs are unknown. No SOL is sent by this preview.</p>
 <p>Reserve one local slot and wait for its committed draw.</p></>;
}
function PendingMint({wallet,review}:{wallet:string;review:(value:Review)=>void}){
 const journal=useMemo(()=>typeof sessionStorage==='undefined'?null:mintJournal(sessionStorage,wallet),[wallet]),[entries,setEntries]=useState<MintJournalEntry[]>(()=>journal?.list()??[]);
 useEffect(()=>{const refresh=()=>setEntries(journal?.list()??[]);window.addEventListener('10x:mint-journal',refresh);refresh();return()=>window.removeEventListener('10x:mint-journal',refresh);},[journal]);
 if(!entries.length)return null;
 return <Panel title="Mint requests awaiting a result">{entries.map(entry=><article className="record" key={entry.name}>
  {entry.kind==='invalid'?<Signal>A stored mint request is unreadable. Review existing operation receipts before starting another request.</Signal>:<>
   <p>Original reviewed reservation for {entry.attempt.inventoryId} · {entry.attempt.stageId}. Its key and terms are retained for this wallet.</p>
   <Capability method="POST" path="/api/v1/collect/inventories/{id}/stages/{stage}/reservations"><button onClick={()=>review({kind:'mint',inventory:{id:entry.attempt.inventoryId},stage:entry.attempt.stage})}>Review original mint request</button></Capability>
  </>}</article>)}</Panel>;
}
function QuoteDetails({quote:q}:{quote:ProgressQuote}){
  const facts:Array<[string,React.ReactNode]>=[['Target',q.targetId],['Fee quote',sol(q.feeLamports)],['Reviewed local-component ceiling',sol(q.maxTotalLamports)],['Network cost','Unknown'],['Total cost','Unknown'],['Quote expires',utc(q.expiresAt)]];
  if(q.kind==='visual')facts.push(['Traits replaced',q.fields?.join(', ')],['Cooldown after fulfillment',(q.cooldownMs??0)/3_600_000+' hours']);
  else facts.push(['Material NFT',q.materialId],['New target Level',q.nextTargetLevel],['Target expiry',q.nextTargetExpiry&&utc(q.nextTargetExpiry)]);
  return <><Facts items={facts}/>
    <Diagnostics>{q.asOf&&<p>Server quote as of {utc(q.asOf)} · {q.source??'Local evidence'}.</p>}</Diagnostics>
    {q.materialProbabilities&&<><p>The material survives and may drop to a lower Level, shortening its future benefit period. Its past allocations remain intact.</p><details><summary>Material Level probabilities</summary><Facts items={q.materialProbabilities.map(row=>['Level '+row.level,row.count+' of '+row.total+(row.expiresAt?' · expires '+utc(row.expiresAt):'')+(row.remainingMs===undefined?'':' · '+row.remainingMs+' ms remaining at quote time')])}/></details></>}
    <p>The ceiling covers the disclosed local components only. Network and total costs are unknown. No SOL is sent by this preview.</p>
    <p>After acceptance, the selected assets remain reserved locally until the committed result arrives.</p></>;
}
function PendingProgression({wallet,review}:{wallet:string;review:(value:Review)=>void}){
  const journal=useMemo(()=>typeof sessionStorage==='undefined'?null:progressionJournal(sessionStorage,wallet),[wallet]),[entries,setEntries]=useState<ProgressionJournalEntry[]>(()=>journal?.list()??[]);
  useEffect(()=>{const refresh=()=>setEntries(journal?.list()??[]);window.addEventListener('10x:progression-journal',refresh);refresh();return()=>window.removeEventListener('10x:progression-journal',refresh);},[journal]);
  if(!entries.length)return null;
  return <Panel title="Requests awaiting a result">{entries.map(entry=><article className="record" key={entry.name}>
    {entry.kind==='invalid'?<Signal>A stored request is unreadable. Review existing operation receipts before starting another request.</Signal>:<>
      <p>Original reviewed request for {entry.attempt.body.targetId}. Its key and terms are retained for this wallet.</p>
      <Capability method="POST" path="/api/v1/collect/inventories/{id}/progression"><button onClick={()=>review({kind:'progress',asset:entry.attempt.selection.target,materialId:entry.attempt.selection.material?.id})}>Review original request</button></Capability>
    </>}</article>)}</Panel>;
}

function CollectionTerms(){
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  return <Loaded query={policy}>{p=><div className="two-up"><Panel className="collection-card">
    <NftArt name="genesis"/><h2><Link to="/collections/genesis">Genesis</Link></h2>
    <p>Permanent Vault eligibility with an immutable Level from 1 to 10.</p>
    <Facts items={[['Maximum supply',pretty(p.genesis.cap)],['Per tranche',pretty(p.genesis.trancheSize)],
      ['First whitelist price',p.genesis.firstWhitelistPriceSol+' SOL'],['Eligible wallet',p.genesis.mintsPerEligibleWalletPerStage+' mint per stage']]}/>
    <Diagnostics><details><summary>Tranche voting</summary><p>Genesis holders and the next stage’s whitelist can vote for {p.genesis.ballotHours} hours.
      Each eligible wallet gets {p.genesis.votesPerWallet} vote.</p></details></Diagnostics></Panel>
    <Panel className="collection-card"><NftArt name="season"/><h2>Seasons</h2>
      <p>Benefit duration follows the current Level, measured from the published Season start.</p>
      <Facts items={[['Monthly supply',pretty(p.season.monthlyCap)],['Free stage','Revealed Genesis 1X'],
        ['Eligible wallet',p.season.freeMintsPerEligibleWallet+' free mint']]}/>
      <Diagnostics><details><summary>Upgrades and visual rerolls</summary><p>Pair two same-Level NFTs from one Season to raise the target’s Level.
        The other NFT receives a Level draw. Visual rerolls replace Model, Backdrop and Symbol.</p></details></Diagnostics></Panel></div>}</Loaded>;
}

export function PublishedStage({inventory,stage,review}:{inventory:Inventory;stage:Stage;review?:(review:Review)=>void}){
  const {wallet,open}=useSession();
  const {technical}=useExperience();
  if(!technical&&stage.status==='closed')return null;
  const eligible=stage.eligibility?stage.eligibility.status==='eligible':stage.eligible===true;
  const canReserve=stage.status==='open' && stage.type!=='founder' && stage.available>0;
  return <article className="stage"><div className="entry-head"><h4>{stage.id}</h4><span>{stage.status}</span></div>
    <Facts items={[['Mint price',sol(stage.priceLamports)],['Local creation cost',sol(stage.costLamports)],['Network cost','Unknown'],['Total cost','Unknown'],
      ['Slots available',stage.available],['Limit per wallet',stage.walletLimit],['Opens',utc(stage.opensAt)],['Closes',utc(stage.closesAt)]].filter(([label])=>technical||!['Local creation cost','Network cost','Total cost','Opens'].includes(String(label))) as [string,React.ReactNode][]}/><p>Additional costs are shown before you confirm.</p>
    <StageEvidence stage={stage}/>{canReserve && review && <Capability method="POST" path="/api/v1/collect/inventories/{id}/stages/{stage}/reservations">{(wallet?(eligible?(stage.walletReservations??0)<stage.walletLimit?
      stage.termsDigest&&(!stage.reservationStatus||stage.reservationStatus.status==='available')?<button onClick={()=>review({kind:'mint',inventory,stage})}>Review reservation</button>:<p>Reviewed reservation terms are unavailable in the connected runtime.</p>:<p>The wallet limit for this stage has been reached.</p>
      :<p>{stage.eligible===null||stage.eligibility?.status==='unknown'?'Eligibility is unknown until complete evidence is available.':'This wallet is outside the published stage eligibility list.'}</p>):<button onClick={open}>Connect wallet</button>)}</Capability>}
    {stage.openingHold&&<p>{stage.openingHold}</p>}</article>;
}
function MaterialPicker({target,wallet,review}:{target:Asset;wallet:string;review:(review:Review)=>void}){
  const {technical}=useExperience();
  const [error,setError]=useState('');
  const candidates=useRuntimeQuery('/api/v1/collect/me/assets',{queryKey:['private',wallet,'solana','material-candidates'],queryFn:async({signal})=>{
    const items:Asset[]=[];let cursor:string|undefined;
    for(let page=0;page<4;page++){
      const result=await sdk.assets(cursor,signal);items.push(...result.items);
      if(result.nextCursor===null)return {items,complete:true};cursor=String(result.nextCursor);
    }
    return {items,complete:false};
  }});
  return <Loaded query={candidates}>{result=>{const choices=eligibleMaterials(result.items,target,wallet);
    return <form className="member-form" data-upgrade={target.id} onSubmit={event=>{
      event.preventDefault();const id=String(new FormData(event.currentTarget).get('material'));
      if(!choices.some(a=>a.id===id)){setError('Choose a listed same-owner, same-Season, same-Level material.');return;}
      setError('');review({kind:'progress',asset:target,materialId:id});
    }}>{technical?<label>Same-Level material NFT ID<input name="material" list={'materials-'+target.id} required maxLength={128}/></label>:<label>Pair with another Level {target.level} NFT<select name="material" required defaultValue=""><option value="" disabled>{choices.length?'Choose an NFT':'No matching NFT available'}</option>{choices.map(a=><option key={a.id} value={a.id}>{a.id} · Level {a.level}</option>)}</select></label>}
    <datalist id={'materials-'+target.id}>{choices.map(a=><option value={a.id} key={a.id}/>)}</datalist>
    <p hidden={result.complete}>Showing matches from your first 100 NFTs. Other matching NFTs may be outside this list.</p><Diagnostics><p>{choices.length} matching materials in {result.items.length} checked assets. {!result.complete?'Selection is limited to the first 100 owned assets.':'All owned assets checked.'}</p></Diagnostics>
    <button disabled={!choices.length}>Preview upgrade</button>{error&&<Signal>{error}</Signal>}</form>;
  }}</Loaded>;
}
function MemberAssets({wallet,review}:{wallet:string;review:(review:Review)=>void}){
  const {technical}=useExperience();
  const search=rootRoute.useSearch();
  const assets=useRuntimeQuery('/api/v1/collect/me/assets',{queryKey:['private',wallet,'solana','collection-assets',search.owned],queryFn:({signal})=>sdk.assets(search.owned,signal)});
  const operations=useRuntimeQuery('/api/v1/collect/me/operations',{queryKey:['private',wallet,'solana','collection-operations',search.operations],queryFn:({signal})=>sdk.receipts(search.operations,signal)});
  const receipt=useRuntimeQuery('/api/v1/collect/me/operations/{id}',{queryKey:['private',wallet,'solana','collection-receipt',search.receipt],enabled:!!search.receipt,
    queryFn:({signal})=>sdk.receipt(search.receipt!,signal)});
  return <>
    <Panel title="Your collection"><Loaded query={assets}>{page=><>
      {!page.items.length && <Empty title="No local collection assets"/>}
      <div className="nft-grid">{page.items.map(asset=><article className="record nft-card" key={asset.id}><NftArt name={asset.id} level={asset.level} concealed={asset.revealStatus!=='revealed'}/><h3 className="wrap-anywhere"><Link to="/nfts/$assetId" params={{assetId:asset.id}}>{asset.id}</Link></h3><p>{asset.inventoryId} · {asset.revealStatus}</p>
        {asset.revealStatus==='revealed' && <><Facts items={[['Level',asset.level],['Model',asset.traits?.model],['Backdrop',asset.traits?.backdrop],
          ['Symbol',asset.traits?.symbol],['Benefit expiry',asset.expiresAt?utc(asset.expiresAt):'Permanent']].filter(([label])=>technical||!['Level','Model','Backdrop','Symbol'].includes(String(label))) as [string,React.ReactNode][]}/>
          {asset.operationPending?<p>{technical?'Awaiting committed draw evidence.':'Your request is processing. Check its status below.'}</p>:asset.expiresAt&&<>
            <Capability method="POST" path="/api/v1/collect/inventories/{id}/progression"><Capability method="POST" path="/api/v1/collect/inventories/{id}/progression/quote"><button onClick={()=>review({kind:'progress',asset})}>Preview visual reroll</button>
            {asset.level!<10&&<MaterialPicker target={asset} wallet={wallet} review={review}/>}</Capability></Capability></>}
          <AssetEvidence asset={asset}/><Link to="/airdrops" search={{asset:asset.id}}>{technical?'Vault allocations ↗':'View airdrops ↗'}</Link></>}
      </article>)}</div>
      {page.nextCursor!==null&&<Link to="/nfts" search={{owned:String(page.nextCursor)}}>Next assets →</Link>}
    </>}</Loaded></Panel>
    <Panel title="Operation history">{search.receipt && <Loaded query={receipt}>{r=><article className="receipt"><h3>Operation receipt</h3>
      <Facts items={[['ID',r.id],['State',r.status],['Requested',r.createdAt?utc(r.createdAt):'Time withheld'],['Action',r.kind],['Collection',r.inventoryId],
        ['Recorded price',sol(r.priceLamports??r.feeLamports)],['Result NFT',r.assetId??'Pending']]}/><CollectionOperationHold operation={r}/><button type="button" onClick={()=>void receipt.refetch()} disabled={receipt.isFetching}>Refresh operation receipt</button><Diagnostics><CollectionOperationFairness key={wallet+':'+r.id} operation={r} wallet={wallet}/></Diagnostics></article>}</Loaded>}
      <Loaded query={operations}>{page=><>{page.items.length?<ul className="rows">{page.items.map(op=><li key={op.id}><Link to="/nfts" search={{receipt:op.id}}>
        <strong>{op.kind} · {op.inventoryId}</strong><span>{op.reconciliation?'Held after observed transfer':op.status} ↗</span></Link></li>)}</ul>:<p>No operations for this wallet.</p>}
        {page.nextCursor!==null&&<Link to="/nfts" search={{operations:String(page.nextCursor)}}>Next operations →</Link>}</>}</Loaded></Panel>
  </>;
}
export function Collect(){
  usePageMeta('NFTs','Explore permanent Genesis membership and monthly Season collections.','/nfts');
  const {wallet}=useSession(),search=rootRoute.useSearch();
  const [review,setReview]=useState<Review|null>(null);
  useEffect(()=>setReview(null),[wallet]);
  const inventories=useRuntimeQuery('/api/v1/collect/inventories',{queryKey:principalKey(wallet,'inventories',search.inventories),queryFn:({signal})=>sdk.inventories(search.inventories,signal)});
  const ballots=useRuntimeQuery('/api/v1/genesis/ballots',{queryKey:['ballots'],queryFn:({signal})=>sdk.ballots(signal)});
  return <>
    <Hero title="NFTs">Find your next collectible. Make it yours, level it up, and follow its rewards.</Hero>
    <Journey steps={[['Find your collectible','Genesis lasts. Seasons have a benefit period.'],['Make it yours','Preview a mint or update a Season NFT.'],['Follow your rewards','See your NFT’s allocations in Airdrops.']]}/>
    {wallet&&<><PendingMint key={'mint-pending:'+wallet} wallet={wallet} review={setReview}/><PendingProgression key={'pending:'+wallet} wallet={wallet} review={setReview}/><MemberAssets key={wallet} wallet={wallet} review={setReview}/></>}
    <CollectionTerms/>
    <Panel title="Published stages"><Loaded query={inventories}>{page=><>
      {!page.items.length&&<Empty title="No published stages"/>}
      {page.items.map(inv=><article key={inv.id} className="record"><h3>{inv.kind==='season'?<Link to="/seasons/$seasonId" params={{seasonId:inv.id}}>{inv.id}</Link>:inv.id}</h3>
        <InventoryEvidence inventory={inv}/>
        {inv.stages.map(s=><PublishedStage key={s.id} inventory={inv} stage={s} review={setReview}/>)}</article>)}
      {page.nextCursor!==null&&<Link to="/nfts" search={{inventories:String(page.nextCursor)}}>Next collections →</Link>}
    </>}</Loaded></Panel>

    <Panel title="Genesis ballots"><Loaded query={ballots}>{page=>page.items.length?page.items.map(b=>
      <BallotCard key={b.id+(wallet??'')} wallet={wallet} ballot={b}/>):<Empty title="No published ballots"/>}</Loaded></Panel>
    {wallet&&review&&<Capability method="POST" path={review.kind==='mint'?'/api/v1/collect/inventories/{id}/stages/{stage}/reservations':'/api/v1/collect/inventories/{id}/progression/quote'}>
      <ReviewOperation key={wallet} wallet={wallet} review={review} onClose={()=>setReview(null)}/></Capability>}
  </>;
}
