/**
 * GET /__admin/
 *
 * Self-contained admin UI. Serves a standalone HTML page protected by the
 * admin token (entered in-browser, kept in-memory only — never in a URL).
 *
 * Features:
 *  - Send broadcast or targeted (up to 100 FIDs) notification
 *  - Live analytics table (per notification_id: dispatched / delivered / opens)
 *  - Active token count
 *
 * Security: all data operations go through existing admin-token-gated API endpoints.
 * This page itself contains no sensitive data — it is useless without the token.
 */

export const onRequestGet: PagesFunction = () => {
  const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>10X Admin — Notifications</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e5e5e5; min-height: 100vh; padding: 2rem; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 1.5rem; color: #fff; }
    h2 { font-size: 1rem; font-weight: 600; margin-bottom: .75rem; color: #aaa; text-transform: uppercase; letter-spacing: .05em; }
    section { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: .8rem; color: #999; margin-bottom: .25rem; margin-top: .75rem; }
    label:first-of-type { margin-top: 0; }
    input, textarea, select { width: 100%; background: #111; border: 1px solid #333; border-radius: 6px; color: #e5e5e5; padding: .5rem .75rem; font-size: .9rem; outline: none; }
    input:focus, textarea:focus, select:focus { border-color: #7c3aed; }
    textarea { resize: vertical; min-height: 4rem; }
    button { background: #7c3aed; color: #fff; border: none; border-radius: 6px; padding: .5rem 1.25rem; font-size: .9rem; cursor: pointer; margin-top: .75rem; }
    button:hover { background: #6d28d9; }
    button:disabled { background: #3a3a3a; cursor: not-allowed; }
    button.secondary { background: #2a2a2a; border: 1px solid #444; }
    button.secondary:hover { background: #333; }
    .row { display: flex; gap: .75rem; align-items: flex-end; }
    .row button { margin-top: 0; white-space: nowrap; }
    #status { font-size: .85rem; margin-top: .75rem; padding: .5rem .75rem; border-radius: 6px; display: none; }
    #status.ok  { background: #14532d44; border: 1px solid #16a34a55; color: #4ade80; }
    #status.err { background: #7f1d1d44; border: 1px solid #dc262655; color: #f87171; }
    table { width: 100%; border-collapse: collapse; font-size: .82rem; }
    th { text-align: left; padding: .4rem .6rem; color: #777; font-weight: 500; border-bottom: 1px solid #2a2a2a; }
    td { padding: .4rem .6rem; border-bottom: 1px solid #1f1f1f; color: #ccc; }
    td.mono { font-family: monospace; font-size: .78rem; }
    .pill { display: inline-block; padding: .1rem .45rem; border-radius: 999px; font-size: .75rem; font-weight: 600; }
    .pill.delivered { background: #14532d44; color: #4ade80; }
    .pill.rate_limited { background: #78350f44; color: #fbbf24; }
    .pill.failed  { background: #7f1d1d44; color: #f87171; }
    .pill.invalid { background: #4c1d9544; color: #c084fc; }
    .pill.pending { background: #1e3a5f44; color: #60a5fa; }
    #login { max-width: 400px; margin: 4rem auto; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .75rem; margin-bottom: 1.25rem; }
    .stat-box { background: #111; border: 1px solid #2a2a2a; border-radius: 6px; padding: .75rem; text-align: center; }
    .stat-box .num { font-size: 1.6rem; font-weight: 700; color: #fff; }
    .stat-box .lbl { font-size: .72rem; color: #777; margin-top: .2rem; }
    .hidden { display: none !important; }
    #app { display: none; }
  </style>
</head>
<body>

<!-- LOGIN -->
<div id="login">
  <h1>10X Admin</h1>
  <section>
    <h2>Enter admin token</h2>
    <label>Admin token</label>
    <input id="tokenInput" type="password" placeholder="notify-test-…" autocomplete="off" />
    <button id="loginBtn">Sign in</button>
    <div id="loginErr" style="color:#f87171;font-size:.8rem;margin-top:.5rem;display:none">Invalid token</div>
  </section>
</div>

<!-- MAIN APP -->
<div id="app">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
    <h1>10X Admin — Notifications</h1>
    <button class="secondary" id="logoutBtn" style="margin-top:0">Sign out</button>
  </div>

  <!-- STATS SUMMARY -->
  <section>
    <h2>Overview <button class="secondary" id="refreshBtn" style="padding:.25rem .75rem;font-size:.75rem;margin-top:0;margin-left:.5rem">Refresh</button></h2>
    <div class="stat-grid">
      <div class="stat-box"><div class="num" id="statTokens">—</div><div class="lbl">Active tokens</div></div>
      <div class="stat-box"><div class="num" id="statDispatches">—</div><div class="lbl">Total sends</div></div>
      <div class="stat-box"><div class="num" id="statDelivered">—</div><div class="lbl">Delivered</div></div>
      <div class="stat-box"><div class="num" id="statOpens">—</div><div class="lbl">Opens</div></div>
      <div class="stat-box"><div class="num" id="statAvgOpen">—</div><div class="lbl">Avg Open %</div></div>
    </div>
    <table id="statsTable">
      <thead><tr>
        <th>Notification ID</th><th>Title</th><th>Sent</th><th>Delivered</th><th>Opens</th><th>Open %</th><th>Last sent</th>
      </tr></thead>
      <tbody id="statsBody"><tr><td colspan="7" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
    </table>
  </section>

  <!-- SECURITY -->
  <section>
    <h2>Security</h2>
    <div class="stat-grid">
      <div class="stat-box"><div class="num" id="sec24h">â€”</div><div class="lbl">Security events 24h</div></div>
      <div class="stat-box"><div class="num" id="sec7d">â€”</div><div class="lbl">Security events 7d</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Event</th><th>Count (24h)</th>
      </tr></thead>
      <tbody id="secEventsBody"><tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">Loadingâ€¦</td></tr></tbody>
    </table>
    <table style="margin-top:.75rem">
      <thead><tr>
        <th>Route</th><th>Count (24h)</th>
      </tr></thead>
      <tbody id="secRoutesBody"><tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">Loadingâ€¦</td></tr></tbody>
    </table>
    <table style="margin-top:.75rem">
      <thead><tr>
        <th>IP</th><th>Count (24h)</th>
      </tr></thead>
      <tbody id="secIpsBody"><tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">Loadingâ€¦</td></tr></tbody>
    </table>
    <table style="margin-top:.75rem">
      <thead><tr>
        <th>Alert</th><th>Status</th><th>Value</th>
      </tr></thead>
      <tbody id="secAlertsBody"><tr><td colspan="3" style="color:#555;text-align:center;padding:1rem">Loadingâ€¦</td></tr></tbody>
    </table>
  </section>

  <!-- OUTREACH -->
  <section>
    <h2>Outreach</h2>
    <div class="stat-grid">
      <div class="stat-box"><div class="num" id="outMsg24h">-</div><div class="lbl">Messages 24h</div></div>
      <div class="stat-box"><div class="num" id="outMsg7d">-</div><div class="lbl">Messages 7d</div></div>
      <div class="stat-box"><div class="num" id="outMsgTotal">-</div><div class="lbl">Messages total</div></div>
      <div class="stat-box"><div class="num" id="outRecip24h">-</div><div class="lbl">Mentions 24h</div></div>
      <div class="stat-box"><div class="num" id="outRecip7d">-</div><div class="lbl">Mentions 7d</div></div>
      <div class="stat-box"><div class="num" id="outRecipTotal">-</div><div class="lbl">Mentions total</div></div>
      <div class="stat-box"><div class="num" id="outOpt24h">-</div><div class="lbl">Opt-outs 24h</div></div>
      <div class="stat-box"><div class="num" id="outOpt7d">-</div><div class="lbl">Opt-outs 7d</div></div>
      <div class="stat-box"><div class="num" id="outOptTotal">-</div><div class="lbl">Opt-outs total</div></div>
      <div class="stat-box"><div class="num" id="outOptActive">-</div><div class="lbl">Active opt-outs</div></div>
      <div class="stat-box"><div class="num" id="outAvgWarplet">-</div><div class="lbl">Avg mentions / Warplet</div></div>
      <div class="stat-box"><div class="num" id="outNeverMentioned">-</div><div class="lbl">Never mentioned</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Created</th><th>Sender FID</th><th>Channel</th><th>Recipients</th><th>Verification</th>
      </tr></thead>
      <tbody id="outRecentBody"><tr><td colspan="5" style="color:#555;text-align:center;padding:1rem">Loading...</td></tr></tbody>
    </table>
    <table style="margin-top:.75rem">
      <thead><tr>
        <th>Token</th><th>FID</th><th>Farcaster</th><th>X</th><th>Outreach count</th>
      </tr></thead>
      <tbody id="outTopBody"><tr><td colspan="5" style="color:#555;text-align:center;padding:1rem">Loading...</td></tr></tbody>
    </table>
  </section>

  <!-- SEND NOTIFICATION -->
  <section>
    <h2>Send notification</h2>
    <label>App <span style="color:#555;font-size:.75rem">(notification audience)</span></label>
    <select id="sendApp">
      <option value="all">All</option>
      <option value="app">10X</option>
      <option value="drop">Drop</option>
    </select>

    <label>Title <span style="color:#555;font-size:.75rem">(max 32 chars)</span></label>
    <input id="sendTitle" maxlength="32" placeholder="10X Update" />

    <label>Body <span style="color:#555;font-size:.75rem">(max 128 chars)</span></label>
    <textarea id="sendBody" maxlength="128" placeholder="Something exciting is happening…"></textarea>

    <label>Target URL <span id="sendTargetHint" style="color:#555;font-size:.75rem">(optional — defaults to https://app.10x.meme)</span></label>
    <input id="sendTarget" type="url" placeholder="https://app.10x.meme" />

    <label>Notification ID <span style="color:#555;font-size:.75rem">(optional — leave blank to auto-generate)</span></label>
    <input id="sendId" placeholder="my-campaign-001" />

    <label>Target FIDs <span style="color:#555;font-size:.75rem">(optional — comma-separated, max 100; leave blank for all)</span></label>
    <input id="sendFids" placeholder="1129138, 9152, …" />

    <div style="margin-top:.75rem">
      <button id="sendBtn">Send notification</button>
      <span id="sendCount" style="font-size:.8rem;color:#666;margin-left:.75rem"></span>
    </div>
    <div id="status"></div>
  </section>

  <!-- RECENT DISPATCHES -->
  <section>
    <h2>Recent dispatch attempts</h2>
    <table>
      <thead><tr>
        <th>FID</th><th>Notification ID</th><th>Title</th><th>Status</th><th>Attempts</th><th>Created</th>
      </tr></thead>
      <tbody id="dispatchBody"><tr><td colspan="6" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
    </table>
  </section>

  <!-- EMAIL WAITLIST -->
  <section>
    <h2>Email Waitlist <button class="secondary" id="emailRefreshBtn" style="padding:.25rem .75rem;font-size:.75rem;margin-top:0;margin-left:.5rem">Refresh</button></h2>
    <div class="stat-grid" id="emailStatGrid">
      <div class="stat-box"><div class="num" id="emailStatTotal">—</div><div class="lbl">Total</div></div>
      <div class="stat-box"><div class="num" id="emailStatVerified">—</div><div class="lbl">Verified</div></div>
      <div class="stat-box"><div class="num" id="emailStatUnverified">—</div><div class="lbl">Pending verify</div></div>
      <div class="stat-box"><div class="num" id="emailStatMatched">—</div><div class="lbl">Warplet matched</div></div>
      <div class="stat-box"><div class="num" id="emailStatUnsub">—</div><div class="lbl">Unsubscribed</div></div>
    </div>
    <div style="display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap">
      <select id="emailFilter" style="background:#111;border:1px solid #333;border-radius:6px;color:#e5e5e5;padding:.4rem .75rem;font-size:.85rem">
        <option value="all">All</option>
        <option value="verified">Verified</option>
        <option value="unverified">Pending verify</option>
        <option value="unsubscribed">Unsubscribed</option>
      </select>
      <button class="secondary" id="emailExportBtn" style="margin-top:0;padding:.4rem .9rem;font-size:.85rem">Export CSV</button>
    </div>
    <table>
      <thead><tr>
        <th>Email</th><th>FID</th><th>Username</th><th>Token ID</th><th>Matched</th><th>Verified</th><th>Subscribed</th>
      </tr></thead>
      <tbody id="emailBody"><tr><td colspan="7" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
    </table>
  </section>
</div>

<script>
  const SEND_APP_DEFAULTS = {
    all: 'https://app.10x.meme/',
    app: 'https://app.10x.meme/',
    drop: 'https://drop.10x.meme/',
  };
  let token = '';

  function getDefaultTargetUrlForAppSlug(appSlug) {
    return SEND_APP_DEFAULTS[appSlug] || SEND_APP_DEFAULTS.app;
  }

  function updateSendTargetUiFromApp() {
    const appSlug = document.getElementById('sendApp').value;
    const defaultUrl = getDefaultTargetUrlForAppSlug(appSlug);
    document.getElementById('sendTargetHint').textContent = '(optional — defaults to ' + defaultUrl + ')';
    document.getElementById('sendTarget').placeholder = defaultUrl;
  }

  // --- AUTH ---
  function showApp() {
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadAll();
  }
  function showLogin() {
    document.getElementById('login').style.display = 'block';
    document.getElementById('app').style.display = 'none';
  }

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const t = document.getElementById('tokenInput').value.trim();
    if (!t) return;
    // Probe inspect endpoint to verify token
    const r = await fetch('/api/notifications/inspect', { headers: { 'x-admin-token': t } });
    if (r.ok) {
      token = t;
      document.getElementById('loginErr').style.display = 'none';
      showApp();
    } else {
      document.getElementById('loginErr').style.display = 'block';
    }
  });
  document.getElementById('tokenInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    token = '';
    showLogin();
  });

  if (token) showApp(); else showLogin();

  // --- DATA LOADING ---
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'x-admin-token': token, ...(opts.headers || {}) },
    });
    if (res.status === 401) { showLogin(); throw new Error('Unauthorized'); }
    return res;
  }

  async function loadStats() {
    try {
      const r = await api('/api/notifications/stats');
      const data = await r.json();
      const rows = data.rows || [];

      // Aggregate summary
      const totDispatches = rows.reduce((s, r) => s + r.dispatches, 0);
      const totDelivered  = rows.reduce((s, r) => s + r.delivered, 0);
      const totOpens      = rows.reduce((s, r) => s + r.opens, 0);
      const openRateRows  = rows.filter(r => r.openRate != null);
      const avgOpenRate   = openRateRows.length
        ? openRateRows.reduce((s, r) => s + r.openRate, 0) / openRateRows.length
        : null;

      document.getElementById('statDispatches').textContent = totDispatches;
      document.getElementById('statDelivered').textContent  = totDelivered;
      document.getElementById('statOpens').textContent      = totOpens;
      document.getElementById('statAvgOpen').textContent    =
        avgOpenRate != null ? (avgOpenRate * 100).toFixed(1) + '%' : '—';

      const tbody = document.getElementById('statsBody');
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:#555;text-align:center;padding:1rem">No data yet</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(r => \`
        <tr>
          <td class="mono">\${r.notificationId}</td>
          <td>\${esc(r.title)}</td>
          <td>\${r.dispatches}</td>
          <td>\${r.delivered}</td>
          <td>\${r.opens}</td>
          <td>\${r.openRate != null ? (r.openRate * 100).toFixed(1) + '%' : '—'}</td>
          <td style="color:#666;font-size:.75rem">\${r.lastSent?.replace('T',' ').slice(0,16) || r.lastSent}</td>
        </tr>\`).join('');
    } catch (e) { if (e.message !== 'Unauthorized') console.error(e); }
  }

  async function loadInspect() {
    try {
      const r = await api('/api/notifications/inspect');
      const data = await r.json();

      document.getElementById('statTokens').textContent = data.tokens?.enabled ?? '—';

      const tbody = document.getElementById('dispatchBody');
      const rows = data.dispatches?.rows || [];
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#555;text-align:center;padding:1rem">No dispatches yet</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(d => \`
        <tr>
          <td>\${d.fid}</td>
          <td class="mono">\${d.notification_id}</td>
          <td>\${esc(d.title)}</td>
          <td><span class="pill \${d.status}">\${d.status}</span></td>
          <td>\${d.attempt_count}</td>
          <td style="color:#666;font-size:.75rem">\${d.created_at}</td>
        </tr>\`).join('');
    } catch (e) { if (e.message !== 'Unauthorized') console.error(e); }
  }

  async function loadSecurity() {
    try {
      const r = await api('/api/security/stats');
      const data = await r.json();

      document.getElementById('sec24h').textContent = String(data?.windows?.last24h ?? 'â€”');
      document.getElementById('sec7d').textContent = String(data?.windows?.last7d ?? 'â€”');

      const eventRows = Array.isArray(data?.topEvents24h) ? data.topEvents24h : [];
      const routeRows = Array.isArray(data?.topRoutes24h) ? data.topRoutes24h : [];
      const ipRows = Array.isArray(data?.topIps24h) ? data.topIps24h : [];

      const secEventsBody = document.getElementById('secEventsBody');
      secEventsBody.innerHTML = eventRows.length
        ? eventRows.map(row => \`<tr><td class="mono">\${esc(row.event_type)}</td><td>\${row.count}</td></tr>\`).join('')
        : '<tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">No data yet</td></tr>';

      const secRoutesBody = document.getElementById('secRoutesBody');
      secRoutesBody.innerHTML = routeRows.length
        ? routeRows.map(row => \`<tr><td class="mono">\${esc(row.route || 'n/a')}</td><td>\${row.count}</td></tr>\`).join('')
        : '<tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">No data yet</td></tr>';

      const secIpsBody = document.getElementById('secIpsBody');
      secIpsBody.innerHTML = ipRows.length
        ? ipRows.map(row => \`<tr><td class="mono">\${esc(row.ip_address || 'n/a')}</td><td>\${row.count}</td></tr>\`).join('')
        : '<tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">No data yet</td></tr>';

      const alertRes = await api('/api/security/alerts');
      const alertData = await alertRes.json();
      const alerts = Array.isArray(alertData?.alerts) ? alertData.alerts : [];
      const secAlertsBody = document.getElementById('secAlertsBody');
      secAlertsBody.innerHTML = alerts.length
        ? alerts.map((a) => \`
          <tr>
            <td class="mono">\${esc(a.description)}</td>
            <td>\${a.active ? '<span class="pill failed">active</span>' : '<span class="pill delivered">ok</span>'}</td>
            <td>\${a.value} / \${a.threshold}</td>
          </tr>\`).join('')
        : '<tr><td colspan="3" style="color:#555;text-align:center;padding:1rem">No alerts configured</td></tr>';
    } catch (e) { if (e.message !== 'Unauthorized') console.error(e); }
  }

  async function loadOutreach() {
    try {
      const r = await api('/api/outreach/stats');
      const data = await r.json();
      document.getElementById('outMsg24h').textContent = data?.messages?.last24h ?? '-';
      document.getElementById('outMsg7d').textContent = data?.messages?.last7d ?? '-';
      document.getElementById('outMsgTotal').textContent = data?.messages?.total ?? '-';
      document.getElementById('outRecip24h').textContent = data?.recipients?.last24h ?? '-';
      document.getElementById('outRecip7d').textContent = data?.recipients?.last7d ?? '-';
      document.getElementById('outRecipTotal').textContent = data?.recipients?.total ?? '-';
      document.getElementById('outOpt24h').textContent = data?.optOuts?.last24h ?? '-';
      document.getElementById('outOpt7d').textContent = data?.optOuts?.last7d ?? '-';
      document.getElementById('outOptTotal').textContent = data?.optOuts?.total ?? '-';
      document.getElementById('outOptActive').textContent = data?.optOuts?.current ?? '-';
      document.getElementById('outAvgWarplet').textContent =
        Number(data?.averages?.warpletOutreachCount ?? 0).toFixed(3);
      document.getElementById('outNeverMentioned').textContent =
        data?.averages?.neverMentionedWarplets ?? '-';

      const recent = Array.isArray(data?.recent) ? data.recent : [];
      document.getElementById('outRecentBody').innerHTML = recent.length
        ? recent.map(row => \`
          <tr>
            <td style="color:#666;font-size:.75rem">\${esc(row.created_on || '').replace('T',' ').slice(0,16)}</td>
            <td>\${row.sender_fid}</td>
            <td><span class="pill pending">\${esc(row.channel)}</span></td>
            <td>\${esc(row.recipients || '')}</td>
            <td class="mono">\${esc(row.verification || '')}</td>
          </tr>\`).join('')
        : '<tr><td colspan="5" style="color:#555;text-align:center;padding:1rem">No outreach tracked yet</td></tr>';

      const topRows = Array.isArray(data?.topOutreached) ? data.topOutreached : [];
      document.getElementById('outTopBody').innerHTML = topRows.length
        ? topRows.map(row => \`
          <tr>
            <td>\${row.token_id}</td>
            <td>\${row.fid_value ?? '-'}</td>
            <td>\${esc(row.warplet_username_farcaster || '-')}</td>
            <td>\${esc(row.warplet_username_x || '-')}</td>
            <td>\${row.outreach_count ?? 0}</td>
          </tr>\`).join('')
        : '<tr><td colspan="5" style="color:#555;text-align:center;padding:1rem">No Warplets found</td></tr>';
    } catch (e) { if (e.message !== 'Unauthorized') console.error(e); }
  }

  function loadAll() { loadStats(); loadInspect(); loadSecurity(); loadOutreach(); loadEmail(); }

  document.getElementById('refreshBtn').addEventListener('click', loadAll);
  document.getElementById('sendApp').addEventListener('change', updateSendTargetUiFromApp);
  updateSendTargetUiFromApp();

  // --- SEND ---
  document.getElementById('sendBtn').addEventListener('click', async () => {
    const appSlug = document.getElementById('sendApp').value;
    const title = document.getElementById('sendTitle').value.trim();
    const body  = document.getElementById('sendBody').value.trim();
    if (!title || !body) { showStatus('Title and body are required', false); return; }

    const defaultTarget = getDefaultTargetUrlForAppSlug(appSlug);
    const target     = document.getElementById('sendTarget').value.trim() || defaultTarget;
    const notifId    = document.getElementById('sendId').value.trim() || undefined;
    const fidsRaw    = document.getElementById('sendFids').value.trim();
    const fids       = fidsRaw
      ? fidsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      : undefined;

    if (fids && fids.length > 100) { showStatus('Max 100 FIDs per send', false); return; }
    if (target && !target.startsWith('https://')) { showStatus('targetUrl must be https', false); return; }

    const payload = { title, body, appSlug, targetUrl: target, ...(notifId && { notificationId: notifId }), ...(fids && { fids }) };

    const btn = document.getElementById('sendBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const r = await api('/api/notifications/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (r.ok) {
        const summary = Object.entries(data.summary || {}).map(([k,v]) => \`\${v} \${k}\`).join(', ');
        showStatus(\`Sent to \${data.total} token(s): \${summary || 'ok'}\`, true);
        setTimeout(loadAll, 1500);
      } else {
        showStatus(data.error || 'Unknown error', false);
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') showStatus(String(e), false);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send notification';
    }
  });

  function showStatus(msg, ok) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = ok ? 'ok' : 'err';
    el.style.display = 'block';
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // --- EMAIL WAITLIST ---
  let emailCache = [];

  async function loadEmail() {
    try {
      const filter = document.getElementById('emailFilter').value;
      const r = await api('/api/email/list?limit=200&filter=' + filter);
      const data = await r.json();
      emailCache = data.rows || [];

      const s = data.stats || {};
      document.getElementById('emailStatTotal').textContent     = s.total ?? '—';
      document.getElementById('emailStatVerified').textContent  = s.verified ?? '—';
      document.getElementById('emailStatUnverified').textContent = s.unverified ?? '—';
      document.getElementById('emailStatMatched').textContent   = s.matched ?? '—';
      document.getElementById('emailStatUnsub').textContent     = s.unsubscribed ?? '—';

      const tbody = document.getElementById('emailBody');
      if (!emailCache.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:#555;text-align:center;padding:1rem">No subscribers yet</td></tr>';
        return;
      }
      tbody.innerHTML = emailCache.map(row => \`
        <tr>
          <td class="mono" style="font-size:.78rem">\${esc(row.email)}</td>
          <td>\${row.fid ?? '—'}</td>
          <td>\${esc(row.username || '—')}</td>
          <td>\${row.token_id ?? '—'}</td>
          <td>\${row.matched ? '<span class="pill delivered">yes</span>' : '<span style="color:#555">no</span>'}</td>
          <td>\${row.verified ? '<span class="pill delivered">yes</span>' : '<span class="pill pending">pending</span>'}</td>
          <td style="color:#666;font-size:.75rem">\${(row.subscribed_at || '').replace('T',' ').slice(0,16)}</td>
        </tr>\`).join('');
    } catch (e) { if (e.message !== 'Unauthorized') console.error(e); }
  }

  document.getElementById('emailRefreshBtn').addEventListener('click', loadEmail);
  document.getElementById('emailFilter').addEventListener('change', loadEmail);

  document.getElementById('emailExportBtn').addEventListener('click', () => {
    if (!emailCache.length) return;
    const header = 'email,fid,username,token_id,matched,verified,subscribed_at,verified_at,unsubscribed_at';
    const rows = emailCache.map(r =>
      [r.email, r.fid ?? '', r.username ?? '', r.token_id ?? '', r.matched ? 1 : 0,
       r.verified ? 1 : 0, r.subscribed_at ?? '', r.verified_at ?? '', r.unsubscribed_at ?? '']
      .map(v => JSON.stringify(String(v ?? ''))).join(',')
    );
    const csv = [header, ...rows].join('\\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'email-waitlist-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  });
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      // Prevent the page from being framed or indexed
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  });
};
