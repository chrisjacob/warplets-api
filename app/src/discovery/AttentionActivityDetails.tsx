import { attentionActivityFresh,type AttentionActivityResult,type AttentionActivityIssueResult } from "../../../discovery/src/attention-activity-model";
import { GmgnActivityShapeDetails } from "./GmgnActivityShape";

const money=(v:number|null)=>v===null?"Unknown":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(v);
export function AttentionActivityDetails({chain,review,issue,asOf}:{chain:string;review:AttentionActivityResult|undefined;issue?:AttentionActivityIssueResult;asOf:string}) {
  if(chain!=="solana")return <p>Wallet-event review is not connected for this chain.</p>;
  const held=issue&&<><p>Wallet-event attempt held at {new Date(issue.received_at).toLocaleString()}: {issue.error.replaceAll("_"," ")}{issue.fields.length?` (${issue.fields.join(", ")})`:""}. No passing evidence; the hourly attempt remains spent.</p><GmgnActivityShapeDetails shape={issue.shape}/></>;
  if(!review)return <>{held}<p>{issue?"No accepted wallet-event sample.":"Wallet-event review pending · one-wallet hourly pilot."}</p></>;
  const a=review.activity,fresh=attentionActivityFresh(review,new Date(asOf));
  return <>{held}<details><summary>GMGN wallet events · {a.version==="gmgn-wallet-activity-v1"?`${a.returned_events}/20 returned`:`${a.returned_events} received`} · {!fresh?"stale":a.review_reasons.length?"review cues":"sample saved"}</summary>
    <p>Requested {a.requested_limit} events; received {a.returned_events}. {a.version==="gmgn-wallet-activity-v2"?`Complete response validated against the ${a.response_event_limit}-event research cap; no rows discarded. Independent transaction comparison remains held for this contract.`:"Original 20-event contract."}</p>
    <p>Saved {new Date(review.received_at).toLocaleString()}. Largest complete regular-wallet flow in the trader sample saved {new Date(review.selection_received_at).toLocaleString()}. Targeted selection; population coverage unknown.</p>
    <p>{a.buy_events} buys; {a.sell_events} sells; {a.non_trade_events} non-trade events excluded from trade totals. {a.unique_transactions} reported transactions. {a.limit_reached?"Page limit reached. ":""}{a.pagination==="more_reported"?"More pages reported; not fetched.":a.pagination==="end_reported"?"Provider reports page end; complete history unverified.":"Pagination unknown."}</p>
    <p>Reported trade times: {a.first_trade_at?new Date(a.first_trade_at).toLocaleString():"Unknown"} – {a.last_trade_at?new Date(a.last_trade_at).toLocaleString():"Unknown"}; {a.unknown_time_events} trade events with unknown time. Sample timing is not full-day coverage.</p>
    <p>Sample buy USD {money(a.reported_buy_usd)}; sell USD {money(a.reported_sell_usd)}. {a.missing_usd_trade_events} missing, {a.unusable_usd_trade_events} unusable and {a.unresolved_signed_usd_trade_events} unresolved signed trade costs.</p>
    <p>{a.repeated_same_side_token_size_events} events in repeated same-side size groups; {a.two_sided_transactions} reported transactions with both buys and sells.</p>
    {a.review_reasons.length>0&&<ul>{a.review_reasons.map(reason=><li key={reason}>{reason.replaceAll("_"," ")}</li>)}</ul>}
    <p>Token identity is echoed; wallet scope is request context. Signatures are not independently verified. Repeated sizes or both-side transactions can reflect ordinary orders, routing or arbitrage. These cues do not establish wash trading; their absence does not prove safety. Organic volume and holder growth remain unknown.</p>
  </details></>;
}
