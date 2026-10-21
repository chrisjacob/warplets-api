import type {RecentActivity} from "../../../discovery/src/recent-activity-model";
import {readableReason} from "./client";
import {tokenMoney} from "./TokenOverview";

const date=(value:string)=>new Date(value).toLocaleString(undefined,{timeZoneName:"short"});
export function RecentActivityCell({report,minutes}:{report:RecentActivity|undefined;minutes:5|60|360}){
  const period=report?.periods.find(p=>p.minutes===minutes);
  if(!report||!period)return <><strong>Unknown</strong><small>{report?.state==="simulation"?"Simulation · no live candle evidence":report?.state==="rejected"?"Saved candles rejected":"No saved candle window"}</small></>;
  const {recent,previous}=period;
  return <><strong>{recent.reported_volume_usd===null?"Unknown volume":tokenMoney(recent.reported_volume_usd)+" reported"}</strong>
    <small>{recent.price_change_pct===null?"Price change unknown":`${recent.price_change_pct>=0?"+":""}${recent.price_change_pct.toFixed(2)}% price change`}</small>
    <small>{recent.observed_minutes} / {minutes} closed minutes · {recent.status}{report.freshness!=="fresh"?" · "+report.freshness:""}</small>
    <small>{date(recent.start_at)} → {date(recent.end_at)}</small>
    <small>{period.reported_volume_ratio===null?"Previous-period volume ratio unknown":`${period.reported_volume_ratio.toFixed(2)}× preceding ${minutes===5?"5m":"1h"} reported volume`}</small>
    <details><summary>Recent window & coverage</summary><p>GMGN token-request scope. Price-consistent volume units remain same-provider reports. Positive-volume minutes measure candle activity; trader breadth and organic demand are unknown. No score credit.</p>
      <p>{recent.positive_volume_minutes??"Unknown"} / {minutes} minutes with positive reported USD volume. Fetched {report.fetched_at?date(report.fetched_at):"Unknown"}. Receipt span: {report.receipt_span_ms===null?"Unknown":(report.receipt_span_ms/1000)+" seconds"}.</p>
      {previous&&<p>Preceding period: {date(previous.start_at)} → {date(previous.end_at)}. {previous.observed_minutes} / {previous.minutes} minutes, {previous.status}. Reported volume {previous.reported_volume_usd===null?"unknown":tokenMoney(previous.reported_volume_usd)}.</p>}
      <ul>{[...new Set([...recent.gaps,...previous?.gaps??[],...period.gaps,...report.gaps])].map(g=><li key={g}>{readableReason(g)}</li>)}</ul>
      <p>Experimental measurement policy: {report.policy}.</p><p className="tenx-address">Policy checksum: {report.policy_hash}<br/>Parent candle report: {report.parent_window_hash}</p>
      <ul>{report.references.map(r=><li key={r.request_id}><span className="tenx-address">{r.request_id}<br/>{r.receipt_hash}</span></li>)}</ul>
    </details></>;
}
