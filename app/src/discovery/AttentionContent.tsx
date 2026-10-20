import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ContentCampaign, ContentCampaignList, ContentCampaignRequest, ContentPage, ContentRecord, ContentReviewRequest, ContentSubmissionRequest, PublicContentCampaign, PublicContentPage, type ContentSnapshot } from "../../../discovery/src/content-model";
import { IdentitySessionResponse } from "../../../discovery/src/identity-model";

type Submission = z.infer<typeof ContentSnapshot>;
type Campaign = z.infer<typeof PublicContentCampaign>;
const displayDate = (value: string) => new Date(value).toLocaleString();
async function api(path: string, options: { token?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const r = await fetch(`/api/10x/${path}`, { credentials: "same-origin", cache: "no-store", signal: options.signal,
    headers: { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.body === undefined ? {} : { "content-type": "application/json", "x-tenx-identity": "1" }) },
    ...(options.body === undefined ? {} : { method: "POST", body: JSON.stringify(options.body) }),
  });
  const value: unknown = await r.json();
  if (!r.ok) { const error = z.object({ error: z.string() }).safeParse(value); throw new Error((error.success ? error.data.error : `Request failed (${r.status})`).replaceAll("_", " ")); }
  return value;
}
export function ContentLink({ item }: { item: Pick<Submission, "content" | "status" | "updated_at" | "revision"> }) {
  return <><div className="tenx-row"><strong>{item.content.category} · {item.content.platform}</strong><span className="tenx-badge">{item.status}</span></div>
    <a className="tenx-content-url" href={item.content.canonical_url} target="_blank" rel="ugc nofollow noopener noreferrer" referrerPolicy="no-referrer">{item.content.canonical_url} ↗</a>
    <p>Author claim: {item.content.author_claim} · unverified</p>{item.content.comment && <p>{item.content.comment}</p>}
    <p className="tenx-muted">Reviewed state as of {displayDate(item.updated_at)} · revision {item.revision}. Engagement unavailable; no reward credit.</p></>;
}
function CampaignCard({ campaign }: { campaign: Campaign }) {
  const ended = Date.now() >= Date.parse(campaign.ends_at);
  return <article className="tenx-panel"><p className="tenx-eyebrow">Solana · local review campaign · {ended ? "ended" : "open"}</p><h2><a href={`/campaign/${campaign.id}`}>{campaign.title}</a></h2>
    <p>Ten-day review window: {displayDate(campaign.starts_at)} → {displayDate(campaign.ends_at)} (end exclusive).</p>
    <p>OG address supplied for this review: <a href={`https://solscan.io/token/${campaign.og_address}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><code>{campaign.og_address}</code> ↗</a>. Campaign setup does not verify this project's eligibility or endorsement.</p>
    <a href={`/submit?campaign=${campaign.id}`}>Submit an external content link →</a></article>;
}
export function AttentionContentPage({ campaignId, submitOnly = false }: { campaignId?: string; submitOnly?: boolean }) {
  const queryId = new URLSearchParams(window.location.search).get("campaign");
  const [selected, setSelected] = useState(campaignId ?? (z.uuid().safeParse(queryId).success ? queryId! : ""));
  const [campaigns, setCampaigns] = useState<Campaign[]>([]), [campaignCursor, setCampaignCursor] = useState<string | null>(null), [detail, setDetail] = useState<Campaign | null>(null);
  const [feed, setFeed] = useState<z.infer<typeof PublicContentPage> | null>(null), [mine, setMine] = useState<z.infer<typeof ContentPage> | null>(null), [session, setSession] = useState(false);
  const [url, setUrl] = useState(""), [author, setAuthor] = useState(""), [comment, setComment] = useState(""), [category, setCategory] = useState<z.infer<typeof ContentSubmissionRequest>["category"]>("meme");
  const [permission, setPermission] = useState(false), [rights, setRights] = useState(false), [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort(); controller = new AbortController(); const signal = controller.signal, current = ++epoch.current;
      try {
        const [list, identity, campaign] = await Promise.allSettled([
          api("attention/campaigns", { signal }).then(value => ContentCampaignList.parse(value)),
          api("identity/session", { signal }).then(value => IdentitySessionResponse.parse(value)),
          selected ? api(`attention/campaigns/${encodeURIComponent(selected)}`, { signal }).then(value => z.object({ campaign: PublicContentCampaign, feed: PublicContentPage }).strict().parse(value)) : Promise.resolve(null),
        ]);
        if (current !== epoch.current) return;
        const errors: string[] = [];
        if (list.status === "fulfilled") { setCampaigns(list.value.campaigns); setCampaignCursor(list.value.next_cursor); setLoaded(true); }
        else errors.push("Campaigns unavailable. Try refreshing shortly.");
        const authenticated = identity.status === "fulfilled" && identity.value.authenticated;
        setSession(authenticated); if (!authenticated) setMine(null);
        if (identity.status === "rejected") errors.push("Signed identity status is unavailable.");
        if (campaign.status === "fulfilled" && campaign.value) { setDetail(campaign.value.campaign); setFeed(campaign.value.feed); }
        else if (campaign.status === "rejected") { setFeed(null); errors.push("Reviewed links unavailable. Try refreshing shortly."); }
        if (authenticated) {
          const own = ContentPage.parse(await api("attention/mine", { signal }));
          if (current === epoch.current) setMine(own);
        }
        if (current === epoch.current) setError(errors.join(" "));
      } catch (e) { if (!signal.aborted && current === epoch.current) { setError(e instanceof Error ? e.message : "Content unavailable"); setMine(null); setFeed(null); } }
    };
    void refresh(); const onFocus = () => void refresh(); window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    return () => { epoch.current++; controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [selected, version]);
  async function submit() {
    setBusy(true); setError(""); setMessage("");
    try {
      const input = ContentSubmissionRequest.parse({ request_id: requestId, campaign_id: selected, url, category, author_claim: author, comment, permission_to_feature: permission, rights_confirmed: rights });
      const record = ContentRecord.parse(await api("attention/submissions", { body: input }));
      setMessage(`Link saved for review: ${record.snapshot.status}. Authorship and engagement remain unverified.`);
      setUrl(""); setComment(""); setPermission(false); setRights(false); setRequestId(crypto.randomUUID()); setVersion(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Submission failed"); } finally { setBusy(false); }
  }
  async function more(kind: "feed" | "mine" | "campaigns") {
    setBusy(true); setError("");
    try {
      if (kind === "campaigns" && campaignCursor) {
        const next = ContentCampaignList.parse(await api(`attention/campaigns?cursor=${encodeURIComponent(campaignCursor)}`)); setCampaigns(current => [...current, ...next.campaigns]); setCampaignCursor(next.next_cursor);
      } else if (kind === "mine" && mine?.next_cursor) {
        const next = ContentPage.parse(await api(`attention/mine?cursor=${encodeURIComponent(mine.next_cursor)}`)); setMine(current => current ? { ...next, submissions: [...current.submissions, ...next.submissions] } : next);
      } else if (kind === "feed" && feed?.next_cursor) {
        const next = z.object({ feed: PublicContentPage }).passthrough().parse(await api(`attention/campaigns/${selected}?cursor=${encodeURIComponent(feed.next_cursor)}`)); setFeed(current => current ? { ...next.feed, submissions: [...current.submissions, ...next.feed.submissions] } : next.feed);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Page unavailable"); } finally { setBusy(false); }
  }
  return <><header><p className="tenx-eyebrow">PRD · external content & moderation</p><h1>{submitOnly ? "Submit your content" : campaignId ? "Campaign content" : "Bring the meme to life."}</h1><p>Create content on any platform, then submit its link for review.</p></header>
    <section className="tenx-panel tenx-notice"><h2>Local review campaigns</h2><p>These ten-day review windows are separate from real spotlights and the reward accounting lab. No ATTN has been issued, no scores or claims are enabled, and submissions receive no reward credit.</p><p>Wallet ownership identifies the submitter; it does not prove social authorship or a unique human. External engagement is unavailable. Links open only when you choose them; content is not embedded or fetched automatically.</p><a href="/rewards">Explore hypothetical reward accounting →</a></section>
    {error && <p className="tenx-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!campaignId && !submitOnly && <section aria-label="Local review campaigns">{!loaded ? <p role="status">Loading local review campaigns…</p> : campaigns.length === 0 ? <p className="tenx-panel">No local review campaigns yet. The operator can open one in <a href="/admin/10x#content-review">Admin</a>.</p> : campaigns.map(c => <CampaignCard key={c.id} campaign={c} />)}{campaignCursor && <button className="tenx-button" disabled={busy} onClick={() => void more("campaigns")}>More campaigns</button>}</section>}
    {detail && <CampaignCard campaign={detail} />}
    <section className="tenx-panel tenx-content-form" id="submit"><h2>Submit a link</h2><p>{session ? "Signed Solana identity active. Author claims still require separate verification." : <>Sign in with your Solana wallet on <a href="/wallets">My wallets</a>, then return here. Wallet connection alone does not sign you in.</>}</p>
      <form onSubmit={e => { e.preventDefault(); void submit(); }} onChange={() => setRequestId(crypto.randomUUID())}><fieldset disabled={!session || busy}><legend>External content details</legend>
        <label>Review campaign<select required value={selected} onChange={e => { setSelected(e.target.value); setDetail(null); setFeed(null); }}><option value="">Choose a campaign</option>{[...campaigns, ...(detail && !campaigns.some(c => c.id === detail.id) ? [detail] : [])].map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>Public HTTPS content URL<input required type="url" maxLength={2048} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
        <label>Content type<select value={category} onChange={e => setCategory(e.target.value as typeof category)}>{["meme", "video", "article", "thread", "other"].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Author name or handle (unverified claim)<input required maxLength={120} value={author} onChange={e => setAuthor(e.target.value)} /></label>
        <label>How does this relate to the OG?<textarea maxLength={500} rows={3} value={comment} onChange={e => setComment(e.target.value)} /></label>
        <label className="tenx-content-check"><input type="checkbox" required checked={rights} onChange={e => setRights(e.target.checked)} /> I created this content or have permission to submit it.</label>
        <label className="tenx-content-check"><input type="checkbox" required checked={permission} onChange={e => setPermission(e.target.checked)} /> I allow this URL, author claim and commentary to be featured after review.</label>
        <p>No social post is published by this action. Do not submit private links, credentials, personal information or copied media.</p><button className="tenx-button" type="submit" disabled={!selected || !permission || !rights}>Submit for review</button>
      </fieldset></form></section>
    {selected && !submitOnly && <section className="tenx-panel"><h2>Reviewed links</h2><p>Visible after manual review. Visibility verifies neither authorship nor engagement.</p>{feed?.submissions.length === 0 && <p>No visible links yet.</p>}{feed?.submissions.map(s => <article className="tenx-content-item" key={s.id}><ContentLink item={s} /></article>)}{feed?.next_cursor && <button className="tenx-button" disabled={busy} onClick={() => void more("feed")}>More reviewed links</button>}</section>}
    {session && <section className="tenx-panel"><h2>My submissions · private</h2><p>Pending, flagged and rejected submissions are visible only to you and the local operator. Appeals do not restore public visibility automatically.</p>{mine?.submissions.length === 0 && <p>No submissions from this identity yet.</p>}{mine?.submissions.map(s => <OwnSubmission key={`${s.id}:${s.revision}`} item={s} changed={() => setVersion(v => v + 1)} />)}{mine?.next_cursor && <button className="tenx-button" disabled={busy} onClick={() => void more("mine")}>More of my submissions</button>}</section>}
  </>;
}
function OwnSubmission({ item, changed }: { item: Submission; changed: () => void }) {
  const [reason, setReason] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [id, setId] = useState(() => crypto.randomUUID());
  const canAppeal = ["FLAGGED", "REJECTED"].includes(item.status) && item.revision < 19;
  async function appeal() { setBusy(true); try { await api("attention/appeals", { body: { request_id: id, submission_id: item.id, expected_revision: item.revision, reason } }); changed(); } catch (e) { setMessage(e instanceof Error ? e.message : "Appeal failed"); } finally { setBusy(false); } }
  async function evidence() { setBusy(true); try { const record = ContentRecord.parse(await api(`attention/mine/${item.id}`)); setMessage(record.events.map(e => `${e.action}: ${e.reason}`).join(" · ")); } catch (e) { setMessage(e instanceof Error ? e.message : "History unavailable"); } finally { setBusy(false); } }
  return <article className="tenx-content-item"><ContentLink item={item} /><button className="tenx-button" disabled={busy} onClick={() => void evidence()}>Show my review history</button>{canAppeal && <form className="tenx-content-form" onSubmit={e => { e.preventDefault(); void appeal(); }}><label>Appeal reason<textarea required minLength={3} maxLength={500} value={reason} onChange={e => { setReason(e.target.value); setId(crypto.randomUUID()); }} /></label><button className="tenx-button" disabled={busy || reason.trim().length < 3}>Request another review</button></form>}<p role="status">{message}</p></article>;
}
export function ContentModerationLab({ token }: { token: string }) {
  const [title, setTitle] = useState(""), [address, setAddress] = useState(""), [reason, setReason] = useState(""), [id, setId] = useState(() => crypto.randomUUID());
  const [queue, setQueue] = useState<z.infer<typeof ContentPage> | null>(null), [status, setStatus] = useState("PENDING"), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const currentToken = useRef(token); currentToken.current = token;
  useEffect(() => { setQueue(null); setMessage(""); }, [token]);
  useEffect(() => { if (window.location.hash === "#content-review") document.getElementById("content-review")?.scrollIntoView(); }, []);
  async function create() { setBusy(true); setMessage(""); try { const body = ContentCampaignRequest.parse({ request_id: id, title, og_address: address, reason }); const result = ContentCampaign.parse(await api("admin/attention/campaigns", { token, body })); setMessage(`Opened local review campaign ${result.id}. No spotlight or rewards created.`); } catch (e) { setMessage(e instanceof Error ? e.message : "Campaign unavailable"); } finally { setBusy(false); } }
  async function load(cursor?: string) { setBusy(true); setMessage(""); try { const page = ContentPage.parse(await api(`admin/attention/queue?${status ? `status=${status}&` : ""}${cursor ? `cursor=${encodeURIComponent(cursor)}` : ""}`, { token })); if (currentToken.current === token) setQueue(old => cursor && old ? { ...page, submissions: [...old.submissions, ...page.submissions] } : page); } catch (e) { if (currentToken.current === token) setMessage(e instanceof Error ? e.message : "Queue unavailable"); } finally { setBusy(false); } }
  return <section className="tenx-panel tenx-content-form" id="content-review"><h2>Content review & appeals</h2><p>Local review only: ten-day windows, at most ten open, no live campaigns or reward credit. No metadata fetch or social API calls. Making a link visible does not verify its author. Review relevance, rights, safety and promotion disclosures before featuring it.</p>
    <details><summary>Open a local review campaign</summary><form onChange={() => setId(crypto.randomUUID())} onSubmit={e => { e.preventDefault(); void create(); }}><fieldset disabled={!token || busy}><legend>Review campaign setup</legend><label>Campaign title<input required minLength={3} maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label><label>OG Solana mint<input required maxLength={44} value={address} onChange={e => setAddress(e.target.value)} /></label><label>Setup reason<textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="tenx-button">Open ten-day review window</button></fieldset></form></details>
    <label>Queue status<select value={status} onChange={e => { setStatus(e.target.value); setQueue(null); }}><option value="">All states</option>{["PENDING", "FLAGGED", "APPEALED", "VISIBLE", "REJECTED"].map(s => <option key={s}>{s}</option>)}</select></label>
    <button className="tenx-button" disabled={!token || busy} onClick={() => void load()}>Load private moderation queue</button><a href="/attention"> View content campaigns →</a><p role="status">{busy ? "Checking local records…" : message}</p>
    {token && queue?.submissions.length === 0 && <p>No submissions in this queue.</p>}{token && queue?.submissions.map(s => <ReviewSubmission key={`${s.id}:${s.revision}`} item={s} token={token} changed={() => void load()} />)}{token && queue?.next_cursor && <button className="tenx-button" disabled={busy} onClick={() => void load(queue.next_cursor!)}>More queue items</button>}
  </section>;
}
function ReviewSubmission({ item, token, changed }: { item: Submission; token: string; changed: () => void }) {
  const options = (item.status === "REJECTED" ? [] : item.status === "VISIBLE" ? ["FLAGGED", "REJECTED"] : ["VISIBLE", "FLAGGED", "REJECTED"].filter(s => s !== item.status)).filter(s => item.revision < 18 || s !== "VISIBLE");
  const [decision, setDecision] = useState(options[0] ?? ""), [reason, setReason] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [id, setId] = useState(() => crypto.randomUUID());
  async function review() { setBusy(true); try { const body = ContentReviewRequest.parse({ request_id: id, submission_id: item.id, expected_revision: item.revision, decision, reason }); await api("admin/attention/review", { token, body }); changed(); } catch (e) { setMessage(e instanceof Error ? e.message : "Review failed"); } finally { setBusy(false); } }
  async function history() { setBusy(true); try { const record = ContentRecord.parse(await api(`admin/attention/submissions/${item.id}`, { token })); setMessage(record.events.map(e => `${e.action}: ${e.reason}`).join(" · ")); } catch (e) { setMessage(e instanceof Error ? e.message : "History unavailable"); } finally { setBusy(false); } }
  return <article className="tenx-content-item"><ContentLink item={item} /><p>Submission <code>{item.id}</code></p><button className="tenx-button" disabled={busy || !token} onClick={() => void history()}>Verify private review history</button>{options.length > 0 && item.revision < 19 && <form onChange={() => setId(crypto.randomUUID())} onSubmit={e => { e.preventDefault(); void review(); }}><fieldset disabled={!token || busy}><legend>Review revision {item.revision}</legend><label>Decision<select value={decision} onChange={e => setDecision(e.target.value)}>{options.map(s => <option key={s}>{s}</option>)}</select></label><label>Private explanation<textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="tenx-button" disabled={reason.trim().length < 3}>Save review decision</button></fieldset></form>}<p role="status">{message}</p></article>;
}
