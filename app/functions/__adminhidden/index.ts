/**
 * GET /__adminhidden/
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
    button.danger { background: #7f1d1d; border: 1px solid #dc2626; }
    button.danger:hover { background: #991b1b; }
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
    <div id="codeStep" style="display:none;margin-top:1rem">
      <label>Email code</label>
      <input id="codeInput" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code" />
      <button id="codeBtn">Verify code</button>
      <div id="codeHelp" style="color:#999;font-size:.8rem;margin-top:.5rem"></div>
      <div id="codeErr" style="color:#f87171;font-size:.8rem;margin-top:.5rem;display:none">Invalid code</div>
    </div>
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
      <div class="stat-box"><div class="num" id="sec24h">—</div><div class="lbl">Security events 24h</div></div>
      <div class="stat-box"><div class="num" id="sec7d">—</div><div class="lbl">Security events 7d</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Event</th><th>Count (24h)</th>
      </tr></thead>
      <tbody id="secEventsBody"><tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
    </table>
    <table style="margin-top:.75rem">
      <thead><tr>
        <th>Route</th><th>Count (24h)</th>
      </tr></thead>
      <tbody id="secRoutesBody"><tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
    </table>
    <table style="margin-top:.75rem">
      <thead><tr>
        <th>IP</th><th>Count (24h)</th>
      </tr></thead>
      <tbody id="secIpsBody"><tr><td colspan="2" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
    </table>
    <table style="margin-top:.75rem">
      <thead><tr>
        <th>Alert</th><th>Status</th><th>Value</th>
      </tr></thead>
      <tbody id="secAlertsBody"><tr><td colspan="3" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
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
      <option value="warplets">10X Warplets</option>
    </select>

    <label>Title <span style="color:#555;font-size:.75rem">(max 32 chars)</span></label>
    <input id="sendTitle" maxlength="32" placeholder="10X Update" />

    <label>Body <span style="color:#555;font-size:.75rem">(max 128 chars)</span></label>
    <textarea id="sendBody" maxlength="128" placeholder="Something exciting is happening…"></textarea>

    <label>Target URL <span id="sendTargetHint" style="color:#555;font-size:.75rem">(optional — defaults to https://app.10x.meme)</span></label>
    <input id="sendTarget" type="url" placeholder="https://app.10x.meme" />

    <label>Notification ID <span style="color:#555;font-size:.75rem">(optional — leave blank to auto-generate)</span></label>
    <input id="sendId" placeholder="my-campaign-001" />

    <label>Send mode</label>
    <select id="sendMode">
      <option value="batch">One batch at a time (max 100 unsent)</option>
      <option value="all">All unsent now</option>
      <option value="fids">FID list only</option>
    </select>

    <label>Channels</label>
    <select id="sendChannels">
      <option value="farcaster">Farcaster</option>
      <option value="web-push">Web Push</option>
      <option value="base">Base</option>
      <option value="farcaster-web">Farcaster + Web Push</option>
      <option value="farcaster-base">Farcaster + Base</option>
      <option value="all">All channels</option>
    </select>

    <label>Target FIDs <span style="color:#555;font-size:.75rem">(comma-separated; used by FID list mode)</span></label>
    <input id="sendFids" placeholder="1129138, 9152, …" />

    <div class="stat-grid" style="margin-top:.75rem;margin-bottom:.5rem">
      <div class="stat-box"><div class="num" id="sendAudience">-</div><div class="lbl">Channel recipients</div></div>
      <div class="stat-box"><div class="num" id="sendAlready">-</div><div class="lbl">Already dispatched</div></div>
      <div class="stat-box"><div class="num" id="sendUnsent">-</div><div class="lbl">Unsent</div></div>
      <div class="stat-box"><div class="num" id="sendDelivered">-</div><div class="lbl">Delivered</div></div>
      <div class="stat-box"><div class="num" id="sendPending">-</div><div class="lbl">Ambiguous pending</div></div>
      <div class="stat-box"><div class="num" id="sendProblem">-</div><div class="lbl">Failed / invalid / limited</div></div>
    </div>
    <div id="sendProgressMeta" style="font-size:.8rem;color:#666"></div>
    <button class="secondary" id="sendProgressBtn" style="padding:.35rem .85rem;font-size:.8rem">Refresh send progress</button>
    <table id="sendFidDetailsTable" style="margin-top:.75rem;display:none">
      <thead><tr>
        <th>FID</th><th>Eligible</th><th>Tokens</th><th>Dispatch</th><th>Latest attempt</th>
      </tr></thead>
      <tbody id="sendFidDetailsBody"></tbody>
    </table>

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

  <!-- DISCORD EMAIL VERIFICATIONS -->
  <section>
    <h2>Discord Email Verifications <button class="secondary" id="discordVerificationRefreshBtn" style="padding:.25rem .75rem;font-size:.75rem;margin-top:0;margin-left:.5rem">Refresh</button></h2>
    <p style="color:#888;font-size:.8rem;margin-bottom:.75rem">Resetting removes the Verified role and lets that Discord user verify again. The email contact is deleted only when it has no Farcaster, wallet, or other segment association.</p>
    <table>
      <thead><tr>
        <th>Discord</th><th>User ID</th><th>Email</th><th>Other identity</th><th>Reset result</th><th></th>
      </tr></thead>
      <tbody id="discordVerificationBody"><tr><td colspan="6" style="color:#555;text-align:center;padding:1rem">Loadingâ€¦</td></tr></tbody>
    </table>
  </section>

  <!-- RESEND ONBOARDING -->
  <section>
    <h2>Email Onboarding <button class="secondary" id="onboardingRefreshBtn" style="padding:.25rem .75rem;font-size:.75rem;margin-top:0;margin-left:.5rem">Refresh</button></h2>
    <div class="stat-grid">
      <div class="stat-box"><div class="num" id="onboardEnrolled">—</div><div class="lbl">Enrolled</div></div>
      <div class="stat-box"><div class="num" id="onboardQueued">—</div><div class="lbl">Queued</div></div>
      <div class="stat-box"><div class="num" id="onboardActive">—</div><div class="lbl">Active</div></div>
      <div class="stat-box"><div class="num" id="onboardCompleted">—</div><div class="lbl">Completed</div></div>
      <div class="stat-box"><div class="num" id="onboardInterrupted">—</div><div class="lbl">Interrupted</div></div>
      <div class="stat-box"><div class="num" id="onboardUncertain">—</div><div class="lbl">Uncertain</div></div>
      <div class="stat-box"><div class="num" id="onboardCompletionRate">—</div><div class="lbl">Completion rate</div></div>
    </div>
    <table>
      <thead><tr><th>Email</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Bounced</th><th>Suppressed</th><th>Complained</th></tr></thead>
      <tbody id="onboardingStepsBody"><tr><td colspan="8" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
    </table>
    <p id="onboardingStepDistribution" style="color:#888;font-size:.8rem;margin-top:.75rem"></p>
    <p id="onboardingReconciliation" style="color:#888;font-size:.8rem;margin-top:.35rem"></p>
    <h2 style="margin-top:1rem">Recent interruptions and reconciliation errors</h2>
    <table>
      <thead><tr><th>Email</th><th>Status</th><th>Last delivered</th><th>Error</th><th>Updated</th></tr></thead>
      <tbody id="onboardingFailuresBody"><tr><td colspan="5" style="color:#555;text-align:center;padding:1rem">Loading…</td></tr></tbody>
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
    warplets: 'https://warplet.10x.meme/',
  };
  let token = '';
  let adminSession = '';
  let pending2faNonce = '';

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
    if (!pending2faNonce) document.getElementById('codeStep').style.display = 'none';
  }
  function showCodeStep(email) {
    document.getElementById('codeStep').style.display = 'block';
    document.getElementById('codeHelp').textContent = 'We sent a 6-digit code to ' + email + '.';
    document.getElementById('codeInput').focus();
  }

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const t = document.getElementById('tokenInput').value.trim();
    if (!t) return;
    const r = await fetch('/api/admin/2fa/request', {
      method: 'POST',
      headers: { 'x-admin-token': t },
    });
    if (r.ok) {
      const data = await r.json();
      token = t;
      pending2faNonce = data.nonce || '';
      document.getElementById('loginErr').style.display = 'none';
      document.getElementById('codeErr').style.display = 'none';
      showCodeStep(data.email || 'the configured admin email');
    } else {
      document.getElementById('loginErr').style.display = 'block';
    }
  });
  document.getElementById('tokenInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
  document.getElementById('codeBtn').addEventListener('click', async () => {
    const code = document.getElementById('codeInput').value.trim();
    if (!token || !pending2faNonce || !code) return;
    const r = await fetch('/api/admin/2fa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ nonce: pending2faNonce, code }),
    });
    if (r.ok) {
      const data = await r.json();
      adminSession = data.sessionToken || '';
      pending2faNonce = '';
      document.getElementById('codeErr').style.display = 'none';
      showApp();
    } else {
      document.getElementById('codeErr').style.display = 'block';
    }
  });
  document.getElementById('codeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('codeBtn').click();
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    token = '';
    adminSession = '';
    pending2faNonce = '';
    showLogin();
  });

  if (token && adminSession) showApp(); else showLogin();

  // --- DATA LOADING ---
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'x-admin-token': token, 'x-admin-session': adminSession, ...(opts.headers || {}) },
    });
    if (res.status === 401) { adminSession = ''; showLogin(); throw new Error('Unauthorized'); }
    return res;
  }

  async function readApiJson(res) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return res.json();

    const text = await res.text();
    const preview = text.replace(/\\s+/g, ' ').trim().slice(0, 240);
    throw new Error(\`Expected JSON, got HTTP \${res.status} \${contentType || 'unknown content-type'}: \${preview || 'empty response'}\`);
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

      document.getElementById('sec24h').textContent = String(data?.windows?.last24h ?? '—');
      document.getElementById('sec7d').textContent = String(data?.windows?.last7d ?? '—');

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

  async function loadEmailOnboarding() {
    try {
      const r = await api('/api/admin/email-onboarding/metrics');
      const data = await readApiJson(r);
      if (!r.ok) throw new Error(data.error || 'Unable to load email onboarding metrics');
      const summary = data.summary || {};
      document.getElementById('onboardEnrolled').textContent = summary.enrolled ?? '—';
      document.getElementById('onboardQueued').textContent = summary.queued ?? '—';
      document.getElementById('onboardActive').textContent = summary.active ?? '—';
      document.getElementById('onboardCompleted').textContent = summary.completed ?? '—';
      document.getElementById('onboardInterrupted').textContent = summary.interrupted ?? '—';
      document.getElementById('onboardUncertain').textContent = summary.uncertain ?? '—';
      document.getElementById('onboardCompletionRate').textContent = (summary.completionRate ?? 0) + '%';
      const steps = Array.isArray(data.steps) ? data.steps : [];
      document.getElementById('onboardingStepsBody').innerHTML = steps.map(step => \`<tr>
        <td>Email \${step.step}</td>
        <td>\${step.sent}</td>
        <td>\${step.delivered.count} (\${step.delivered.rate}%)</td>
        <td>\${step.opened.count} (\${step.opened.rate}%)</td>
        <td>\${step.clicked.count} (\${step.clicked.rate}%)</td>
        <td>\${step.bounced.count} (\${step.bounced.rate}%)</td>
        <td>\${step.suppressed.count} (\${step.suppressed.rate}%)</td>
        <td>\${step.complained.count} (\${step.complained.rate}%)</td>
      </tr>\`).join('');
      const currentSteps = Array.isArray(data.currentSteps) ? data.currentSteps : [];
      document.getElementById('onboardingStepDistribution').textContent = 'Current-step distribution: ' + (
        currentSteps.length
          ? currentSteps.map(row => (Number(row.current_step) >= 0 ? 'Email ' + (Number(row.current_step) + 1) : 'Not delivered') + ': ' + row.count).join(' · ')
          : 'no active runs'
      );
      const reconciliation = data.reconciliation || {};
      document.getElementById('onboardingReconciliation').textContent = reconciliation.last_error
        ? 'Reconciliation error: ' + reconciliation.last_error
        : 'Last reconciliation: ' + (reconciliation.last_checked_at || 'not run yet');
      const failures = Array.isArray(data.failures) ? data.failures : [];
      document.getElementById('onboardingFailuresBody').innerHTML = failures.length
        ? failures.map(row => \`<tr>
          <td class="mono">\${esc(row.email)}</td>
          <td><span class="pill failed">\${esc(row.status)}</span></td>
          <td>\${Number(row.current_step) >= 0 ? 'Email ' + (Number(row.current_step) + 1) : 'None'}</td>
          <td>\${esc(row.last_error || '—')}</td>
          <td style="color:#666;font-size:.75rem">\${esc(row.updated_at || '')}</td>
        </tr>\`).join('')
        : '<tr><td colspan="5" style="color:#555;text-align:center;padding:1rem">No interruptions</td></tr>';
    } catch (e) {
      if (e.message !== 'Unauthorized') console.error(e);
    }
  }

  function loadAll() { loadStats(); loadInspect(); loadSecurity(); loadOutreach(); loadEmailOnboarding(); loadDiscordVerifications(); loadEmail(); }

  document.getElementById('refreshBtn').addEventListener('click', loadAll);
  document.getElementById('onboardingRefreshBtn').addEventListener('click', loadEmailOnboarding);
  document.getElementById('sendApp').addEventListener('change', updateSendTargetUiFromApp);
  updateSendTargetUiFromApp();

  // --- SEND ---
  function parseSendFids() {
    const fidsRaw = document.getElementById('sendFids').value.trim();
    return fidsRaw
      ? Array.from(new Set(fidsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)))
      : undefined;
  }

  function renderSendProgress(notificationId, progress) {
    const p = progress || {};
    document.getElementById('sendAudience').textContent = p.audience ?? '-';
    document.getElementById('sendAlready').textContent = p.alreadyDispatched ?? '-';
    document.getElementById('sendUnsent').textContent = p.unsent ?? '-';
    document.getElementById('sendDelivered').textContent = p.delivered ?? '-';
    document.getElementById('sendPending').textContent = p.pending ?? '-';
    document.getElementById('sendProblem').textContent =
      [p.failed, p.invalid, p.rateLimited].every(v => typeof v === 'number')
        ? p.failed + p.invalid + p.rateLimited
        : '-';
    document.getElementById('sendProgressMeta').textContent = notificationId
      ? 'Campaign: ' + notificationId + (p.byChannel
        ? ' · ' + Object.entries(p.byChannel).map(([channel, values]) => channel + ': ' + values.delivered + '/' + values.audience).join(', ')
        : '')
      : '';
  }

  function renderFidDetails(rows) {
    const table = document.getElementById('sendFidDetailsTable');
    const tbody = document.getElementById('sendFidDetailsBody');
    if (!Array.isArray(rows) || !rows.length) {
      table.style.display = 'none';
      tbody.innerHTML = '';
      return;
    }

    table.style.display = 'table';
    tbody.innerHTML = rows.map(row => {
      const tokenText = Array.isArray(row.tokens) && row.tokens.length
        ? row.tokens.map(t => \`\${esc(t.appSlug)}:\${t.enabled ? 'enabled' : 'disabled'}\`).join(', ')
        : 'none';
      const attempt = row.latestAttempt
        ? \`\${esc(row.latestAttempt.result)} \${row.latestAttempt.responseStatus ?? ''} \${esc(row.latestAttempt.errorMessage || '')}\`
        : 'none';
      return \`
        <tr>
          <td>\${row.fid}</td>
          <td>\${row.eligible ? '<span class="pill delivered">yes</span>' : '<span class="pill failed">no</span>'}</td>
          <td class="mono">\${tokenText}</td>
          <td><span class="pill \${row.dispatchStatus || 'pending'}">\${esc(row.dispatchStatus || 'none')}</span></td>
          <td class="mono">\${attempt}</td>
        </tr>\`;
    }).join('');
  }

  async function refreshSendProgress() {
    const appSlug = document.getElementById('sendApp').value;
    const sendMode = document.getElementById('sendMode').value;
    const notifId = document.getElementById('sendId').value.trim();
    if (!notifId) {
      renderSendProgress('', null);
      renderFidDetails(null);
      document.getElementById('sendProgressMeta').textContent = 'Enter a notification ID to view resume progress.';
      return;
    }
    const fids = parseSendFids();
    const params = new URLSearchParams({ appSlug, notificationId: notifId });
    const channelValue = document.getElementById('sendChannels').value;
    const channels = channelValue === 'all'
      ? ['farcaster', 'base', 'web-push']
      : channelValue === 'farcaster-web'
        ? ['farcaster', 'web-push']
        : channelValue === 'farcaster-base'
          ? ['farcaster', 'base']
          : [channelValue];
    params.set('channels', channels.join(','));
    if (sendMode === 'fids' && fids?.length) params.set('fids', fids.join(','));
    const r = await api('/api/notifications/send?' + params.toString());
    const data = await readApiJson(r);
    if (!r.ok) throw new Error(data.error || 'Unable to load send progress');
    renderSendProgress(data.notificationId, data.progress);
    renderFidDetails(data.fidDetails);
  }

  document.getElementById('sendProgressBtn').addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await refreshSendProgress();
    } catch (e) {
      if (e.message !== 'Unauthorized') showStatus(String(e), false);
    }
  });

  document.getElementById('sendApp').addEventListener('change', () => refreshSendProgress().catch(() => {}));
  document.getElementById('sendMode').addEventListener('change', () => refreshSendProgress().catch(() => {}));
  document.getElementById('sendChannels').addEventListener('change', () => refreshSendProgress().catch(() => {}));
  document.getElementById('sendId').addEventListener('blur', () => refreshSendProgress().catch(() => {}));
  document.getElementById('sendFids').addEventListener('blur', () => refreshSendProgress().catch(() => {}));

  document.getElementById('sendBtn').addEventListener('click', async () => {
    const appSlug = document.getElementById('sendApp').value;
    const sendMode = document.getElementById('sendMode').value;
    const sendChannels = document.getElementById('sendChannels').value;
    const title = document.getElementById('sendTitle').value.trim();
    const body  = document.getElementById('sendBody').value.trim();
    if (!title || !body) { showStatus('Title and body are required', false); return; }

    const defaultTarget = getDefaultTargetUrlForAppSlug(appSlug);
    const target     = document.getElementById('sendTarget').value.trim() || defaultTarget;
    const notifId    = document.getElementById('sendId').value.trim() || undefined;
    const fids       = parseSendFids();

    if (sendMode === 'fids' && !fids?.length) { showStatus('FID list mode requires at least one FID', false); return; }
    if (target && !target.startsWith('https://')) { showStatus('targetUrl must be https', false); return; }

    const channels = sendChannels === 'all'
      ? ['farcaster', 'base', 'web-push']
      : sendChannels === 'farcaster-web'
        ? ['farcaster', 'web-push']
        : sendChannels === 'farcaster-base'
          ? ['farcaster', 'base']
          : [sendChannels];
    const payload = { title, body, appSlug, sendMode, channels, targetUrl: target, ...(notifId && { notificationId: notifId }), ...(sendMode === 'fids' && fids && { fids }) };

    const btn = document.getElementById('sendBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const r = await api('/api/notifications/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson(r);
      if (r.ok) {
        const summary = Object.entries(data.summary || {}).map(([k,v]) => \`\${v} \${k}\`).join(', ');
        renderSendProgress(data.notificationId, data.progress);
        renderFidDetails(data.fidDetails);
        const remaining = data.progress?.unsent ?? '?';
        showStatus(\`Processed \${data.total} unsent token(s): \${summary || 'ok'}. Remaining unsent: \${remaining}\`, true);
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

  // --- DISCORD EMAIL VERIFICATIONS ---
  let discordVerificationCache = [];

  async function loadDiscordVerifications() {
    const tbody = document.getElementById('discordVerificationBody');
    try {
      const r = await api('/api/admin/discord-verifications/list');
      const data = await readApiJson(r);
      if (!r.ok) throw new Error(data.error || 'Unable to load Discord verifications');
      discordVerificationCache = data.rows || [];
      if (!discordVerificationCache.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#555;text-align:center;padding:1rem">No Discord email associations</td></tr>';
        return;
      }
      tbody.innerHTML = discordVerificationCache.map((row, index) => {
        const identity = [
          row.farcasterFid ? 'FID ' + row.farcasterFid : '',
          row.wallet ? 'wallet' : '',
          ...(row.otherMemberships || []).map(() => 'other segment'),
        ].filter(Boolean).join(', ') || 'Discord only';
        const result = row.likelyDeletesContact
          ? '<span class="pill failed">delete email contact</span>'
          : '<span class="pill delivered">keep email contact</span>';
        const stateWarning = row.durableObjectVerified ? '' : '<div style="color:#fbbf24;font-size:.72rem">D1 only; state already absent</div>';
        return \`<tr>
          <td>\${esc(row.discordName || 'â€”')}</td>
          <td class="mono">\${esc(row.discordUserId)}</td>
          <td class="mono">\${esc(row.email)}</td>
          <td>\${esc(identity)}\${stateWarning}</td>
          <td>\${result}</td>
          <td><button class="danger discord-reset-btn" data-index="\${index}" style="margin-top:0;padding:.35rem .7rem;font-size:.78rem">Reset</button></td>
        </tr>\`;
      }).join('');
    } catch (e) {
      if (e.message !== 'Unauthorized') {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" style="color:#f87171;text-align:center;padding:1rem">Unable to load Discord verifications</td></tr>';
      }
    }
  }

  document.getElementById('discordVerificationRefreshBtn').addEventListener('click', loadDiscordVerifications);
  document.getElementById('discordVerificationBody').addEventListener('click', async event => {
    const button = event.target.closest('.discord-reset-btn');
    if (!button) return;
    const row = discordVerificationCache[Number(button.dataset.index)];
    if (!row) return;
    const action = row.likelyDeletesContact
      ? 'This is expected to DELETE the email from 10X and Resend because no other association is known.'
      : 'The email contact will be kept; only its Discord identity and Discord segment will be removed.';
    if (!confirm(\`Reset Discord verification for \${row.discordName || row.discordUserId} (ID \${row.discordUserId}) from \${row.email}?\n\n\${action}\`)) return;
    button.disabled = true;
    button.textContent = 'Resettingâ€¦';
    try {
      const r = await api('/api/admin/discord-verifications/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discordUserId: row.discordUserId, email: row.email }),
      });
      const data = await readApiJson(r);
      if (!r.ok) throw new Error(data.error || 'Reset failed');
      const detail = data.localAction === 'email_deleted'
        ? 'The Discord association, local email record, Resend contact, and Verified role were removed.'
        : 'The Discord association, Discord segment, and Verified role were removed. The email contact was preserved.';
      showStatus(detail, true);
      await Promise.all([loadDiscordVerifications(), loadEmail()]);
    } catch (e) {
      if (e.message !== 'Unauthorized') showStatus(String(e.message || e), false);
      button.disabled = false;
      button.textContent = 'Reset';
    }
  });

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
