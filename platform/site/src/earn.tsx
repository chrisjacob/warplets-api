import {ReviewPreview} from './review-preview';
import {SubmissionReview} from './earn-review';
import {PostContent} from './post-content';
import {supportedPost} from '../../earn/supported-post.mjs';
import {CategoryCompetition} from './performance';
import {Diagnostics,TokenArt,ProgressBar,useExperience} from './experience';
import {EarnMemberDetails} from './earn-details';
import { Capability, useRuntimeQuery } from './capabilities';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { rootRoute } from './routes';
import { client, sdk } from './sdk';
import {RevealMore,Disclosure,dayDate, compact, Facts, Empty, friendlyError, Hero, intentKey, Loaded, Panel, usePageMeta } from './common';
import { useSession } from './session';

function Contribution({wallet}:{wallet:string}){
  const cache=useQueryClient(),{submissions,awards}=rootRoute.useSearch();
  const {technical}=useExperience(),[shownSubmissions,setShownSubmissions]=useState(5),[shownAwards,setShownAwards]=useState(5);
  useEffect(()=>setShownSubmissions(5),[wallet,submissions]);
  useEffect(()=>setShownAwards(5),[wallet,awards]);
  const [tokenId,setTokenId]=useState('');
  const [urlError,setUrlError]=useState('');
  const catalog=useRuntimeQuery('/api/v1/markets',{queryKey:['markets','active'],queryFn:({signal})=>sdk.markets(undefined,signal,{status:'active'})});
  const history=useRuntimeQuery('/api/v1/earn/me',{queryKey:['private',wallet,'solana','submissions',submissions],queryFn:({signal})=>sdk.submissions(submissions,signal)});
  const claims=useRuntimeQuery('/api/v1/earn/claims',{queryKey:['private',wallet,'solana','awards',awards],queryFn:({signal})=>sdk.awards(awards,signal)});
  const submit=useMutation({mutationFn:async(body:{tokenId:string;url:string})=>{
    const pending=intentKey(wallet,'submission',body);
    await client.submitEarnContent({body,idempotencyKey:pending.key});pending.done();
  },onSuccess:()=>cache.invalidateQueries({queryKey:['private',wallet,'solana','submissions']})});
  return <>
    <Panel title="Submit content"><Capability method="POST" path="/api/v1/earn/submissions"><Loaded query={catalog}>{page=>{
      const active=page.items.filter(m=>m.status==='active');
      if(!active.length)return <Empty title="No active campaign"/>;
      const selectedToken=active.find(m=>m.id===tokenId)??active[0];
      return <form id="submission-form" className="member-form" onSubmit={event=>{
        event.preventDefault();const fields=new FormData(event.currentTarget);
        let post;try{post=supportedPost(String(fields.get('url')).trim());setUrlError('');}catch{setUrlError('Paste a shared Farcaster or X post link. Profile pages and other sites are not supported.');return;}
        submit.mutate({tokenId:String(fields.get('tokenId')),url:post.canonicalUrl});
      }}>
        <label>Campaign<select name="tokenId" required value={selectedToken.id} onChange={e=>setTokenId(e.target.value)}>{active.map(m=><option value={m.id} key={m.id}>{m.symbol}</option>)}</select></label>
        <label>Farcaster or X post link<input name="url" type="url" required maxLength={2048} placeholder="https://x.com/yourname/status/…" aria-describedby="post-link-help" onChange={()=>setUrlError('')}/></label>
        <p id="post-link-help">Share a public Farcaster or X post about this token.</p>
        <p>You’ll need at least $10 staked in the corresponding Attention Token when you submit and at the daily cutoff. Each campaign has its own requirement.</p><p><Link to="/stake" search={{farm:selectedToken.id}}>Stake {selectedToken.symbol} to participate →</Link></p>
        <button disabled={submit.isPending}>Submit contribution</button>
        <output aria-live="polite">{urlError|| (submit.isSuccess?'Contribution recorded for moderation.':submit.isError?friendlyError(submit.error):'')}</output>
      </form>;
    }}</Loaded></Capability></Panel>
    <Panel technicalOnly title="Your Earn evidence">{history.data?.memberStatus?<EarnMemberDetails status={history.data.memberStatus}/>:<p>Current wallet evidence is unavailable in this runtime.</p>}</Panel>
    <div className="two-up"><Panel title="Your submissions"><Loaded query={history}>{page=><>
      {page.items.length?<ul className="records submission-records">{page.items.slice(0,technical?page.items.length:shownSubmissions).map(i=><li key={i.id}><strong>{i.tokenId}</strong><span>{technical?i.status:i.status==='final'?'Daily result final':'Awaiting daily results'}{i.score==null?'':' · final score '+i.score+' / 10'}</span>
        <Diagnostics><small>{i.url}</small></Diagnostics><PostContent submissionId={i.id}/>{i.reason && <p>{i.reason}</p>}
        <p>{i.status!=='final'?'Your contribution is saved. We’ll check your eligibility when the day closes.':i.eligible===true?'Eligible at cutoff. Eligibility does not guarantee a Top 100 award.':i.eligible===false?'Not eligible at cutoff.':'Cutoff eligibility unavailable.'}</p>
        <SubmissionReview wallet={wallet} submissionId={i.id}/>
        <Diagnostics><Facts items={[["Entry stake (micro-USD)",i.entryStakeMicroUsd??'Unavailable'],['Cutoff stake (micro-USD)',i.closingStakeMicroUsd??'Pending or unavailable']]}/></Diagnostics>
        <Diagnostics>{i.components?<details><summary>Finalized server-derived components</summary><Facts items={[
          ['Verified action component (tenths)',i.components.actionTenths],['Rolling streak days',i.components.streakDays],
          ['Highest eligible NFT Level',i.components.highestEligibleLevel],['Purchase token-days',i.components.purchaseTokenDays],['Source',i.components.sourceRef],
        ]}/><p>The final overall multiplier is shown on the settled leaderboard for ranked wallets. Components are not recomputed in this browser.</p></details>:<p>Component evidence is pending or unavailable.</p>}</Diagnostics></li>)}</ul>:<p>No submissions from this wallet.</p>}
      {!technical&&shownSubmissions<page.items.length&&<RevealMore items=".submission-records > li" shown={shownSubmissions} onReveal={()=>setShownSubmissions(n=>n+5)}>Show more submissions ({shownSubmissions} of {page.items.length})</RevealMore>}
      {page.nextCursor!==null && <Link to="/earn" search={{submissions:String(page.nextCursor)}}>Next submissions →</Link>}
    </>}</Loaded></Panel>
      <Panel title="Your vested awards"><Loaded query={claims}>{page=><>
        {page.items.length?<ul className="records award-records">{page.items.slice(0,technical?page.items.length:shownAwards).map(i=><li key={i.tokenId+':'+i.day}><TokenArt name={i.tokenId}/><strong>{i.tokenId} · {technical?'day '+i.day:dayDate(i.day)+' UTC'}</strong>
          <Diagnostics><small>{i.vestedUnits} of {i.awardUnits} raw token units unlocked</small></Diagnostics><ProgressBar value={i.vestedUnits} total={i.awardUnits} label="Reward vesting"/></li>)}</ul>:<p>No settled awards for this wallet.</p>}
        {!technical&&shownAwards<page.items.length&&<RevealMore items=".award-records > li" shown={shownAwards} onReveal={()=>setShownAwards(n=>n+5)}>Show more awards ({shownAwards} of {page.items.length})</RevealMore>}
        {page.nextCursor!==null&&<Link to="/earn" search={{awards:String(page.nextCursor)}}>Next awards →</Link>}
      </>}</Loaded></Panel></div>
  </>;
}
function CampaignPreview(){
 const catalog=useRuntimeQuery('/api/v1/markets',{queryKey:['markets','active'],queryFn:({signal})=>sdk.markets(undefined,signal,{status:'active'})});
 return <section className="campaign-section" aria-labelledby="campaigns-title"><div className="catalog-header"><h2 id="campaigns-title">Find your campaign.</h2><Link className="action-link" to="/tokens" hash="attention-tokens">All Attention Tokens</Link></div>
  <Loaded query={catalog}>{page=>{
   const active=page.items.filter(m=>m.status==='active'),shown=(active.length?active:page.items).slice(0,3);
   if(!active.length)return <Empty title="No active campaigns">Explore all Attention Tokens to find a campaign.</Empty>;
   return <><div className="campaign-grid">{shown.map(m=><article className="campaign-card" key={m.id}><TokenArt name={m.id}/><h3>{m.symbol}</h3><p>Attention Token for {m.ogSymbol}</p><span className="launch-status">{m.status==='active'?'Active':m.status==='campaign-ended'?'Ended':m.status}</span><Link to="/markets/$marketId" params={{marketId:m.id}}>View token</Link></article>)}</div></>;
  }}</Loaded>
 </section>;
}
export function Attention(){
  const {wallet,open}=useSession();
  usePageMeta('Earn','Create content for Attention Token campaigns and track your rewards.','/earn');
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const capacity=useRuntimeQuery('/api/v1/earn/capacity',{queryKey:['earn-capacity'],queryFn:({signal})=>client.getEarnAdmissionCapacity({signal})});
  const actions=useRuntimeQuery('/api/v1/earn/actions',{queryKey:['earn-actions'],queryFn:({signal})=>client.listActiveEarnActions({signal})});
  return <>
    <div className="earn-heading"><Hero title="Earn">Create something worth sharing.</Hero><Link className="action-link" to="/leaderboards">View rankings</Link></div>
    {!wallet&&<CampaignPreview/>}
    {capacity.data&&<p className="status-pill">{capacity.data.data.accepting?'Submissions open · '+capacity.data.data.remaining+' places left today':'Submissions paused · Check back soon'}</p>}
    {wallet?<Contribution key={wallet} wallet={wallet}/>:<Panel title="Bring your voice." className="connect-panel"><p>Share original content for a campaign. Connect your wallet to submit a post and track your rewards.</p><button onClick={open}>Connect wallet</button></Panel>}
    <Disclosure title="How to participate">
     <Loaded query={policy}>{p=><><p>Post original content on Farcaster or X, then submit its link. Keep at least US${p.earn.minimumCorrespondingStakeUsd} staked in that campaign’s Attention Token at submission and the daily cutoff.</p><p>Eligible contributions compete for the top {p.earn.maxWinners} places. Scores and verified participation determine rewards, with a maximum {p.earn.maxMultiplierTenths/10}× multiplier.</p></>}</Loaded>
     <ReviewPreview/><Link to="/stake">View staking campaigns</Link>
    </Disclosure>
    <Diagnostics><div className="two-up"><Panel title="Admission capacity"><Loaded query={capacity}>{({data:c})=><Facts items={[[ 'Mode',c.mode],['Admitted',c.admitted],['Remaining',c.remaining],['Daily limit',c.limit],['Admission',c.accepting?'Open':'Held']]}/>}</Loaded></Panel>
     <Panel title="Active onboarding actions"><Loaded query={actions}>{a=>a.items.length?<ul>{a.items.map(i=><li key={i.actionId}><strong>{i.label}</strong> · verifier: {i.verifier}</li>)}</ul>:<p>No active actions.</p>}</Loaded></Panel></div></Diagnostics>
    <CategoryCompetition category="earn"/>
  </>;
}
export function Leaderboards({epochId}:{epochId?:string}={}){
  const {technical}=useExperience(),[shown,setShown]=useState(10);
  const {date:requested}=rootRoute.useSearch();
  const selected=epochId??requested,today=new Date().toISOString().slice(0,10);
  const boardDate=selected&&z.iso.date().safeParse(selected).success?selected:today;
  const [editing,setEditing]=useState(boardDate);
  useEffect(()=>setEditing(boardDate),[boardDate]);
  useEffect(()=>setShown(10),[boardDate]);
  const navigate=useNavigate();
  usePageMeta('Daily content scores','Content rankings and finalized daily reward results.',epochId?'/earn/'+boardDate:'/leaderboards'+(selected?'?date='+boardDate:''));
  const board=useRuntimeQuery('/api/v1/earn/epochs/{epoch}/leaderboard',{queryKey:['leaderboard',boardDate],queryFn:({signal})=>sdk.board(boardDate,signal)});
  return <><Hero title="Daily content scores">See who’s creating attention. Explore content rankings and daily reward results.</Hero>
    <div className="context-links"><Link to="/earn">Submit content</Link></div>
    <Panel title="Daily leaderboard"><form className="inline-form" onSubmit={e=>{e.preventDefault();void navigate({to:'/leaderboards',search:{date:editing}});}}>
      <label htmlFor="board-date">Board date (UTC)</label><input id="board-date" type="date" required value={editing} onChange={e=>setEditing(e.target.value)}/>
      <button>View board</button></form><Loaded query={board}>{b=>{
        if(b.status==='pending')return <Empty title="Awaiting final scores">Reviews are still in progress. Final results will appear here.</Empty>;
        if(!b.items.length)return <Empty title="Final board · no winners">No eligible contribution placed on this board.</Empty>;
        return <><div className="scroller"><table><caption>Final leaderboard · {boardDate} UTC</caption>
          <thead><tr>{['Rank','Wallet','Score','Multiplier','Points','Post'].map(s=><th key={s}>{s}</th>)}</tr></thead>
          <tbody>{b.items.slice(0,technical?b.items.length:shown).map(i=><tr key={i.wallet}><td>{i.rank}</td><td><abbr title={i.wallet}>{compact(i.wallet)}</abbr></td><td>{i.contentScore}</td>
            <td>{i.multiplierTenths/10}×</td><td>{i.pointsTenths/10}</td><td>{i.submissionId?<PostContent submissionId={i.submissionId} label="View winning post"/>:'Unavailable'}</td></tr>)}</tbody></table></div>{!technical&&shown<b.items.length&&<RevealMore items="tbody > tr" shown={shown} onReveal={()=>setShown(n=>n+10)}>Show more scores ({shown} of {b.items.length})</RevealMore>}</>;
      }}</Loaded></Panel>
  </>;
}
export function Earn({epochId}:{epochId?:string}={}){const {date}=rootRoute.useSearch();return epochId||date?<Leaderboards epochId={epochId??date}/>:<Attention/>;}
