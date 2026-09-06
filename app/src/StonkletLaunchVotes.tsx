import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AppPortal } from "./AppViewport";
import { isStonkletsVotesPreview, mockVoteCount, type StonkletVoter, type StonkletVotersPage } from "../shared/stonkletsVotes";

function votersUrl(id: string, stack: boolean, count: number, cursor?: string | null) {
  const params = new URLSearchParams({ id });
  if (stack) params.set("stack", "1");
  if (cursor) params.set("cursor", cursor);
  if (isStonkletsVotesPreview(new URL(window.location.href))) {
    params.set("votes", "1");
    if (count > mockVoteCount(id)) params.set("self", "1");
  }
  return `/api/stonklets/voters?${params}`;
}

async function loadVoters(id: string, stack: boolean, signal: AbortSignal, count: number, cursor?: string | null): Promise<StonkletVotersPage> {
  const response = await fetch(votersUrl(id, stack, count, cursor), { signal });
  if (!response.ok) throw new Error("Couldn't load voters.");
  return response.json();
}

function WalletAvatar({ wallet }: { wallet: string }) {
  let hash = 2166136261;
  for (const char of wallet) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const color = `hsl(${(hash >>> 0) % 360} 70% 60%)`;
  return <svg viewBox="0 0 5 5" aria-hidden="true"><rect width="5" height="5" fill="#23252c" />{Array.from({ length: 15 }, (_, n) => {
    if (!((hash >>> (n % 31)) & 1)) return null;
    const x = n % 3; const y = Math.floor(n / 3);
    return <g key={n} fill={color}><rect x={x} y={y} width="1" height="1" />{x !== 2 && <rect x={4 - x} y={y} width="1" height="1" />}</g>;
  })}</svg>;
}

function VoterAvatar({ voter, stack = false }: { voter: StonkletVoter; stack?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const shareRender = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("shareRender");
  if (stack && (!voter.image || (failed && !shareRender))) return null;
  const label = voter.username ? `@${voter.username}` : voter.wallet;
  return <span data-voter-image-ready={shareRender && voter.image ? loaded : undefined} className="stonklets-voter-avatar" title={label} aria-label={label} tabIndex={stack ? undefined : 0}>
    {voter.image && !failed ? <img src={voter.image} alt="" loading={shareRender ? "eager" : "lazy"} decoding="async" onLoad={() => setLoaded(true)} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <WalletAvatar wallet={voter.wallet} />}
  </span>;
}

function VotersModal({ id, name, count, onClose }: { id: string; name: string; count: number; onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [voters, setVoters] = useState<StonkletVoter[]>([]);
  const [total, setTotal] = useState(count);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (pending.current || cursor === null) return;
    pending.current = true;
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError(false);
    try {
      const page = await loadVoters(id, false, request.signal, count, cursor);
      if (request.signal.aborted) return;
      setTotal(page.total);
      setVoters((previous) => {
        const known = new Set(previous.map((voter) => voter.wallet));
        return [...previous, ...page.voters.filter((voter) => !known.has(voter.wallet))];
      });
      setCursor(page.nextCursor);
    } catch { if (!request.signal.aborted) setError(true); }
    finally { if (controller.current === request) pending.current = false; if (!request.signal.aborted) setLoading(false); }
  }, [id, cursor, count]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { controller.current?.abort(); pending.current = false; element.close(); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    if (cursor === undefined && !error) void load();
  }, [cursor, error, load]);
  useEffect(() => {
    if (cursor == null || error || loading || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void load(); }, { root: body.current, rootMargin: "40px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, error, loading, load]);

  return <AppPortal><dialog ref={dialog} className="identity-link-modal stonklets-voters-modal" aria-labelledby={titleId} onCancel={onClose} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <header className="identity-link-heading"><h2 id={titleId} tabIndex={-1} autoFocus data-no-focus-ring><span>{total.toLocaleString("en-US")}</span> Voted for {name}</h2><button type="button" className="identity-link-close" aria-label="Close voters" title="Close" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg></button></header>
    <div className="stonklets-voters-body" ref={body} aria-busy={loading}>
      <div className="stonklets-voters-grid">{voters.map((voter) => <VoterAvatar key={voter.wallet} voter={voter} />)}</div>
      {loading && <p role="status">Loading voters…</p>}
      {error && <p role="alert">Couldn't load voters.</p>}
      {cursor !== null && <button type="button" ref={sentinel} className="stonklets-voters-more" disabled={loading} onClick={() => void load()}>{error ? "Try again" : "Load more voters"}</button>}
      {cursor === null && !voters.length && <p>No votes yet.</p>}
    </div>
  </dialog></AppPortal>;
}

export default function StonkletLaunchVotes({ id, name, count, compact = false }: { id: string; name: string; count: number; compact?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [votersReady, setVotersReady] = useState(false);
  const [voters, setVoters] = useState<StonkletVoter[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "100px" });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || count < 1) { setVoters([]); return; }
    const controller = new AbortController();
    setVotersReady(false);
    void loadVoters(id, true, controller.signal, count).then((page) => setVoters(page.voters)).catch(() => {}).finally(() => {
      if (!controller.signal.aborted) setVotersReady(true);
    });
    return () => controller.abort();
  }, [id, count, visible]);
  return <div ref={root} data-voters-ready={count < 1 || votersReady} className={compact ? "stonklets-grid-launch-panel" : "stonklets-launch-panel"}>
    {count < 1 ? "Vote to launch this Stonklet!" : <button type="button" className="stonklets-votes-stack" aria-label={`View ${count.toLocaleString("en-US")} votes for ${name}`} onClick={() => setOpen(true)}>
      <span className="stonklets-votes-label">Voted to launch</span>
      {voters.length > 0 && <span className="stonklets-votes-faces" style={{ width: 24 + (voters.length - 1) * 7 }}>{voters.map((voter) => <VoterAvatar key={voter.wallet} voter={voter} stack />)}</span>}
    </button>}
    {open && <VotersModal id={id} name={name} count={count} onClose={() => setOpen(false)} />}
  </div>;
}
