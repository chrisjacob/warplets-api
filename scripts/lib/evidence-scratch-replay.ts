import {CandidateSchema,type Candidate} from "../../discovery/src/model";
import {HolderEvidenceSchema,analyzeHolders} from "../../discovery/src/holders";
import {WalletEvidenceSchema,analyzeWalletEvidence} from "../../discovery/src/wallet-analysis";
import {hashJson} from "../../discovery/src/solana";

export type ScratchResolver={resolve(table:string,key:string):Promise<{address:string;observed_at:string;slot?:number;payload:string}>};
export class ScratchReplayError extends Error {}
// Cache regenerated analyses only, never payloads or promises that can hide failed work.
export function scratchCandidateReplayer(reader:ScratchResolver){
  const cache=new Map<string,Candidate["holders"]|Candidate["wallet_analysis"]>();let candidateChecks=0,analysisChecks=0,withoutReceipts=0;
  async function rebuild(raw:Candidate,cutoff:string):Promise<Candidate>{
    const candidate=CandidateSchema.parse(raw),next=structuredClone(candidate),at=Date.parse(cutoff);
    if(!Number.isFinite(at))throw new ScratchReplayError("scratch_cutoff_invalid");candidateChecks++;
    if(!candidate.holders&&!candidate.wallet_analysis)withoutReceipts++;
    for(const kind of ["holders","wallet_analysis"] as const){
      const analysis=candidate[kind];if(!analysis)continue;
      const hash=kind==="holders"?candidate.holders!.payload_hash:candidate.wallet_analysis!.evidence_hash;
      if(!hash)throw new ScratchReplayError("scratch_analysis_without_receipt");
      if(Date.parse(analysis.observed_at)>at)throw new ScratchReplayError("scratch_future_receipt");
      const key=JSON.stringify([kind,hash,analysis.observed_at,candidate.address,candidate.pool]);let regenerated=cache.get(key);
      if(!regenerated){
        if(cache.size>=10000)throw new ScratchReplayError("scratch_analysis_cache_bound");
        const row=await reader.resolve(kind==="holders"?"tenx_holder_evidence":"tenx_wallet_evidence",hash);
        if(row.address!==candidate.address||row.observed_at!==analysis.observed_at||kind==="holders"&&row.slot!==candidate.holders!.context_slot)throw new ScratchReplayError("scratch_candidate_receipt_identity");
        const payload:unknown=JSON.parse(row.payload);
        if(kind==="holders"){
          HolderEvidenceSchema.parse(payload);const input=payload as Parameters<typeof analyzeHolders>[0];
          if(input.mint!==candidate.address||input.pool!==candidate.pool)throw new ScratchReplayError("scratch_candidate_holder_scope");
          regenerated=await analyzeHolders(input,row.observed_at);
        }else{
          WalletEvidenceSchema.parse(payload);const input=payload as Parameters<typeof analyzeWalletEvidence>[0];
          if(input.asset.address!==candidate.address||input.asset.pool!==candidate.pool)throw new ScratchReplayError("scratch_candidate_wallet_scope");
          regenerated=await analyzeWalletEvidence(input);
        }
        cache.set(key,regenerated);analysisChecks++;
      }
      if(await hashJson(regenerated)!==await hashJson(analysis))throw new ScratchReplayError("scratch_original_analysis_mismatch");
      if(kind==="holders")next.holders=regenerated as Candidate["holders"];else next.wallet_analysis=regenerated as Candidate["wallet_analysis"];
    }
    if(await hashJson(next)!==await hashJson(candidate))throw new ScratchReplayError("scratch_candidate_hash_mismatch");return next;
  }
  return {rebuild,statistics:()=>({candidate_checks:candidateChecks,regenerated_analyses:analysisChecks,cached_analyses:cache.size,candidates_without_receipts:withoutReceipts})};
}
