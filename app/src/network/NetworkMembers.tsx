import { ChevronIcon, ExternalLinkIcon } from './NetworkIcons';
import { useEffect, useState } from 'react';
import type { NetworkMember, NetworkMembers as MemberPage } from '../../functions/_lib/network/members';
import './members.css';
import { walletUsd } from './NetworkWalletCoverage';

function Avatar({ member, warplet }: { member: NetworkMember; warplet: boolean }) {
  const warpletUrl=warplet&&typeof member.warpletTokenId==='number'&&Number.isSafeInteger(member.warpletTokenId)&&member.warpletTokenId>=0?`https://warplets.10x.meme/${member.warpletTokenId}.avif`:null;
  const sources=[...new Set([warpletUrl,member.avatarUrl].filter((url):url is string=>Boolean(url)))];
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [member.avatarUrl,warpletUrl]);
  const source=sources[failed];
  const name = member.displayName || member.username || `FID ${member.fid}`;
  return <span className="network-avatar">{source
    ? <img src={source} alt="" width="104" height="104" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(n=>n+1)}/>
    : <span aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>}</span>;
}

export default function NetworkMembers({ query }: { query: string }) {
  const warpletPortraits=new URLSearchParams(query).get('warplet')==='holders';
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
    <div className="network-panel-head"><div><span className="network-eyebrow">MEET THE NETWORK</span><h2>Meet the network.</h2></div><span>MEMBERS</span></div>
    <div className="network-member-tools"><label>Find a member<input type="search" aria-label="Search members" placeholder="Search members…" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} disabled={historical}/></label><p aria-live="polite">{historical ? 'Latest profiles only' : loading ? 'Finding members…' : data ? `${data.total.toLocaleString()} ${data.total===1?'member':'members'}` : 'Profiles unavailable'}</p></div>
    {historical ? <p className="network-empty">Historical snapshots contain aggregate statistics. Choose “Latest” to browse current member profiles.</p> : error ? <div className="network-empty" role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>Retry ↻</button></div> : <>
      <div className="network-member-grid" aria-busy={loading}>{loading ? <p className="network-empty">Loading public profiles…</p> : data?.members.map(member => <a className="network-member" key={member.fid} href={member.profileUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${member.username ? `@${member.username}` : `FID ${member.fid}`} on Farcaster`}><Avatar member={member} warplet={warpletPortraits}/><span className="network-member-name"><strong>{member.displayName || member.username || `FID ${member.fid}`}</strong><span>{member.username ? `@${member.username}` : 'Username not observed'}</span><span className="network-member-meta"><span className="network-member-wallet" title={`Supported Base assets in verified wallets. ${member.wallet.status==='partial'?'Partial estimate. ':member.wallet.status==='shared'?'Shared-wallet attribution is unresolved. ':member.wallet.status==='no-wallet'?'No verified wallet observed. ':member.wallet.status==='pending'?'Valuation pending. ':''}${member.wallet.measured}/${member.wallet.expected} wallets measured.${member.wallet.observedAt?` Balances checked ${new Date(member.wallet.observedAt).toLocaleString()}.`:''}${member.wallet.stale?' Last valid estimate; some balances or prices are overdue for refresh.':''}`}>{member.wallet.usd!==null?walletUsd(member.wallet.usd):member.wallet.status==='shared'?'Shared wallet':member.wallet.status==='no-wallet'?'No wallet':'Pending'}</span><span className="network-member-separator" aria-hidden="true">·</span><span className="network-member-location" title={member.location??'Location unavailable'}>{member.location || 'Unknown location'}</span></span></span><ExternalLinkIcon className="network-member-arrow"/></a>)}{!loading && data?.members.length === 0 && <p className="network-empty">No signers match this search and filter selection.</p>}</div>
      {(cursors.length>1||data?.next!=null)&&<div className="network-member-pagination"><button disabled={loading || cursors.length === 1} onClick={() => setPage({ key, cursors: cursors.slice(0, -1) })}><ChevronIcon className="network-chevron-left"/>Previous</button><span>Page {cursors.length}</span><button disabled={loading || data?.next == null} onClick={() => { if (data?.next != null) setPage({ key, cursors: [...cursors, data.next] }); }}>Next<ChevronIcon className="network-chevron-right"/></button></div>}
    </>}

  </section>;
}
