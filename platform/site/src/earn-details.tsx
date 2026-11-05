import type {EarnMemberStatus} from './models';
import {Facts,utc} from './common';
export function EarnMemberDetails({status:s}:{status:EarnMemberStatus}){
 const final=s.latestFinalComponents;
 return <><p>{s.mode} · as of {utc(s.asOf)}. Current cutoff: {utc(s.currentCutoff.cutoffAt)} · {s.currentCutoff.status} ({s.currentCutoff.reason}).</p>
  <Facts items={[["Minimum overall multiplier",s.multiplierBounds.minimumTenths/10+'×'],['Maximum overall multiplier',s.multiplierBounds.maximumTenths/10+'×']]}/>
  <h3>Current admission evidence</h3>{s.admission.status!=='complete'?<p>Unavailable: {s.admission.reason}</p>:s.admission.items.length?<ul className="records">{s.admission.items.map(i=><li key={i.tokenId}><strong>{i.tokenId} · {i.status}</strong>
    <Facts items={[["Reason",i.reason??'Current stake and admission checks passed'],['Stake (micro-USD)',i.stakeMicroUsd??'Pending'],['Observed',i.stakeObservedAt?utc(i.stakeObservedAt):'Unavailable'],['Evidence receipt',i.sourceRef??'Unavailable']]}/></li>)}</ul>:<p>No active campaigns.</p>}
  <p>This preview does not reserve capacity. Accepted content still needs final moderation and complete cutoff evidence; eligibility does not guarantee a ranked award.</p>
  <h3>Your active onboarding actions</h3>{s.actions.status!=='complete'?<p>Unavailable: {s.actions.reason}</p>:s.actions.items.length?<ul>{s.actions.items.map(i=><li key={i.actionId}><strong>{i.label} · {i.status}</strong><br/>Verifier: {i.verifier} · {i.verifiedAt?utc(i.verifiedAt):'No verified completion recorded'}{i.sourceRef&&<small>Evidence: {i.sourceRef}</small>}</li>)}</ul>:<p>No active onboarding actions.</p>}
  <h3>Latest finalized components</h3>{final?<Facts items={[
    ['Board cutoff',utc(final.cutoffAt)],['Action component (tenths)',final.actionTenths],['Rolling streak days',final.streakDays],
    ['Highest eligible NFT Level',final.highestEligibleLevel],['Purchase token-days',final.purchaseTokenDays],['Overall multiplier',final.multiplierTenths/10+'×'],
    ['Component source',final.sourceRef],['Board snapshot digest',final.snapshotDigest],
  ]}/>:<p>Finalized ownership, purchase and streak evidence is unavailable. No zero-valued multiplier preview is inferred.</p>}
  <p>Streak continuity requires qualifying approvals less than 24 hours apart; a missed qualifying day resets it. The server seals components at cutoff.</p></>;
}
