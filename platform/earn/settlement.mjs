// Portable read/compute boundary; no database, runtime clock or crypto imports.
import { MIN_STAKE_MICRO_USD, advanceStreak, epochAt, rankBoard, settleAllocation } from '../domain/earn/index.mjs';
const pending=(epoch,reason)=>({status:'pending',epoch,reason});
function stakeEvidence(row,wallet,tokenId,asOfMs) {
  return row ? {status:'verified',userId:wallet,tokenId,asOfMs,microUsd:BigInt(row.micro_usd)} : null;
}
export function computeBoard(input) {
  const {epoch,cutoff,posts,sourceRef,nowMs}=input;
    const decisions=[];
    const submissions=[];
    const qualifiedWallets=new Set();
    const approvals=new Map();
    function noteApproval(wallet,when) {
      const times=approvals.get(wallet) ?? [];
      times.push(when);
      approvals.set(wallet,times);
    }
    for (const post of posts) {
      if (post.content_score==null || post.reviewed_ms>nowMs) return pending(epoch,'moderation');
      const read=post.content_score>0 ? input.closingStake[post.id] : null;
      if (!read && post.content_score>0) return pending(epoch,'stake-evidence');
      const qualified=post.content_score>0 && BigInt(read.micro_usd)>=MIN_STAKE_MICRO_USD;
      decisions.push({submissionId:post.id,qualified,cutoffEvidence:read?.id??null});
      submissions.push({submissionId:post.id,userId:post.wallet,tokenId:post.token_id,submittedAtMs:post.submitted_ms,
        contentScore:post.content_score,atSubmission:stakeEvidence({micro_usd:post.entry_micro_usd},post.wallet,post.token_id,post.submitted_ms),
        atSnapshot:stakeEvidence(read,post.wallet,post.token_id,cutoff)});
      if (qualified) {
        qualifiedWallets.add(post.wallet);
        if (epochAt(post.reviewed_ms)===epoch) noteApproval(post.wallet,post.reviewed_ms);
      }
    }
    // A delayed moderation decision still references the original board; its
    // qualifying approval advances the streak only in the UTC day it happened.
    const late=input.late;
    for (const row of late) {
      if (row.qualified==null) return pending(epoch,'unsettled-approval');
      if (row.qualified) noteApproval(row.wallet,row.reviewed_ms);
    }
    const streaks=new Map();
    for (const [wallet,times] of approvals) {
      const prev=input.previousStreaks[wallet];
      streaks.set(wallet,advanceStreak({epoch,previous:prev,approvalsMs:times}));
    }
    const participants=[];
    const factSources=[];
    for (const wallet of qualifiedWallets) {
      const fact=input.facts[wallet];
      if (fact.status!=='ready') return pending(epoch,fact.reason);
      participants.push({userId:wallet,wallet,components:{...fact.components,streakDays:streaks.get(wallet)?.days??0}});
      factSources.push([wallet,fact.sourceRef,fact.payload]);
    }
    const campaigns=input.campaigns;
    const board=rankBoard({epoch,complete:true,campaigns,participants,submissions});
    if (board.status!=='final') return pending(epoch,board.reason);
    return {status:'ready',epoch,winners:board.winners,decisions,factSources,
      streaks:[...streaks].map(([wallet,value])=>({wallet,...value})),sourceRef,
      commitmentInput:{policy:'prd-1.2',epoch,posts,decisions,campaigns,participants,factSources,late,sourceRef,winners:board.winners}};
}
export function computeAllocation(input) {
  const plan=settleAllocation({...input,originalSupplyUnits:BigInt(input.originalSupplyUnits)});
  if(plan.status!=='ready')return plan;
  return {...plan,budgetUnits:String(plan.budgetUnits),burnUnits:String(plan.burnUnits),
    awards:plan.awards.map(a=>({...a,amountUnits:String(a.amountUnits)}))};
}
