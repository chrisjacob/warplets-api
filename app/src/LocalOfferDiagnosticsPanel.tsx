import { useState, useSyncExternalStore } from "react";
import {
  clearLocalOfferDiagnostics,
  getLocalOfferDiagnosticsServerSnapshot,
  getLocalOfferDiagnosticsSnapshot,
  isLocalOfferDiagnosticsEnabled,
  subscribeLocalOfferDiagnostics,
} from "./localOfferDiagnostics";

export function LocalOfferDiagnosticsPanel() {
  const entries = useSyncExternalStore(
    subscribeLocalOfferDiagnostics,
    getLocalOfferDiagnosticsSnapshot,
    getLocalOfferDiagnosticsServerSnapshot,
  );
  const [copied, setCopied] = useState(false);

  if (!isLocalOfferDiagnosticsEnabled()) return null;

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details className="mt-4 rounded-xl border border-[#FF9900]/45 bg-[rgba(255,153,0,0.08)] p-3 text-left">
      <summary className="cursor-pointer text-xs font-bold text-[#FFB84D]">
        Local offer diagnostics ({entries.length})
      </summary>
      <p className="mt-2 text-[11px] leading-4 text-[#d7b47d]">
        Local-only wallet and offer events. Recent entries persist across an in-app browser reload. Signatures and secrets are redacted.
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => void copyDiagnostics()} className="rounded-md border border-[#FF9900]/55 px-2 py-1 text-[11px] font-bold text-[#FFB84D]">
          {copied ? "Copied" : "Copy diagnostics"}
        </button>
        <button type="button" onClick={clearLocalOfferDiagnostics} className="rounded-md border border-[#FF7777]/45 px-2 py-1 text-[11px] font-bold text-[#FF9999]">
          Clear
        </button>
      </div>
      <div className="mt-3 max-h-80 overflow-auto rounded-lg bg-black/70 p-2">
        {entries.length === 0 ? (
          <p className="text-[11px] text-[#d7b47d]">No offer events recorded yet.</p>
        ) : (
          [...entries].reverse().map((entry) => (
            <div key={entry.id} className="border-b border-[#FF9900]/15 py-2 last:border-b-0">
              <p className="break-words text-[11px] font-bold text-[#FFB84D]">{entry.event}</p>
              <p className="text-[10px] text-[#a98960]">{entry.at}</p>
              <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-4 text-[#eee0c7]">{JSON.stringify(entry.details, null, 2)}</pre>
            </div>
          ))
        )}
      </div>
    </details>
  );
}

