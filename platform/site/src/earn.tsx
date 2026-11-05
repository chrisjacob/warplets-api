import {EarnMemberDetails} from './earn-details';
import { Capability, useRuntimeQuery } from './capabilities';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { rootRoute } from './routes';
import { client, sdk } from './sdk';
import { compact, Facts, Empty, friendlyError, Hero, intentKey, Loaded, Metrics, Panel, usePageMeta } from './common';
import { useSession } from './session';

function Contribution({wallet}:{wallet:string}){
  const cache=useQueryClient(),{submissions,awards}=rootRoute.useSearch();
  const catalog=useRuntimeQuery('/api/v1/markets',{queryKey:['markets',undefined],queryFn:({signal})=>sdk.markets(undefined,signal)});
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
      return <form id="submission-form" className="member-form" onSubmit={event=>{
        event.preventDefault();const fields=new FormData(event.currentTarget);
        submit.mutate({tokenId:String(fields.get('tokenId')),url:String(fields.get('url'))});
      }}>
        <label>ATT campaign<select name="tokenId" required>{active.map(m=><option value={m.id} key={m.id}>{m.symbol}</option>)}</select></label>
        <label>Content URL<input name="url" type="url" required maxLength={2048} placeholder="https://…"/></label>
        <p>The local preview checks recorded stake when your contribution is submitted.</p>
        <button disabled={submit.isPending}>Submit contribution</button>
        <output aria-live="polite">{submit.isSuccess?'Contribution recorded for moderation.':submit.isError?friendlyError(submit.error):''}</output>
      </form>;
    }}</Loaded></Capability></Panel>
    <Panel title="Your Earn evidence">{history.data?.memberStatus?<EarnMemberDetails status={history.data.memberStatus}/>:<p>Current wallet evidence is unavailable in this runtime.</p>}</Panel>
    <div className="two-up"><Panel title="Your submissions"><Loaded query={history}>{page=><>
      {page.items.length?<ul className="records">{page.items.map(i=><li key={i.id}><strong>{i.tokenId}</strong><span>{i.status}{i.score==null?'':' · score '+i.score}</span>
        <small>{i.url}</small>{i.reason && <p>{i.reason}</p>}
        <p>{i.status!=='final'?'Accepted for moderation; cutoff eligibility is pending.':i.eligible===true?'Eligible at cutoff. Eligibility does not guarantee a Top 100 award.':i.eligible===false?'Not eligible at cutoff.':'Cutoff eligibility unavailable.'}</p>
        <Facts items={[["Entry stake (micro-USD)",i.entryStakeMicroUsd??'Unavailable'],['Cutoff stake (micro-USD)',i.closingStakeMicroUsd??'Pending or unavailable']]}/>
        {i.components?<details><summary>Finalized server-derived components</summary><Facts items={[
          ['Verified action component (tenths)',i.components.actionTenths],['Rolling streak days',i.components.streakDays],
          ['Highest eligible NFT Level',i.components.highestEligibleLevel],['Purchase token-days',i.components.purchaseTokenDays],['Source',i.components.sourceRef],
        ]}/><p>The final overall multiplier is shown on the settled leaderboard for ranked wallets. Components are not recomputed in this browser.</p></details>:<p>Component evidence is pending or unavailable.</p>}</li>)}</ul>:<p>No submissions from this wallet.</p>}
      {page.nextCursor!==null && <Link to="/earn" search={{submissions:String(page.nextCursor)}}>Next submissions →</Link>}
    </>}</Loaded></Panel>
      <Panel title="Your vested awards"><Loaded query={claims}>{page=><>
        {page.items.length?<ul className="records">{page.items.map(i=><li key={i.tokenId+':'+i.day}><strong>{i.tokenId} · day {i.day}</strong>
          <small>{i.vestedUnits} of {i.awardUnits} base units vested</small></li>)}</ul>:<p>No settled awards for this wallet.</p>}
        {page.nextCursor!==null&&<Link to="/earn" search={{awards:String(page.nextCursor)}}>Next awards →</Link>}
      </>}</Loaded></Panel></div>
  </>;
}
export function Earn({epochId}:{epochId?:string}={}){
  const {wallet,open}=useSession(),{date:requested}=rootRoute.useSearch();
  const today=new Date().toISOString().slice(0,10),selected=epochId??requested;
  const boardDate=selected&&z.iso.date().safeParse(selected).success?selected:today;
  usePageMeta(epochId?'Earn board · '+boardDate:'Earn','Global daily content scores and reward allocations.',
    selected?'/earn/'+boardDate:'/earn',!!selected);
  const [editing,setEditing]=useState(boardDate);
  useEffect(()=>setEditing(boardDate),[boardDate]);
  const navigate=useNavigate();
  const policy=useQuery({queryKey:['policy'],queryFn:({signal})=>sdk.policy(signal)});
  const capacity=useRuntimeQuery('/api/v1/earn/capacity',{queryKey:['earn-capacity'],queryFn:({signal})=>client.getEarnAdmissionCapacity({signal})});
  const actions=useRuntimeQuery('/api/v1/earn/actions',{queryKey:['earn-actions'],queryFn:({signal})=>client.listActiveEarnActions({signal})});
  const board=useRuntimeQuery('/api/v1/earn/epochs/{epoch}/leaderboard',{queryKey:['leaderboard',boardDate],queryFn:({signal})=>sdk.board(boardDate,signal)});
  return <>
    <Hero title="Earn">Compete on one global daily board with your highest-scoring eligible contribution.</Hero>
    <Loaded query={policy}>{p=><Metrics items={[
      ['Winner places','Top '+p.earn.maxWinners,'across active campaigns'],['Stake requirement','US$'+p.earn.minimumCorrespondingStakeUsd,'in the corresponding ATT'],
      ['Maximum multiplier',p.earn.maxMultiplierTenths/10+'×','applied to the content score'],
    ]}/>}</Loaded>
    <div className="two-up"><Panel title="Admission capacity"><Loaded query={capacity}>{({data:c})=><><Facts items={[
      ['Mode',c.mode],['Admitted',c.admitted],['Remaining',c.remaining],['Daily limit',c.limit],['Admission',c.accepting?'Open':'Held'],
    ]}/><p>Capacity does not prove this wallet meets the corresponding ATT stake requirement. Entry acceptance and final cutoff eligibility are separate.</p></>}</Loaded></Panel>
    <Panel title="Active onboarding actions"><Loaded query={actions}>{a=><>{a.items.length?<ul>{a.items.map(i=><li key={i.actionId}><strong>{i.label}</strong> · verifier: {i.verifier}<br/>Wallet completion evidence is unavailable in this projection.</li>)}</ul>:<p>No active actions.</p>}<p>A click or unverified follow does not earn credit. The server applies verified evidence, the rolling streak, and the overall multiplier cap.</p></>}</Loaded></Panel></div>
    <Panel title="Daily leaderboard"><form className="inline-form" onSubmit={e=>{e.preventDefault();void navigate({to:'/earn/$epochId',params:{epochId:editing}});}}>
      <label htmlFor="board-date">Board date (UTC)</label><input id="board-date" type="date" required value={editing} onChange={e=>setEditing(e.target.value)}/>
      <button>View board</button></form><Loaded query={board}>{b=>{
        if(b.status==='pending')return <Empty title="Awaiting final scores">This UTC board is awaiting final moderation and complete cutoff evidence.</Empty>;
        if(!b.items.length)return <Empty title="Final board · no winners">No eligible contribution placed on this board.</Empty>;
        return <div className="scroller"><table><caption>Final leaderboard · {boardDate} UTC</caption>
          <thead><tr>{['Rank','Wallet','Score','Multiplier','Points'].map(s=><th key={s}>{s}</th>)}</tr></thead>
          <tbody>{b.items.map(i=><tr key={i.wallet}><td>{i.rank}</td><td><abbr title={i.wallet}>{compact(i.wallet)}</abbr></td><td>{i.contentScore}</td>
            <td>{i.multiplierTenths/10}×</td><td>{i.pointsTenths/10}</td></tr>)}</tbody></table></div>;
      }}</Loaded></Panel>
    {wallet?<Contribution key={wallet} wallet={wallet}/>:<Panel title="Submit content"><p>Sign in with a Solana wallet to submit a contribution.</p>
      <button onClick={open}>Connect wallet</button></Panel>}
  </>;
}
