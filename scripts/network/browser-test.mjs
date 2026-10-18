import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, '.tmp/network-qa');
await mkdir(output, { recursive: true });
const origin = process.env.NETWORK_TEST_ORIGIN || 'http://127.0.0.1:8799';
for (const path of ['/api/admin/network', '/api/social/config', '/src/network/NetworkApp.tsx', '/.dev.vars', '/migrations/0095_network.sql']) assert.equal((await fetch(origin + path)).status, 404, `Must block ${path}`);
assert.equal((await fetch(origin + '/api/network/dashboard?country=invalid')).status, 400);
assert.equal((await fetch(origin + '/api/network/dashboard', { method: 'POST' })).status, 404);
assert.equal((await fetch(origin + '/api/network/dashboard?random=1')).status, 400);
assert.equal((await fetch(origin + '/api/network/members?q=one&q=two')).status, 400);
const pagePolicy = (await fetch(origin)).headers.get('content-security-policy');
assert.ok(pagePolicy?.includes("script-src 'self';"));
assert.ok(!pagePolicy?.includes('unsafe-eval'));
for (const api of ['dashboard', 'members', 'history']) {
  const endpoint = origin + '/api/network/' + api;
  await (await fetch(endpoint)).arrayBuffer();
  let hit = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(endpoint); await response.arrayBuffer();
    if (response.headers.get('x-network-cache') === 'HIT') { hit = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(hit, `Edge cache should serve repeated ${api} reads`);
}
assert.equal((await fetch(origin + '/api/network/members?after=-1')).status, 400);
const directory = await (await fetch(origin + '/api/network/members')).json();
assert.equal(directory.members.length, 24);
assert.ok(directory.members.some(m => m.username && m.avatarUrl));
assert.ok(directory.members.every(m => m.profileUrl === `https://farcaster.xyz/~/profiles/${m.fid}`));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9228', `--user-data-dir=${resolve(output, 'browser')}`, origin], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let target;
  for (let i = 0; i < 60; i++) { try { target = (await (await fetch('http://127.0.0.1:9228/json/list')).json()).find(t => t.type === 'page'); if (target) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  if (!target) throw Error('Headless Chrome did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, reject) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.ok(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); });
  function send(method, params = {}) { return new Promise((ok, reject) => { const id = ++next; pending.set(id, { ok, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; }
  async function until(expression) { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 250)); } throw Error(`Timed out: ${expression}`); }
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin });
  await until(`document.querySelectorAll('.network-country').length > 100 && !document.querySelector('[aria-busy="true"]')`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Desktop overflow');
  const screenshot = async name => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(output, name), Buffer.from(r.data, 'base64')); };
  await screenshot('desktop.png');
  assert.equal(await evaluate(`document.querySelectorAll('.network-member').length`), 24, 'Member cards');
  const firstFid = await evaluate(`document.querySelector('.network-member').href.split('/').pop()`);
  await evaluate(`document.querySelector('.network-member-pagination button:last-child').click()`);
  await until(`!document.querySelector('[aria-busy="true"]') && document.querySelector('.network-member-pagination>span')?.textContent==='Page 2'`);
  assert.notEqual(await evaluate(`document.querySelector('.network-member').href.split('/').pop()`), firstFid, 'Next page changes members');
  await evaluate(`document.querySelector('.network-member-pagination button').click()`);
  await until(`!document.querySelector('[aria-busy="true"]') && document.querySelector('.network-member-pagination>span')?.textContent==='Page 1'`);
  await evaluate(`{const input=document.querySelector('[aria-label="Search members"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${directory.members[0].fid}');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await until(`document.querySelectorAll('.network-member').length===1 && !document.querySelector('[aria-busy="true"]')`);
  assert.equal(await evaluate(`document.querySelector('.network-member').href.split('/').pop()`), String(directory.members[0].fid), 'Search by FID');
  await evaluate(`document.querySelector('#network-members').scrollIntoView({behavior:'instant'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await screenshot('members-desktop.png');
  await evaluate(`document.querySelectorAll('.network-filter-fields select')[1].value='known'; document.querySelectorAll('.network-filter-fields select')[1].dispatchEvent(new Event('change',{bubbles:true}))`);
  await until(`location.search.includes('location=known') && !document.querySelector('[aria-busy="true"]')`);
  const shown = await evaluate(`document.querySelector('.network-kpis strong').textContent`);
  const response = await (await fetch(origin + '/api/network/dashboard?location=known')).json();
  assert.equal(shown, response.population == null ? '—' : response.population.toLocaleString('en-US'));
  const knownMembers = await (await fetch(origin + '/api/network/members?location=known')).json();
  assert.equal(knownMembers.total, response.population, 'Member and dashboard filters reconcile');
  await evaluate(`document.querySelector('.network-reset').click()`);
  await until(`!location.search && !document.querySelector('[aria-busy="true"]')`);
  const walletData = await (await fetch(origin + '/api/network/dashboard')).json();
  if(walletData.economics.status!=='unavailable') {
    assert.ok(Number(walletData.economics.totalUsd)>=0);
    assert.ok(walletData.economics.coverage.measuredWallets<=walletData.economics.coverage.expectedWallets);
    const top=walletData.heldTokens.find(row=>row.id.startsWith('eip155:')&&row.population>0);
    if(top){
      await evaluate(`{const select=document.querySelector('[aria-label="Top token held"]');select.value=${JSON.stringify(top.id)};select.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await until(`location.search.includes('held=') && !document.querySelector('[aria-busy="true"]')`);
      const selected=await(await fetch(origin+'/api/network/dashboard?held='+encodeURIComponent(top.id))).json();
      const people=await(await fetch(origin+'/api/network/members?held='+encodeURIComponent(top.id))).json();
      assert.equal(selected.population,people.total,'Top-held filter reconciles with members');
      assert.equal(await evaluate(`document.querySelector('.network-kpis strong').textContent`),selected.population.toLocaleString('en-US'));
      await evaluate(`document.querySelector('.network-reset').click()`);
      await until(`!location.search && !document.querySelector('[aria-busy="true"]')`);
    }
    await evaluate(`{const select=document.querySelector('[aria-label="Map metric"]');select.value='wallet';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    assert.ok(await evaluate(`document.querySelector('.network-map-key').textContent.includes('wallet USD')`));
    await evaluate(`document.querySelector('.network-wallet-coverage').scrollIntoView({behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await screenshot('wallets-desktop.png');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: origin });
  await until(`document.querySelectorAll('.network-country').length > 100 && !document.querySelector('[aria-busy="true"]')`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Mobile overflow');
  assert.equal(await evaluate(`document.querySelector('.network-filters').open`), false, 'Mobile filters start collapsed');
  await screenshot('mobile.png');
  await evaluate(`document.querySelector('#network-members').scrollIntoView({behavior:'instant'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await screenshot('members-mobile.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Member cards mobile overflow');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(JSON.stringify({ status: 'passed', checks: ['restricted public routes', 'invalid filters', 'desktop layout', 'member cards and FID links', 'member pagination', 'exact FID search', 'cross-filtered KPI and members', 'reset', 'mobile layout', 'collapsed mobile filters', 'no browser exceptions'], output }));
} finally { socket?.close(); chrome.kill(); }
