import { onboardingTenths } from '../domain/earn/index.mjs';
import { seasonActiveWeight } from '../domain/collections/policy.mjs';
// Only deterministic assembly. Persistence adapters select and validate provenance
// at the requested cutoff before passing the valuation receipts here.
export function componentPlan({epoch,cutoff,owner,collections,positions,valuations,intervals,completions}) {
  if(!owner)return {status:'pending',reason:'participant-evidence'};
  const known=new Map(collections.map(c=>[c.collection_id,c]));let highestEligibleLevel=0;
  for(const asset of JSON.parse(owner.assets)) {
    const collection=known.get(asset.collectionId);if(!collection)continue;
    const level=collection.kind==='genesis'?asset.level:seasonActiveWeight(collection.season_start_ms,asset.level,cutoff);
    highestEligibleLevel=Math.max(highestEligibleLevel,level);
  }
  if(positions.some(p=>p.token_days==null))return {status:'pending',reason:'purchase-reconciliation'};
  for(const p of positions) {
    const valuation=valuations[p.token_id];
    if(valuation?.status!=='verified'||valuation.asOfMs!==cutoff||!p.source_ref.endsWith(' / '+valuation.receipt))
      return {status:'pending',reason:'purchase-reconciliation'};
  }
  const purchaseTokenDays=Math.min(50,positions.reduce((n,p)=>n+p.token_days,0));
  return {status:'ready',payload:JSON.stringify({intervals,completions,highestEligibleLevel,purchaseTokenDays}),
    sourceInput:[owner.assets,owner.source_ref,positions,intervals,completions],
    components:{actionTenths:onboardingTenths(epoch,intervals,completions),highestEligibleLevel,purchaseTokenDays}};
}
