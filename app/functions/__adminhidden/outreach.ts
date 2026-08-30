export const onRequestGet: PagesFunction = () => {
  const html = /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>10X Admin — Holder Outreach</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#e8e8e8;font:14px/1.45 system-ui,sans-serif;padding:24px}a{color:#7dd3fc}h1{font-size:1.45rem;margin:0}h2{font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:0 0 12px}.top{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:20px}.nav{display:flex;gap:10px;align-items:center}.panel{background:#171717;border:1px solid #303030;border-radius:10px;padding:16px;margin-bottom:16px}.hidden{display:none!important}label{display:block;color:#999;font-size:.78rem;margin-bottom:4px}input,select{background:#0d0d0d;border:1px solid #383838;color:#eee;border-radius:7px;padding:9px 10px;min-height:38px}input{width:100%}button,.button{display:inline-flex;align-items:center;justify-content:center;background:#7c3aed;color:#fff;border:0;border-radius:7px;padding:9px 13px;cursor:pointer;text-decoration:none;font:inherit;white-space:nowrap}button:hover,.button:hover{background:#6d28d9}button.secondary,.button.secondary{background:#262626;border:1px solid #444}button:disabled{opacity:.55;cursor:not-allowed}.filters{display:grid;grid-template-columns:minmax(220px,2fr) repeat(4,minmax(125px,1fr)) auto;gap:10px;align-items:end}.stats{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px}.stat{background:#0d0d0d;border:1px solid #2d2d2d;border-radius:8px;padding:12px}.stat strong{display:block;color:#fff;font-size:1.45rem}.stat span{color:#888;font-size:.74rem}.progress{height:9px;background:#0d0d0d;border-radius:99px;overflow:hidden;margin:12px 0 6px}.progress>div{height:100%;width:0;background:#22c55e;transition:width .2s}.muted{color:#888;font-size:.8rem}.status{display:none;margin-top:10px;padding:9px 11px;border-radius:7px}.status.ok{display:block;color:#4ade80;background:#14532d44;border:1px solid #16a34a66}.status.err{display:block;color:#f87171;background:#7f1d1d44;border:1px solid #dc262666}.table-wrap{overflow:auto;border:1px solid #2c2c2c;border-radius:8px}table{width:100%;border-collapse:collapse;min-width:1180px}th{position:sticky;top:0;background:#151515;color:#888;text-align:left;font-size:.72rem;font-weight:600;text-transform:uppercase;padding:9px;border-bottom:1px solid #333}td{padding:9px;border-bottom:1px solid #242424;vertical-align:top}.identity{display:flex;gap:9px;min-width:190px}.avatar{width:36px;height:36px;border-radius:50%;background:#232323;object-fit:cover}.username{font-weight:700;color:#fff}.cast{max-width:430px;white-space:pre-wrap;overflow-wrap:anywhere}.cast-meta,.counts{font-size:.75rem;color:#888;margin-top:5px}.pill{display:inline-block;border-radius:999px;padding:2px 7px;font-size:.7rem;font-weight:700}.pill.yes{color:#4ade80;background:#14532d66}.pill.no{color:#fbbf24;background:#78350f55}.actions{display:flex;flex-wrap:wrap;gap:6px;min-width:245px}.actions button,.actions .button{padding:6px 9px;font-size:.76rem;margin:0}.pager{display:flex;align-items:center;justify-content:space-between;margin-top:12px}.login{max-width:430px;margin:10vh auto}.login input{margin-bottom:10px}@media(max-width:900px){body{padding:12px}.stats{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:1fr 1fr}.filters .search{grid-column:1/-1}.top{align-items:flex-start;flex-direction:column}}@media(max-width:520px){.filters,.stats{grid-template-columns:1fr}.filters .search{grid-column:auto}}
  </style>
</head>
<body>
  <div id="login" class="login">
    <h1>10X Admin</h1>
    <section class="panel" style="margin-top:16px">
      <h2>Holder outreach sign in</h2>
      <label for="tokenInput">Admin token</label>
      <input id="tokenInput" type="password" autocomplete="off">
      <button id="loginBtn">Sign in</button>
      <div id="loginErr" class="status err">Invalid token</div>
      <div id="codeStep" class="hidden" style="margin-top:14px">
        <label for="codeInput">Email code</label>
        <input id="codeInput" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
        <button id="codeBtn">Verify code</button>
        <div id="codeHelp" class="muted" style="margin-top:8px"></div>
        <div id="codeErr" class="status err">Invalid code</div>
      </div>
    </section>
  </div>

  <main id="app" class="hidden">
    <header class="top">
      <div><h1>Holder Outreach</h1><div class="muted">Recent Farcaster activity from current 10X Warplets holders</div></div>
      <nav class="nav"><a class="button secondary" href="/__adminhidden/">Notifications admin</a><button class="secondary" id="logoutBtn">Sign out</button></nav>
    </header>

    <section class="panel">
      <div class="stats">
        <div class="stat"><strong id="activeCount">—</strong><span>Active holders (24h)</span></div>
        <div class="stat"><strong id="convertedCount">—</strong><span>Known conversions</span></div>
        <div class="stat"><strong id="contactedCount">—</strong><span>People contacted</span></div>
        <div class="stat"><strong id="actionCount">—</strong><span>Outreach actions</span></div>
        <div class="stat"><strong id="filteredCount">—</strong><span>Filtered rows</span></div>
      </div>
    </section>

    <section class="panel">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button id="syncBtn">Refresh all holder activity</button>
        <button id="stopSyncBtn" class="secondary hidden">Stop after this batch</button>
        <span id="syncText" class="muted">No activity scan has completed yet.</span>
      </div>
      <div class="progress"><div id="syncBar"></div></div>
      <div class="muted">Refresh is resumable and processes 200 holders per batch using Neynar's filtered feed. “Truncated” groups remain cached and are reported rather than silently deleted.</div>
      <div id="syncStatus" class="status"></div>
    </section>

    <section class="panel">
      <div class="filters">
        <div class="search"><label for="searchInput">Search cast, name, FID or Warplet</label><input id="searchInput" placeholder="Search…"></div>
        <div><label for="convertedFilter">Conversion</label><select id="convertedFilter"><option value="no">Not converted</option><option value="yes">Converted</option><option value="all">All</option></select></div>
        <div><label for="contactedFilter">Outreach</label><select id="contactedFilter"><option value="no">Never contacted</option><option value="yes">Contacted</option><option value="all">All</option></select></div>
        <div><label for="eligibilityFilter">Eligibility</label><select id="eligibilityFilter"><option value="eligible">Eligible only</option><option value="opted-out">Opted out</option><option value="all">All</option></select></div>
        <div><label for="templateSelect">Message</label><select id="templateSelect"></select></div>
        <button id="filterBtn">Apply</button>
      </div>
    </section>

    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Latest cast</th><th>Holder</th><th>Cast</th><th>Warplet</th><th>Converted</th><th>Outreach</th><th>Actions</th></tr></thead>
          <tbody id="rowsBody"><tr><td colspan="7" class="muted" style="text-align:center;padding:24px">Loading…</td></tr></tbody>
        </table>
      </div>
      <div class="pager"><button class="secondary" id="prevBtn">Previous</button><span id="pageText" class="muted"></span><button class="secondary" id="nextBtn">Next</button></div>
      <div id="tableStatus" class="status"></div>
    </section>
  </main>

<script>
  let token = '';
  let adminSession = '';
  let pending2faNonce = '';
  let offset = 0;
  const limit = 100;
  let total = 0;
  let rows = [];
  let syncing = false;
  let latestSyncState = {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
    });
  }
  function showStatus(id, message, error) {
    const element = document.getElementById(id);
    element.className = 'status ' + (error ? 'err' : 'ok');
    element.textContent = message;
  }
  function clearStatus(id) {
    const element = document.getElementById(id);
    element.className = 'status';
    element.textContent = '';
  }
  function formatTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(value));
  }
  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('Clipboard access was denied.');
    }
  }
  function showLogin() {
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
  function showApp() {
    document.getElementById('login').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadRows();
  }
  async function api(path, options) {
    const supplied = options || {};
    const response = await fetch(path, Object.assign({}, supplied, {
      headers: Object.assign({ 'x-admin-token':token, 'x-admin-session':adminSession }, supplied.headers || {})
    }));
    if (response.status === 401) {
      adminSession = '';
      syncing = false;
      showLogin();
      throw new Error('Your admin session expired.');
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('Server returned HTTP ' + response.status + ' instead of JSON.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || ('Request failed (' + response.status + ')'));
    return data;
  }

  document.getElementById('loginBtn').addEventListener('click', async function() {
    const candidate = document.getElementById('tokenInput').value.trim();
    if (!candidate) return;
    try {
      const response = await fetch('/api/admin/2fa/request', { method:'POST', headers:{ 'x-admin-token':candidate } });
      if (!response.ok) throw new Error('Invalid token');
      const data = await response.json();
      token = candidate;
      pending2faNonce = data.nonce || '';
      document.getElementById('loginErr').className = 'status';
      document.getElementById('codeStep').classList.remove('hidden');
      document.getElementById('codeHelp').textContent = 'We sent a 6-digit code to ' + (data.email || 'the configured admin email') + '.';
      document.getElementById('codeInput').focus();
    } catch (error) { showStatus('loginErr', error.message, true); }
  });
  document.getElementById('codeBtn').addEventListener('click', async function() {
    const code = document.getElementById('codeInput').value.trim();
    if (!token || !pending2faNonce || !code) return;
    try {
      const response = await fetch('/api/admin/2fa/verify', {
        method:'POST', headers:{ 'content-type':'application/json', 'x-admin-token':token },
        body:JSON.stringify({ nonce:pending2faNonce, code:code })
      });
      if (!response.ok) throw new Error('Invalid code');
      const data = await response.json();
      adminSession = data.sessionToken || '';
      pending2faNonce = '';
      showApp();
    } catch (error) { showStatus('codeErr', error.message, true); }
  });
  document.getElementById('tokenInput').addEventListener('keydown', function(event) { if (event.key === 'Enter') document.getElementById('loginBtn').click(); });
  document.getElementById('codeInput').addEventListener('keydown', function(event) { if (event.key === 'Enter') document.getElementById('codeBtn').click(); });
  document.getElementById('logoutBtn').addEventListener('click', function() { token=''; adminSession=''; pending2faNonce=''; syncing=false; showLogin(); });

  function renderSync(sync) {
    latestSyncState = sync || {};
    const scanned = Number(sync && sync.scanned_holders || 0);
    const holderTotal = Number(sync && sync.total_holders || 0);
    const percentage = holderTotal ? Math.min(100, scanned / holderTotal * 100) : 0;
    document.getElementById('syncBar').style.width = percentage.toFixed(1) + '%';
    const parts = [scanned.toLocaleString() + ' / ' + holderTotal.toLocaleString() + ' holders scanned'];
    if (sync && sync.completed_at) parts.push('completed ' + formatTime(sync.completed_at));
    if (Number(sync && sync.truncated_groups || 0)) parts.push(Number(sync.truncated_groups).toLocaleString() + ' truncated groups');
    document.getElementById('syncText').textContent = parts.join(' · ');
    document.getElementById('syncBtn').textContent = scanned > 0 && !(sync && sync.completed_at) ? 'Resume holder activity refresh' : 'Refresh all holder activity';
  }
  function renderRows() {
    const body = document.getElementById('rowsBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No matching active holders. Run a refresh if activity has not been scanned recently.</td></tr>';
    } else {
      body.innerHTML = rows.map(function(row, index) {
        const castUrl = 'https://farcaster.xyz/' + encodeURIComponent(row.username) + '/' + encodeURIComponent(row.castHash);
        const xUrl = row.xUsername ? 'https://x.com/' + encodeURIComponent(String(row.xUsername).replace(/^@/, '')) : '';
        const avatar = row.pfpUrl ? '<img class="avatar" src="' + esc(row.pfpUrl) + '" alt="">' : '<span class="avatar"></span>';
        return '<tr>' +
          '<td><strong>' + esc(formatTime(row.castAt)) + '</strong><div class="cast-meta">' + (row.isReply ? 'Reply' : 'Cast') + '</div></td>' +
          '<td><div class="identity">' + avatar + '<div><div class="username">@' + esc(row.username) + '</div><div>' + esc(row.displayName || '') + '</div><div class="cast-meta">FID ' + esc(row.fid) + '</div></div></div></td>' +
          '<td><div class="cast">' + esc(row.castText) + '</div><div class="cast-meta"><a href="' + esc(castUrl) + '" target="_blank" rel="noreferrer">View cast</a></div></td>' +
          '<td><a href="https://warplet.10x.meme/?search=' + esc(row.tokenId) + '&amp;warplet=' + esc(row.tokenId) + '" target="_blank" rel="noreferrer">#' + esc(row.tokenId) + '</a><div class="counts">' + esc(row.ownedCount) + ' owned</div></td>' +
          '<td><span class="pill ' + (row.converted ? 'yes' : 'no') + '">' + (row.converted ? 'Yes' : 'No') + '</span>' + (row.optedOut ? ' <span class="pill no">Opted out</span>' : '') + '<div class="counts">' + esc(formatTime(row.convertedAt)) + '</div></td>' +
          '<td><strong>' + esc(row.outreachCount) + '</strong><div class="counts">FC ' + esc(row.farcasterOutreachCount) + ' · X ' + esc(row.xOutreachCount) + '<br>' + esc(formatTime(row.lastOutreachAt)) + '</div></td>' +
          '<td><div class="actions">' + (row.optedOut ? '<span class="muted">Outreach disabled</span>' : '<button data-action="reply" data-index="' + index + '">Reply on Farcaster</button>' +
          (xUrl ? '<button class="secondary" data-action="copy-x" data-index="' + index + '">Copy X reply</button>' : '')) + (xUrl ? '<a class="button secondary" href="' + esc(xUrl) + '" target="_blank" rel="noreferrer">Open X</a>' : '<span class="muted">No verified X</span>') + '</div></td>' +
        '</tr>';
      }).join('');
    }
    const start = total ? offset + 1 : 0;
    const end = Math.min(total, offset + rows.length);
    document.getElementById('pageText').textContent = start.toLocaleString() + '–' + end.toLocaleString() + ' of ' + total.toLocaleString();
    document.getElementById('prevBtn').disabled = offset === 0;
    document.getElementById('nextBtn').disabled = offset + limit >= total;
  }
  async function loadRows() {
    clearStatus('tableStatus');
    const params = new URLSearchParams({
      q:document.getElementById('searchInput').value.trim(),
      converted:document.getElementById('convertedFilter').value,
      contacted:document.getElementById('contactedFilter').value,
      eligibility:document.getElementById('eligibilityFilter').value,
      limit:String(limit), offset:String(offset)
    });
    try {
      const data = await api('/api/admin/holder-outreach?' + params.toString());
      rows = data.rows || [];
      total = Number(data.total || 0);
      document.getElementById('activeCount').textContent = Number(data.summary.activeHolders || 0).toLocaleString();
      document.getElementById('convertedCount').textContent = Number(data.summary.convertedHolders || 0).toLocaleString();
      document.getElementById('contactedCount').textContent = Number(data.summary.contactedHolders || 0).toLocaleString();
      document.getElementById('actionCount').textContent = Number(data.summary.outreachActions || 0).toLocaleString();
      document.getElementById('filteredCount').textContent = total.toLocaleString();
      renderSync(data.sync || {});
      const select = document.getElementById('templateSelect');
      if (!select.options.length) (data.templates || []).forEach(function(template) {
        const option = document.createElement('option'); option.value = template.id; option.textContent = template.label; select.appendChild(option);
      });
      renderRows();
    } catch (error) { showStatus('tableStatus', error.message, true); }
  }
  async function runSync(resetCycle) {
    if (syncing) return;
    syncing = true;
    clearStatus('syncStatus');
    document.getElementById('syncBtn').disabled = true;
    document.getElementById('stopSyncBtn').classList.remove('hidden');
    let reset = Boolean(resetCycle);
    try {
      while (syncing) {
        const data = await api('/api/admin/holder-outreach-sync' + (reset ? '?reset=1' : ''), { method:'POST' });
        reset = false;
        renderSync(data.state || {});
        if (data.done) {
          showStatus('syncStatus', 'Holder activity refresh completed.' + (Number(data.state && data.state.truncated_groups || 0) ? ' Some very active groups were truncated and retained for safety.' : ''), false);
          break;
        }
      }
      await loadRows();
    } catch (error) { showStatus('syncStatus', error.message, true); }
    finally {
      syncing = false;
      document.getElementById('syncBtn').disabled = false;
      document.getElementById('stopSyncBtn').classList.add('hidden');
    }
  }
  async function outreachAction(row, channel) {
    clearStatus('tableStatus');
    const popup = channel === 'farcaster' ? window.open('about:blank', '_blank') : null;
    try {
      const data = await api('/api/admin/holder-outreach-action', {
        method:'POST', headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ fid:row.fid, castHash:row.castHash, channel:channel, templateId:document.getElementById('templateSelect').value })
      });
      if (channel === 'farcaster') {
        if (popup) popup.location.replace(data.composeUrl); else window.open(data.composeUrl, '_blank');
        showStatus('tableStatus', 'Opened a pre-filled Farcaster reply for @' + row.username + '.', false);
      } else {
        await copyText(data.message);
        showStatus('tableStatus', 'Copied the tracked X reply for @' + (row.xUsername || row.username) + '.', false);
      }
      await loadRows();
    } catch (error) {
      if (popup) popup.close();
      showStatus('tableStatus', error.message, true);
    }
  }

  document.getElementById('syncBtn').addEventListener('click', function() {
    const scanned = Number(latestSyncState && latestSyncState.scanned_holders || 0);
    const completed = Boolean(latestSyncState && latestSyncState.completed_at);
    runSync(scanned === 0 || completed);
  });
  document.getElementById('stopSyncBtn').addEventListener('click', function() { syncing = false; showStatus('syncStatus', 'Stopping after the current batch. Progress is saved.', false); });
  document.getElementById('filterBtn').addEventListener('click', function() { offset=0; loadRows(); });
  document.getElementById('searchInput').addEventListener('keydown', function(event) { if (event.key === 'Enter') { offset=0; loadRows(); } });
  document.getElementById('prevBtn').addEventListener('click', function() { offset=Math.max(0,offset-limit); loadRows(); });
  document.getElementById('nextBtn').addEventListener('click', function() { if (offset+limit<total) { offset+=limit; loadRows(); } });
  document.getElementById('rowsBody').addEventListener('click', function(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = rows[Number(button.dataset.index)];
    if (!row) return;
    outreachAction(row, button.dataset.action === 'reply' ? 'farcaster' : 'x');
  });
  showLogin();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  });
};
