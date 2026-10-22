// Private admission preview only. The unchanged scheduler selects again after
// acquiring its original lease; the adapter verifies its planning read pins.
import {shortlist,DEFAULT_POLICY,type Candidate} from "../../discovery/src/model";
import {walletWork} from "../../discovery/src/wallet-work";
import {walletPlan,compareWalletPlans} from "../../discovery/src/wallet-plan";
import {potential,comparePotential} from "../../discovery/src/priority";

export async function previewAutomaticWalletSelection(db:D1Database,all:Candidate[],now:Date){
  // Match the original order, including work validation before attempts and the
  // twenty-contender cutoff BEFORE dropping source-limited/invalid plans.
  await walletWork(db);
  const attempts=await db.prepare("SELECT address,attempted_at,next_attempt_at FROM tenx_wallet_attempts").all<{address:string;attempted_at:string;next_attempt_at:string}>(),tried=new Map(attempts.results.map(r=>[r.address,r])),at=now.toISOString();
  const considered=[],planned=[];
  for(const candidate of shortlist(all,DEFAULT_POLICY,now).filter(c=>potential(c,DEFAULT_POLICY,now)&&(!tried.get(c.address)||tried.get(c.address)!.next_attempt_at<=at)).slice(0,20)){
    const plan=await walletPlan(db,candidate,now);considered.push({address:candidate.address,stage:plan.stage});
    if(!["source_limited","cache_invalid"].includes(plan.stage))planned.push({candidate,plan});
  }
  planned.sort((a,b)=>compareWalletPlans(a,b,now)||(tried.get(a.candidate.address)?.attempted_at??"").localeCompare(tried.get(b.candidate.address)?.attempted_at??"")||comparePotential(a.candidate,b.candidate,DEFAULT_POLICY,now));
  return {selected:planned[0]??null,considered};
}
