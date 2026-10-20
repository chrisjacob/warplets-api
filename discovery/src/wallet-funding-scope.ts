import {analyzeWalletEvidence,WalletEvidenceSchema,type WalletEvidence} from "./wallet-analysis";
import {FundingAnchorSchema,loadFundingCheckpoints,type FundingAnchor} from "./funding-history";
import type {FundingScan} from "./funding-history";
import {buildSecondHopOutflows,secondHopAnchors} from "./second-hop";
import {creationRoles} from "./wallet-trades";
import {hashJson} from "./solana";

export const DIRECT_FUNDING_WALLETS=20;
export const directFundingLimit=(input:WalletEvidence):8|20=>input.version==="wallet-input-v5"?20:8;
export const currentWalletReader=(version:string)=>version==="wallet-signals-v4"||version==="wallet-signals-v5";

// Newly covered direct wallets can reveal an earlier outflow for a funder.
// Keep upstream scans only for the exact currently verified outflow anchor.
export async function fundingSecondHopScope(db:D1Database,prior:WalletEvidence,records:WalletEvidence["records"],scans:FundingScan[]){
  if(prior.version!=="wallet-input-v5")return prior.second_hop_scans;
  const origin=records.find(r=>r.signature===prior.asset.creation?.signature)?.transaction;
  const devs=new Set(origin?(await creationRoles(origin,prior.asset.address)).filter(r=>r.signed).map(r=>r.wallet):[]);
  const firstHop=new Set(records.filter(r=>r.purposes.some(p=>p!=="wallet")).map(r=>r.signature).concat(scans.flatMap(s=>s.examined.map(e=>e.signature))));
  const transactions=records.flatMap(r=>r.transaction&&firstHop.has(r.signature)?[r.transaction]:[]);
  const outflows=await buildSecondHopOutflows(transactions,prior.asset.address,prior.asset.pool,prior.asset.creation?.slot??null,devs,scans.map(s=>s.anchor),true);
  const loaded=await loadFundingCheckpoints(db,prior.asset.address,secondHopAnchors(outflows,devs),true);
  for(let i=0;i<loaded.length;i++)if(!loaded[i]!.pages.length&&loaded[i]!.attempted_at==="1970-01-01T00:00:00.000Z"){
    const old=prior.second_hop_scans?.find(s=>s.wallet===loaded[i]!.wallet);
    if(old&&await hashJson(old.anchor)===await hashJson(loaded[i]!.anchor))loaded[i]=old;
  }
  return loaded;
}

// Read-only preparation. Old evidence is replayed, never rewritten or made
// fresh. Only a capacity-limited v4 sample enters the wider v5 collection lane.
export async function expandedFundingScope(db:D1Database,prior:WalletEvidence):Promise<WalletEvidence>{
  if(prior.version!=="wallet-input-v5"&&(prior.version!=="wallet-input-v4"||!prior.gaps.includes("funding_wallet_limit")))return prior;
  const analysis=await analyzeWalletEvidence(prior),anchors:FundingAnchor[]=structuredClone(prior.funding_scans??[]).map(s=>s.anchor);
  if(prior.asset.creation)for(const wallet of analysis.wallets.filter(w=>w.signed_creation))if(!anchors.some(a=>a.wallet===wallet.wallet))anchors.push({wallet:wallet.wallet,kind:"signed_creation",signature:prior.asset.creation.signature,slot:prior.asset.creation.slot,block_time:prior.asset.creation.block_time});
  for(const trade of analysis.trades.filter(t=>t.side==="buy"))if(!anchors.some(a=>a.wallet===trade.wallet))anchors.push({wallet:trade.wallet,kind:"sampled_buy",signature:trade.signature,slot:trade.slot,block_time:trade.block_time});
  if(anchors.length>DIRECT_FUNDING_WALLETS||analysis.gaps.includes("wallet_output_limit"))return prior;
  const scans=await loadFundingCheckpoints(db,prior.asset.address,anchors.map(a=>FundingAnchorSchema.parse(a)),false,20);
  const prepared=WalletEvidenceSchema.parse({...prior,version:"wallet-input-v5",funding_scans:scans,gaps:prior.gaps.filter(g=>g!=="funding_wallet_limit")});
  return {...prepared,second_hop_scans:await fundingSecondHopScope(db,prepared,prepared.records,scans)};
}
