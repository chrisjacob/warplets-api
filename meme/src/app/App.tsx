import {useState} from 'react';
import {preview} from '../shared/fixtures';
import {IdentityPanel} from './IdentityPanel';
type Tab='Today'|'Rewards'|'Launches';
export function App(){
 const [tab,setTab]=useState<Tab>('Today');const {round,boost}=preview;
 return <div className="shell">
  <header><a className="brand" href="#">10X<span>.meme</span></a><IdentityPanel onIdentity={()=>undefined}/></header>
  <main>
   <div className="intro"><p className="eyebrow">One launch. Every day. Or skip.</p><h1>A daily ritual.<br/><em>A new possibility.</em></h1><p>Claim your rewards, discover today’s attribute, and help shape the next OG-paired launch.</p></div>
   <aside className="fixture-note" role="note">Simulated data · voting, wallet connections, launches and claims are disabled.</aside>
   <nav aria-label="Launchpad"><div role="tablist">{(['Today','Rewards','Launches'] as Tab[]).map(name=><button key={name} role="tab" aria-selected={tab===name} onClick={()=>setTab(name)}>{name}</button>)}</div></nav>
   {tab==='Today'&&<section aria-label="Today">
    <div className="top-grid"><article className="card reward-card"><p className="eyebrow">From previous launches</p><h2>45,120 <span>10XORBIT</span></h2><p>Available in this preview. New launches begin releasing rewards after 24 hours.</p><button className="primary" disabled>Claim all rewards</button></article>
     <article className="card boost-card"><p className="eyebrow">Your provisional boost</p><div className="boost">{boost.total.toFixed(1)}<small>×</small></div><p>{boost.featuredAttribute} · level {boost.eligibleLevel}</p><div className="boost-parts">{[['Base',boost.base],['Warplet',boost.warplet],['Holding',boost.holding],['Streak',boost.streak]].map(([label,value])=><div key={label}><span>{label}</span><strong>{Number(value).toFixed(1)}×</strong></div>)}</div><p className="fine">Ownership freezes before the reveal. Boosts settle at voting close.</p></article></div>
    <div className="section-title"><div><p className="eyebrow">Today’s shortlist</p><h2>Make your voice count.</h2></div><span className="pill">Advisory vote</span></div>
    <p className="section-copy">One active vote per Farcaster identity. 10X makes the final selection and can skip a launch.</p>
    <div className="candidates">{round.candidates.map((candidate,index)=><article className="card candidate" key={candidate.id}><div className={'token token-'+index} aria-hidden="true">{candidate.symbol.slice(0,1)}</div><div className="candidate-name"><h3>{candidate.name}</h3><span>${candidate.symbol}</span></div><dl><div><dt>Unique voters</dt><dd>{candidate.uniqueVoters}</dd></div><div><dt>Weighted votes</dt><dd>{candidate.weightedVotes.toFixed(1)}</dd></div></dl><button disabled>Vote for {candidate.symbol}</button></article>)}</div>
    <p className="fine">Leaderboard is provisional. Your preview vote would carry {boost.voteWeight.toFixed(1)} weight and earn {boost.rewardPoints} reward points. Voting for the selected token earns no extra reward.</p>
    <article className="card"><p className="eyebrow">Selection and launch</p><h2>Voting open. Selection ahead.</h2><p>After voting closes, the operator reviews the shortlist and selects one OG pairing or skips the launch.</p><p className="fine">Fixture status: awaiting operator selection. A successful launch starts its own ten-day campaign; the first reward allocation follows actual launch +24 hours.</p></article>
   </section>}
   {tab==='Rewards'&&<section className="card" aria-label="Rewards"><p className="eyebrow">Your rewards</p><h2>Rewards keep accumulating.</h2><p>Final allocations have no planned expiry. Claiming does not change your points or voting streak.</p><div className="reward-row"><div><strong>10X Orbit</strong><p>45,120 10XORBIT · available in fixture</p></div><button disabled>Claim</button></div><p className="fine">Claim all may need multiple transactions. Users pay network and required token-account costs.</p></section>}
   {tab==='Launches'&&<section className="card" aria-label="Launches"><p className="eyebrow">Launch history</p><h2>Follow each ten-day campaign.</h2><div className="reward-row"><div><strong>10X Orbit / ORBIT</strong><p>90% liquidity · 10% community rewards</p></div><span className="pill">Fixture edition</span></div><p>One percent of total supply releases each day, starting at launch +24 hours and ending at +240 hours.</p><p className="fine">Existing campaigns continue when a new daily launch is skipped.</p></section>}
  </main><footer><span>10X.meme</span><span>Solana launches · Base Warplets · Farcaster participation</span></footer>
 </div>;
}
