import type { z } from "zod";
import type { MintReviewsResponse } from "../../../discovery/src/mint-review-model";
import { readableReason } from "./client";

type Data=z.infer<typeof MintReviewsResponse>["data"];
const states:Record<string,string>={queued:"Queued for the next paced check",scanning:"Checking bounded curve history",admitted:"Migration found · normal evidence checks still required",unsupported_quote:"Quote asset is not supported",not_found:"No migration found in the bounded scan",expired:"Review window expired"};
export function MintReviewsPanel({data,error}:{data:Data|null;error:string}){
  return <section className="tenx-panel" id="mint-reviews"><h2>Requested token reviews</h2>
    <p>Operators can request an exact Solana mint in Admin. The collector checks its canonical Pump curve when the existing schedule and source budgets permit. A request or migration match does not make a token eligible.</p>
    {error&&<p role="alert">Token review status could not refresh. {data?"The last response remains visible.":"Try again after the next local tick."}</p>}
    {data?<><p>Review source reservations today: {data.reserved_today} / {data.limits.rpc_daily_subset}, inside the shared RPC allowance. Up to {data.limits.bodies_per_turn} bodies per discovery turn, inside its existing six-body limit.</p>
      {data.reviews.length?<ul>{data.reviews.map(r=><li key={r.address}><details><summary><span className="tenx-address">{r.address}</span> · {states[r.state]}</summary>
        <p>Requested {r.queued_at}. Last checkpoint {r.updated_at}. {r.pages} / {data.limits.pages} signature pages; {r.bodies_checked} transaction bodies checked.</p>
        {r.last_error&&<p>Evidence gap: {readableReason(r.last_error)}</p>}
        {r.quote&&<p className="tenx-address">Observed quote mint: {r.quote}</p>}
        {r.migration_signature&&<p><a href={`https://solscan.io/tx/${r.migration_signature}`} target="_blank" rel="noopener noreferrer">Inspect migration transaction ↗</a>{" · "}<a href={`/api/10x/evidence/${r.migration_signature}`} target="_blank" rel="noopener noreferrer">Saved transaction body</a></p>}
        {r.candidate_present?<a href={`/token/solana/${r.address}`}>View token evidence →</a>:<p>No candidate has been saved for this mint.</p>}
      </details></li>)}</ul>:<p>No exact-mint reviews have been requested.</p>}
      <p className="tenx-footnote">At most {data.limits.active} active requests and {data.limits.retained} retained mints. Each request scans up to {data.limits.pages} pages of {data.limits.page_size} signatures in a 24-hour request window. Incomplete scans remain gaps; only WSOL-quoted migrations enter normal inspection. All creation, age, ownership, wallet and freshness gates remain. Reading this view makes zero provider requests.</p>
    </>:!error&&<p role="status">Reading saved token review status…</p>}
  </section>;
}
