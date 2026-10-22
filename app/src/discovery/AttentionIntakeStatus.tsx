import { useEffect, useState } from "react";
import { MintIntakeStatus as StatusSchema, type MintIntakeStatus } from "../../../discovery/src/mint-intake-status-model";
import { getJson } from "./client";
export function bindMintIntakeStatus(raw: unknown, address: string) {
  const report = StatusSchema.parse(raw);
  if (report.address !== address) throw Error("intake_status_identity_mismatch");
  return report;
}
const states = {
  queued: "Queued for migration verification", scanning: "Scanning migration history", admitted: "Migration lead admitted; further checks required",
  unsupported_quote: "Quote currency is not supported by this verifier", not_found: "No matching migration found within the search bound", expired: "Migration review expired",
};
export function AttentionIntakeStatusValues({ report }: { report: MintIntakeStatus }) {
  const review = report.review;
  return <div className="tenx-attention-intake"><p><strong>{review ? states[review.state] : "No migration review requested"}</strong></p>
    <p>Current workflow read at {new Date(report.at).toLocaleString()}. This is separate from the fixed attention snapshot.</p>
    {review && <><p>{review.pages} of 3 signature pages saved · {review.bodies_checked} transaction bodies checked. These counts do not measure token quality.</p>
      <p>Requested {new Date(review.queued_at).toLocaleString()} · last update {new Date(review.updated_at).toLocaleString()}.</p>
      {review.last_error && <p>Recorded interruption: {review.last_error.replaceAll("_", " ")}.</p>}</>}
    <p>Candidate record: {report.candidate_saved ? "saved" : "not saved"} · migration lead: {report.migration_lead_saved ? "saved" : "not saved"}. Record presence does not verify its evidence.</p>
    {report.control.paused && <p>Discovery collection is paused.</p>}
    {report.control.retry_after && Date.parse(report.control.retry_after) > Date.parse(report.at) && <p>Shared source backoff until {new Date(report.control.retry_after).toLocaleString()}.</p>}
    {report.control.next_refresh_at && <p>Recorded next refresh time: {new Date(report.control.next_refresh_at).toLocaleString()}. Other shared controls may defer work.</p>}
    <p>Migration-intake RPC reservations today: {report.control.reserved_today} of 20, shared across requests. This is a budget count, not a completion forecast.</p>
    <p>This verifier covers Pump.fun migrations to PumpSwap using wrapped SOL, with a 24-hour migration window. A missing, expired or exhausted review does not establish a scam or an absence of attention. Candidate, state and holder checks remain separate; no score or launch credit.</p>
    <p>This workflow status is not included in the saved personal review snapshot.</p></div>;
}
function SolanaIntakeStatus({ address }: { address: string }) {
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<MintIntakeStatus | null>(null), [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setBusy(true); setFailure(null);
    void getJson(`/api/10x/discovery/intake/solana/${encodeURIComponent(address)}`, StatusSchema, controller.signal)
      .then(raw => bindMintIntakeStatus(raw, address)).then(report => { if (!controller.signal.aborted) setLoaded(report); })
      .catch(() => { if (!controller.signal.aborted) setFailure(address); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, address, revision]);
  const report = loaded?.address === address ? loaded : null, error = failure === address;
  return <details onToggle={event => { if (event.currentTarget === event.target) setOpen(event.currentTarget.open); }}><summary>Migration intake · saved workflow status</summary>
    <p>Opening reads existing local status for this token. It cannot queue, retry or collect anything. No automatic polling.</p>
    {error && <p role="alert">Saved intake status could not be verified.{report ? " The last matching read remains visible with its original time." : ""}</p>}
    {report ? <AttentionIntakeStatusValues report={report}/> : open && !error ? <p role="status">Reading saved migration intake…</p> : null}
    <button className="tenx-button tenx-button--quiet" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh saved intake status</button>
  </details>;
}
export function AttentionIntakeStatus({ chain, address }: { chain: string; address: string }) {
  return chain === "solana" ? <SolanaIntakeStatus address={address}/> : <p>Migration intake is not connected for this chain. Quality remains unknown.</p>;
}
