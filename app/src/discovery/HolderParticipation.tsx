import type {HolderParticipation} from "../../../discovery/src/holder-participation-model";
import {readableReason} from "./client";
const date=(s:string)=>new Date(s).toLocaleString(undefined,{timeZoneName:"short"});
export function HolderParticipationCell({report,window}:{report:HolderParticipation|undefined;window:"since_first"|"recent"}){
  const interval=report?.[window];
  if(!report||!interval)return <><strong>Unknown</strong><small>{report?.state==="simulation"?"Simulation · no live holder evidence":report?.state==="rejected"?"Saved holder/acquisition evidence rejected":"Comparable saved inventories unavailable"}</small></>;
  return <><strong>{interval.screened_retained_entrants===null?"Unknown":interval.screened_retained_entrants+" screened retained · sample"}</strong>
    <small>{interval.signed_net_buy_entrants??"Unknown"} supported signed net-buy entrants / {interval.raw_entrants??"unknown"} raw entrants</small>
    <small>{date(interval.start_at)} → {date(interval.end_at)}</small><small>{interval.status.replaceAll("_"," ")} · {report.freshness}</small>
    <details><summary>Acquisition & retention checks</summary><p>Experimental sample: at least 0.01 SOL in supported protocol quote transfers, full sampled acquisition present at the endpoint, and at least 30 minutes since the latest sampled buy. This is not total wallet spend, continuous retention or verified independent demand.</p>
      {interval.partitions&&<ul>{Object.entries(interval.partitions).map(([reason,n])=><li key={reason}>{readableReason(reason)}: {n}</li>)}</ul>}
      <p>Wallet sample {report.wallet_observed_at?date(report.wallet_observed_at):"unknown"}. Inventory endpoint {report.latest_inventory_at?date(report.latest_inventory_at):"unknown"}.</p>
      <ul>{[...new Set([...interval.gaps,...report.gaps])].map(g=><li key={g}>{readableReason(g)}</li>)}</ul>
      <p>Observed creator, sponsored/shared-payer and funding connections are conservative screening exclusions, not fraud labels. Missing links do not certify independence. Meaningful 24h growth remains unknown; no score credit.</p>
      <p>Policy: {report.policy}</p><p className="tenx-address">Policy checksum: {report.policy_hash}<br/>Acquisition report: {report.acquisition_hash}<br/>Holder history: {report.history_hash}<br/>Wallet receipt: {report.wallet_hash??"Unknown"}</p>
      <ul>{report.inventory_hashes.map(hash=><li key={hash} className="tenx-address">{hash}</li>)}</ul>
    </details></>;
}
