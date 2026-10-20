import type { z } from "zod";
import type { InboxRecoveryResponse } from "../../../discovery/src/inbox-recovery-model";
import { readableReason } from "./client";
type Data=z.infer<typeof InboxRecoveryResponse>["data"];
export function InboxRecoveryPanel({data,error}:{data:Data|null;error:string}) {
  return <section className="tenx-panel" id="inbox-recovery"><h2>Recheck earlier version gaps</h2>
    <p>Some migration transactions were unreadable by an earlier transaction reader. Automatic discovery can recheck recent rejected signatures once with the updated reader. Every token must still pass creation, graduation, age, ownership and wallet checks.</p>
    {error&&<p role="alert">Recovery status could not refresh. {data?"The last response remains visible.":"Try again after the next local tick."}</p>}
    {data?<><dl><dt>Recent signatures awaiting recheck</dt><dd>{data.pending_recent}</dd><dt>Rechecks admitted today · UTC</dt><dd>{data.used_today} / {data.daily_limit}</dd><dt>Allowance remaining today</dt><dd>{data.remaining_today}</dd><dt>Older version gaps outside the recheck window</dt><dd>{data.older_unsupported}</dd></dl>
      <p>At most {data.per_turn_limit} rechecks per discovery turn, inside its existing six-body limit and shared RPC allowance. Rechecks don’t add a new daily API budget.</p>
      {data.recent.length?<details><summary>Recent recheck evidence</summary><div className="tenx-table-scroll"><table><thead><tr><th>Transaction</th><th>Outcome</th><th>Observed</th></tr></thead><tbody>{data.recent.map(r=><tr key={`${r.signature}:${r.reader_version}`}><td><a href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noopener noreferrer">{r.signature.slice(0,8)}… ↗</a><p className="tenx-address">{r.signature}</p></td><td>{r.state==="reading"?"Reserved · completion not confirmed":readableReason(r.outcome??"unknown")}<p className="tenx-address">{r.payload_hash?`Body hash: ${r.payload_hash}`:"No verified body retained in this receipt"}</p></td><td>{r.finished_at??r.started_at}</td></tr>)}</tbody></table></div></details>:<p>No rechecks admitted yet. The existing local discovery timer runs this work when pacing and quotas permit.</p>}
      <p className="tenx-footnote">The 24-hour queue window limits recheck work; token age is verified separately from its creation proof. A readable transaction may be unrelated or unsupported. Missing, failed or interrupted rechecks remain gaps and are not automatically repeated with the same reader. A body hash records what was read; it does not prove token safety or complete indexing. This status view makes zero provider requests.</p>
    </>:!error&&<p role="status">Reading saved recheck status…</p>}
  </section>;
}
