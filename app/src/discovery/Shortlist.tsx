import { useEffect, useState } from "react";
import type { CandidateCard } from "../../../discovery/src/candidate-card";
import { ComparisonToggle } from "./TokenComparison";
import { TokenImage } from "./TokenMarket";
import { createShortlistRepository, shortlistKey, SHORTLIST_LIMIT, type ShortlistAction, type ShortlistIdentity, type ShortlistMode, type ShortlistState } from "./shortlist-store";

const repository = createShortlistRepository(() => window.localStorage);
export function useShortlist(mode: ShortlistMode) {
  const [state, setState] = useState(() => repository.read(mode));
  useEffect(() => {
    setState(repository.read(mode));
    const sync = (event: StorageEvent) => {
      // Ignore sessionStorage and unrelated application keys.
      try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      if (event.key === null || event.key === shortlistKey(mode)) setState(repository.read(mode));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [mode]);
  const current = state.mode === mode ? state : repository.read(mode);
  const change = (action: ShortlistAction) => setState(repository.change(mode, action));
  const save = (token: ShortlistIdentity) => change(current.entries.some(entry => entry.address === token.address) ? { type: "remove", address: token.address } : { type: "save", token });
  return { state: current, save, remove: (address: string) => change({ type: "remove", address }), clear: () => change({ type: "clear" }) };
}

export function ShortlistToggle({ token, state, onToggle }: { token: ShortlistIdentity; state: ShortlistState; onToggle: (token: ShortlistIdentity) => void }) {
  const saved = state.entries.some(entry => entry.address === token.address);
  return <button type="button" className="tenx-button tenx-button--quiet tenx-save-toggle" aria-label={`${saved ? "Remove saved mint" : "Save mint"} ${token.address}`} aria-pressed={saved}
    disabled={state.status === "invalid" || (!!token.mode && token.mode !== state.mode) || (!saved && state.entries.length >= SHORTLIST_LIMIT)} onClick={() => onToggle(token)}>{saved ? "Saved · remove" : "Save for later"}</button>;
}

export function ShortlistNotice({ state }: { state: ShortlistState }) {
  return <>{state.status === "memory" && <p className="tenx-notice" role="status">Browser storage is unavailable. This list is kept in memory until you reload or close this page.</p>}
    {state.status === "invalid" && <p className="tenx-notice" role="alert">The saved list has an unsupported or damaged format. It has not been overwritten. Clear the saved list to start again.</p>}
    {state.message && <p className="tenx-footnote" role="status">{state.message}</p>}</>;
}

export function ShortlistPanel({ state, candidates, selected, onRemove, onClear, onCompare }: {
  state: ShortlistState; candidates: CandidateCard[]; selected: string[];
  onRemove: (address: string) => void; onClear: () => void; onCompare: (address: string) => void;
}) {
  return <section id="saved-tokens" className="tenx-shortlist"><ShortlistNotice state={state} />
    <details className="tenx-panel"><summary>{state.mode === "fixture" ? "Saved simulation examples" : "Saved tokens"} · {state.entries.length} / {SHORTLIST_LIMIT}</summary>
      <p>Saved only in this browser. Open a token for its saved evidence or select up to three to compare. Names are labels; confirm the mint.</p>
      {state.mode === "fixture" && <p className="tenx-notice">Simulation list · separate from your saved live tokens.</p>}
      {state.entries.length ? <ul className="tenx-shortlist-items">{state.entries.map(entry => {
        const candidate = candidates.find(c => c.address === entry.address && c.mode === state.mode);
        const name = candidate?.name ?? entry.name, symbol = candidate?.symbol ?? entry.symbol;
        return <li key={entry.address}><div className="tenx-shortlist-identity"><TokenImage url={candidate?.market?.image_url} name={name} symbol={symbol} />
          <div><a href={`/token/solana/${entry.address}${state.mode === "fixture" ? "?mode=fixture" : ""}`}>{name || "Saved token"} · {symbol}</a><p className="tenx-address">{entry.address}</p>
            <small>Saved {new Date(entry.saved_at).toLocaleString()}. {candidate ? "Shown in current results." : "Outside current results · open token for saved evidence."}</small></div></div>
          <div className="tenx-shortlist-actions"><ComparisonToggle address={entry.address} selected={selected} onToggle={onCompare} />
            <button type="button" className="tenx-button tenx-button--quiet" aria-label={`Remove saved mint ${entry.address}`} onClick={() => onRemove(entry.address)}>Remove saved token</button></div></li>;
      })}</ul> : <p>No tokens saved yet. Use Save for later on a card, table row or token page.</p>}
      <button type="button" className="tenx-button tenx-button--quiet" disabled={!state.entries.length && state.status === "saved"} onClick={onClear}>Clear saved list</button>
    </details>
  </section>;
}
