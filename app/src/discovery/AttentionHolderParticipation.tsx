import { useEffect, useState } from "react";
import { HolderParticipation as HolderParticipationSchema, verifyHolderParticipation, type HolderParticipation } from "../../../discovery/src/holder-participation-model";
import { HolderParticipationCell } from "./HolderParticipation";
import { getJson } from "./client";

export async function bindAttentionHolderParticipation(raw: unknown, address: string, cutoff: string) {
  const report = await verifyHolderParticipation(raw);
  if (report.address !== address || report.cutoff_at !== cutoff || report.state === "simulation") throw Error("attention_holder_binding_mismatch");
  return report;
}
export function AttentionHolderParticipationValues({ report }: { report: HolderParticipation }) {
  return <div className="tenx-attention-holders"><p>Evaluated at the attention snapshot cutoff: {report.cutoff_at}. Freshness below refers to that cutoff.</p>
    <h5>First to latest saved inventory</h5><HolderParticipationCell report={report} window="since_first"/>
    <h5>Most recent saved inventory interval</h5><HolderParticipationCell report={report} window="recent"/>
    {report.gaps.length > 0 && <details><summary>Holder evidence gaps</summary><ul>{report.gaps.map(gap => <li key={gap}>{gap.replaceAll("_", " ")}</li>)}</ul></details>}
    <p>Meaningful 24h holder growth remains unknown. Screened samples do not verify beneficial independence, continuous retention, organic demand or token safety. No score credit.</p>
    <p className="tenx-address">Report checksum: {report.report_hash}</p>
    <p>This separate holder report is not included in the saved personal review snapshot.</p></div>;
}
function SolanaAttentionHolders({ address, cutoff }: { address: string; cutoff: string }) {
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState<HolderParticipation | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null), key = `${address}:${cutoff}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setFailure(null);
    void getJson(`/api/10x/discovery/attention/holders/solana/${encodeURIComponent(address)}?cutoff=${encodeURIComponent(cutoff)}`, HolderParticipationSchema, controller.signal)
      .then(raw => bindAttentionHolderParticipation(raw, address, cutoff)).then(report => { if (!controller.signal.aborted) setLoaded(report); })
      .catch(() => { if (!controller.signal.aborted) setFailure({ key, message: "Saved holder participation could not be verified. No collection was triggered." }); });
    return () => controller.abort();
  }, [open, address, cutoff, key]);
  const report = loaded?.address === address && loaded.cutoff_at === cutoff ? loaded : null, error = failure?.key === key ? failure.message : null;
  return <details onToggle={event => { if (event.currentTarget === event.target) setOpen(event.currentTarget.open); }}><summary>Acquired and retained holder evidence · saved sample</summary>
    <p>Opening replays existing Solana archives at this fixed attention cutoff. No wallet scan, provider request or scoring change. Other tokens are not loaded automatically.</p>
    {error && <p role="alert">{error}{report ? " The last verified matching report remains visible." : ""}</p>}
    {report ? <AttentionHolderParticipationValues report={report}/> : open && !error ? <p role="status">Checking saved holder evidence…</p> : null}</details>;
}
export function AttentionHolderParticipation({ chain, address, cutoff }: { chain: string; address: string; cutoff: string }) {
  return chain === "solana" ? <SolanaAttentionHolders address={address} cutoff={cutoff}/> : <p>Acquired and retained holder evidence is not connected for this chain. Holder quality remains unknown.</p>;
}
