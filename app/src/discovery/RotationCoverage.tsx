import type { RotationCoverageReport } from "../../../discovery/src/rotation-coverage-model";

const label = (kind: string) => kind.replace("gmgn_token_", "");
export function RotationCoveragePanel({ data, error }: { data: RotationCoverageReport | null; error: string }) {
  return <section className="tenx-panel" id="rotation-coverage"><h2>Broad token coverage</h2>
    <p>Frozen daily selections and recorded GMGN collection attempts over the last 14 UTC days. Opening this view makes no provider requests.</p>
    {error && <p role="alert">Coverage could not refresh. {data ? "The last successful view remains below." : "Check Data status."}</p>}
    {!data ? !error && <p role="status">Loading rotation coverage…</p> : <>
      <p>As of {data.cutoff}. These are collection records, not token-quality results or replayed source payloads.</p>
      <dl><dt>Distinct selected mints</dt><dd>{data.distinct_selected}</dd><dt>Selected mints with an attempt</dt><dd>{data.distinct_attempted}</dd>
        <dt>New-to-GMGN mints attempted</dt><dd>{data.newly_investigated}</dd><dt>UTC days with new-mint attempts</dt><dd>{data.new_investigation_days}</dd>
        <dt>Recorded attempts</dt><dd>{data.counts.attempted}</dd><dt>Recorded successes / failed / pending</dt><dd>{data.counts.recorded_succeeded} / {data.counts.failed} / {data.counts.pending}</dd>
        <dt>Configured request weight</dt><dd>{data.counts.configured_weight}</dd></dl>
      <p>The PRD seeks at least {data.target.mints} previously unreviewed mints across {data.target.utc_days} UTC days. Attempt counts include failures and do not establish that target’s data quality. No automatic scoring promotion follows a count or date.</p>
      <p>“New-to-GMGN” requires no earlier selection recorded at freeze, no prior retained GMGN attempt, and an admitted attempt after selection. It does not mean new to the market, independently reviewed or safe. A missing manifest means not frozen, not zero market activity.</p>
      <div className="tenx-table-scroll"><table><thead><tr><th>UTC day</th><th>Frozen inventory</th><th>Selected</th><th>Selected-mint attempts</th><th>Recorded successes</th><th>Failed / pending</th><th>All-mint core attempts / scheduled baseline left</th></tr></thead><tbody>
        {data.days.map(day => <tr key={day.day}><th>{day.day}</th><td>{day.manifest_cutoff ? `${day.inventory} (${day.regression_fixtures} regression fixtures)` : "Not frozen"}</td><td>{day.manifest_cutoff ? day.targets.length : "—"}</td><td>{day.manifest_cutoff ? day.counts.attempted : "—"}</td><td>{day.manifest_cutoff ? day.counts.recorded_succeeded : "—"}</td><td>{day.manifest_cutoff ? `${day.counts.failed} / ${day.counts.pending}` : "—"}</td><td>{day.all_core_attempts} / {day.scheduled_baseline_remaining}</td></tr>)}
      </tbody></table></div>
      <details><summary>Selected mints, endpoint gaps and manifest references</summary>{data.days.filter(day => day.manifest_cutoff).map(day => <section key={day.day}>
        <h3>{day.day} · frozen {day.manifest_cutoff}</h3><p className="tenx-address">Manifest checksum: {day.manifest_hash}</p>
        {!day.targets.length && <p>No mints selected in this frozen inventory.</p>}
        {day.targets.map(target => <div key={target.address}><a className="tenx-address" href={`/token/solana/${target.address}`}>{target.address}</a>
          <p>{target.first_selection ? "First recorded selection" : "Previously selected"} · {target.prior_gmgn_attempts} prior GMGN attempts{target.newly_investigated ? " · New-mint attempt" : ""}</p>
          <ul>{target.kinds.map(item => <li key={item.kind}>{label(item.kind)}: {item.counts.attempted ? `${item.counts.recorded_succeeded} recorded successes, ${item.counts.failed} failed, ${item.counts.pending} pending` : "Not attempted"}</li>)}</ul>
        </div>)}
      </section>)}</details>
      <p>Weights use the configured Free contracts (basic reads 1, candle parts 2), not an account billing receipt. Selected-mint totals cover only info/security/pool/candle attempts after freeze on the same UTC day. The separate all-mint core count includes prior/operator work against the existing 21-attempt scheduled baseline. Baseline headroom does not guarantee admission; shared quotas, leases, pacing and pauses still apply, and unused days do not carry forward. Other endpoints also consume their original shared allowances. V4 and every evidence/action gate remain unchanged.</p>
    </>}
  </section>;
}
