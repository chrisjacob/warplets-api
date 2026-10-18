import { useEffect, useState } from 'react';
import type { NetworkMember, NetworkMembers as MemberPage } from '../../functions/_lib/network/members';
import './members.css';

function Avatar({ member }: { member: NetworkMember }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [member.avatarUrl]);
  const name = member.displayName || member.username || `FID ${member.fid}`;
  return <span className="network-avatar">{member.avatarUrl && !failed
    ? <img src={member.avatarUrl} alt="" width="48" height="48" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : <span aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>}</span>;
}

export default function NetworkMembers({ query }: { query: string }) {
  const [search, setSearch] = useState(''), [debounced, setDebounced] = useState('');
  const [page, setPage] = useState<{ key: string; cursors: number[] }>({ key: '', cursors: [0] });
  const [data, setData] = useState<MemberPage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const key = `${query}|${debounced}`, cursors = page.key === key ? page.cursors : [0], after = cursors.at(-1)!;
  const historical = new URLSearchParams(query).has('snapshot');
  useEffect(() => {
    if (historical) { setLoading(false); setData(null); return; }
    const controller = new AbortController();
    const params = new URLSearchParams(query); params.set('q', debounced); params.set('after', String(after));
    setLoading(true); setError(''); setData(null);
    fetch(`/api/network/members?${params}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Member profiles could not be loaded.');
      const result = await response.json() as MemberPage;
      if (!controller.signal.aborted) { setData(result); setLoading(false); }
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason.message); setLoading(false); } });
    return () => controller.abort();
  }, [query, debounced, after, historical, revision]);
  return <section className="network-panel network-members" id="network-members" aria-label="Network members">
    <div className="network-panel-head"><div><span className="network-eyebrow">MEET THE NETWORK</span><h2>The profiles behind the map.</h2></div><span>PUBLIC SIGNER PROFILES</span></div>
    <div className="network-member-tools"><label>Find a member<input type="search" aria-label="Search members" placeholder="Username, display name or FID…" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} disabled={historical}/></label><p aria-live="polite">{historical ? 'Latest profiles only' : loading ? 'Finding members…' : data ? `${data.total.toLocaleString()} matching signers` : 'Profiles unavailable'}<small>Uses the country, location, status and token filters above.</small></p></div>
    {historical ? <p className="network-empty">Historical snapshots contain aggregate statistics. Choose “Latest observation” to browse current member profiles.</p> : error ? <div className="network-empty" role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>Retry ↻</button></div> : <>
      <div className="network-member-grid" aria-busy={loading}>{loading ? <p className="network-empty">Loading public profiles…</p> : data?.members.map(member => <a className="network-member" key={member.fid} href={member.profileUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${member.username ? `@${member.username}` : `FID ${member.fid}`} on Farcaster`}><Avatar member={member}/><span className="network-member-name"><strong>{member.displayName || member.username || `FID ${member.fid}`}</strong><span>{member.username ? `@${member.username}` : 'Username not observed'}</span><small>FID {member.fid.toLocaleString()}</small></span><span className="network-member-arrow" aria-hidden="true">↗</span></a>)}{!loading && data?.members.length === 0 && <p className="network-empty">No signers match this search and filter selection.</p>}</div>
      <div className="network-member-pagination"><button disabled={loading || cursors.length === 1} onClick={() => setPage({ key, cursors: cursors.slice(0, -1) })}>← Previous</button><span>Page {cursors.length}</span><button disabled={loading || data?.next == null} onClick={() => { if (data?.next != null) setPage({ key, cursors: [...cursors, data.next] }); }}>Next →</button></div>
    </>}
    <p className="network-note">Public Farcaster profiles from the official client and signer tracker. Names and images can change; missing images use initials. Profile links use a stable FID. Public profiles are visible even in small groups. Individual wallet valuations are not published.</p>
  </section>;
}
