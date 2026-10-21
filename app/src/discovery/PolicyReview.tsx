import { useEffect, useState } from "react";
import { z } from "zod";
import { POLICY_FIELDS, PolicyEditsSchema, PolicyPreviewResponseSchema, PublicPolicySchema, type PolicyField } from "../../../discovery/src/policy-model";
import { getJson, PoliciesResponse, readableReason } from "./client";
import {DiscoveryScoreMethod} from "./DiscoveryScore";

type PreviewRecord = z.infer<typeof PolicyPreviewResponseSchema>["record"];
function usePolicy() {
  const [data, setData] = useState<z.infer<typeof PublicPolicySchema> | null>(null), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void getJson("/api/10x/transparency/policies", PoliciesResponse, controller.signal).then(r => setData(r.data)).catch(() => { if (!controller.signal.aborted) setError("The local policy could not load. Check Data status."); }); return () => controller.abort(); }, []);
  return { data, error };
}
export function PolicyView() {
  const { data, error } = usePolicy(), p = data?.policy;
  return <><header className="tenx-heading"><p className="tenx-eyebrow">TRANSPARENCY / LOCAL RULES</p><h1>Understand the scores.</h1><p>Discovery weights, evidence coverage and the separate checks for action readiness.</p></header>
    <aside className="tenx-notice">Proposed local policy. Production approval is pending. No live voting, launches, rewards or spending are enabled. Missing required evidence still blocks eligibility.</aside>
    {error && <p role="alert">{error}</p>}{data && p ? <>{data.discovery_scoring&&<DiscoveryScoreMethod policy={data.discovery_scoring.policy} policyHash={data.discovery_scoring.policy_hash} />}<section className="tenx-panel"><h2>Separate action policy · {p.version}</h2><p>At most {p.max_candidates} eligible candidates in the action shortlist. Verified token creation within {p.max_age_hours} hours and a separate finalized Pump → PumpSwap graduation proof are required for those gates. Observed tokens can still appear in score-ranked browsing before passing them.</p><p>{data.display_score}</p><p className="tenx-address">Action-policy SHA-256: {data.policy_hash}</p><a href="/elections">Inspect frozen election rules & results →</a></section>
      <section className="tenx-panel"><h2>Required evidence & freshness</h2><dl><dt>Holder inventory</dt><dd>{p.require_holder_evidence ? "Required" : "Not required"}</dd><dt>Wallet and pre-buy funding analysis</dt><dd>{p.require_wallet_analysis ? "Required" : "Not required"}</dd><dt>Market snapshot maximum age</dt><dd>{p.max_market_age_seconds} seconds</dd><dt>Mint / pool risk maximum age</dt><dd>{p.max_risk_age_seconds} seconds</dd><dt>Holder inventory maximum age</dt><dd>{p.max_holder_age_seconds} seconds</dd><dt>Wallet snapshot maximum age</dt><dd>{p.max_wallet_age_seconds} seconds</dd></dl><p>Mint and freeze authorities must be revoked and canonical pool reserves verified. Owner inventory must reconcile; wallet samples need adequate trade and funding coverage. Partial inventories can show failures but cannot establish a pass.</p></section>
      <section className="tenx-panel"><h2>Numeric thresholds</h2><div className="tenx-table-scroll"><table><thead><tr><th>Check</th><th>Threshold</th></tr></thead><tbody>{POLICY_FIELDS.map(f => <tr key={f.key}><td>{f.label}</td><td>{f.direction === "minimum" ? "At least" : "At most"} {p[f.key].toLocaleString()} {f.unit}</td></tr>)}</tbody></table></div></section>
      <section className="tenx-panel"><h2>Review signals · separate from eligibility</h2>{data.diagnostics.map(d => <div key={d.name}><h3>{d.name}</h3><p>{d.rule}</p></div>)}<p>These signals do not change eligibility, ranking or election outcomes. No warning establishes fraud; absence of a warning does not establish safety.</p><a href="/research">Inspect outcomes & inactive proposals →</a></section>
      <section className="tenx-panel"><h2>Coverage & remaining gaps</h2><ul>{data.gaps.map(g => <li key={g}>{g}</li>)}</ul><a href="/status">Inspect budgets & source status →</a></section><p className="tenx-footnote">Local operators can compare stricter thresholds in <a href="/admin/10x">Admin</a>. Previews use saved observations at one frozen time and cannot activate changes.</p>
    </> : !error && <p role="status">Loading local policy…</p>}</>;
}
export function PolicyLab({ token }: { token: string }) {
  const { data, error } = usePolicy();
  const [fields, setFields] = useState<Partial<Record<PolicyField, string>>>({}), [reason, setReason] = useState(""), [id, setId] = useState(() => crypto.randomUUID()), [savedId, setSavedId] = useState("");
  const [record, setRecord] = useState<PreviewRecord | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const reset = () => { setId(crypto.randomUUID()); setRecord(null); setMessage(""); };
  async function run(load = false) {
    if (!data) return;
    setBusy(true); setMessage(""); setRecord(null);
    try {
      const edits = load ? {} : PolicyEditsSchema.parse(Object.fromEntries(POLICY_FIELDS.map(f => [f.key, fields[f.key] === undefined ? data.policy[f.key] : fields[f.key]!.trim() === "" ? NaN : Number(fields[f.key])])));
      const targetId = load ? z.uuid().parse(savedId) : id;
      if (!load && reason.trim().length < 3) throw new Error("Enter a reason of at least three characters.");
      const response = await fetch(load ? `/api/10x/admin/policies/previews/${targetId}` : "/api/10x/admin/policies/preview", { method: load ? "GET" : "POST", cache: "no-store", headers: { authorization: `Bearer ${token}`, ...(!load ? { "content-type": "application/json" } : {}) }, ...(!load ? { body: JSON.stringify({ request_id: id, reason, edits }) } : {}) });
      const value: unknown = await response.json();
      if (!response.ok) { const code = z.object({ error: z.string() }).safeParse(value); throw new Error(response.status === 401 ? "Enter the local operator token." : code.success ? readableReason(code.data.error) : "Preview unavailable."); }
      const result = PolicyPreviewResponseSchema.parse(value); setRecord(result.record); setSavedId(result.record.id); setMessage("Replay verified. Active policy unchanged. Zero provider requests.");
    } catch (e) { setMessage(e instanceof z.ZodError ? "Check the numeric fields or saved preview ID." : e instanceof Error ? e.message : "Preview failed."); }
    finally { setBusy(false); }
  }
  function download() {
    if (!record) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `10x-policy-preview-${record.id}.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="tenx-panel"><h2>Policy lab · stricter thresholds only</h2><p>Compare saved candidates at one frozen time. Proof, age, freshness, holder and wallet requirements stay locked. No preview can activate a policy. Up to 20 new previews per UTC day; retries reuse the original record.</p><a href="/transparency">Read the current rules →</a>
    {error && <p role="alert">{error}</p>}{data && <><form onSubmit={e => { e.preventDefault(); void run(); }}><fieldset disabled={busy}><div className="tenx-policy-fields">{POLICY_FIELDS.map(f => <label key={f.key}>{f.label} ({f.unit})<input type="number" step={f.unit === "%" ? "0.1" : "1"} min={f.direction === "minimum" ? data.policy[f.key] : 0} max={f.direction === "maximum" ? data.policy[f.key] : f.key === "min_sampled_buyers" ? 20 : f.key === "min_holders" ? 100000 : undefined} value={fields[f.key] ?? data.policy[f.key]} onChange={e => { setFields(s => ({ ...s, [f.key]: e.target.value })); reset(); }} /></label>)}</div><label className="tenx-admin-token">Reason for comparison<input maxLength={300} minLength={3} required value={reason} onChange={e => { setReason(e.target.value); reset(); }} placeholder="What hypothesis are you testing?" /></label><div className="tenx-admin-actions"><button className="tenx-button" disabled={!token} type="submit">Compare saved candidates</button><button className="tenx-button tenx-button--quiet" type="button" onClick={reset}>New snapshot</button></div></fieldset></form>
      <label className="tenx-admin-token">Saved preview ID<input value={savedId} onChange={e => setSavedId(e.target.value)} disabled={busy} /></label><button className="tenx-button tenx-button--quiet" disabled={busy || !token || !savedId} onClick={() => void run(true)}>Load & replay saved preview</button></>}
    <p role="status" aria-live="polite">{busy ? "Comparing saved evidence…" : message}</p>
    {record && <div><h3>Frozen comparison · no activation</h3><p>{new Date(record.created_at).toLocaleString()} · {record.inputs.baseline.candidates.length} stored live candidates, including expired and incomplete observations.</p><p>{record.reason}</p><dl><dt>Eligible · current → proposed</dt><dd>{record.result.baseline.counts.eligible} → {record.result.proposed.counts.eligible}</dd><dt>Provisional · current → proposed</dt><dd>{record.result.baseline.counts.provisional} → {record.result.proposed.counts.provisional}</dd><dt>Excluded · current → proposed</dt><dd>{record.result.baseline.counts.excluded} → {record.result.proposed.counts.excluded}</dd></dl><p>{record.result.changed.length} tokens have changed eligibility or reasons. This is a snapshot comparison, not an outcome backtest.</p>
      <details><summary>Threshold differences</summary><ul>{POLICY_FIELDS.filter(f => record.inputs.proposed_policy[f.key] !== record.inputs.baseline.policy[f.key]).map(f => <li key={f.key}>{f.label}: {record.inputs.baseline.policy[f.key]} → {record.inputs.proposed_policy[f.key]}</li>)}</ul></details>
      {!!record.result.changed.length && <details><summary>Changed tokens & reasons</summary>{record.result.changed.map(c => <div key={c.address}><a href={`/token/solana/${c.address}`}>{c.symbol}</a><p className="tenx-address">{c.address}</p><p>{c.before} → {c.after}</p><ul>{c.added_reasons.map(r => <li key={`add:${r}`}>Added: {readableReason(r)}</li>)}{c.removed_reasons.map(r => <li key={`remove:${r}`}>Removed: {readableReason(r)}</li>)}</ul></div>)}</details>}
      <details><summary>Replay hashes</summary><p className="tenx-address">Input: {record.input_hash}</p><p className="tenx-address">Result: {record.result_hash}</p><p className="tenx-address">Record: {record.record_hash}</p><p>Hashes verify consistency of retained inputs and rules, not source completeness or token safety.</p></details><button className="tenx-button tenx-button--quiet" onClick={download}>Download replay evidence</button></div>}
  </section>;
}
