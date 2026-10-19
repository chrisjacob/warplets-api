import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as proxyRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), app = resolve(root, 'app');
const apiPort = 8798, publicPort = 8799, localOnly = process.argv.includes('--local-only');
const node = process.execPath, children = [], nonce = randomUUID();
const baseEnv = { ...process.env, WRANGLER_LOG_PATH: resolve(root, '.tmp/network-wrangler.log'), WRANGLER_SEND_METRICS: 'false' };
function run(args, cwd = root) {
  const result = spawnSync(node, args, { cwd, env: baseEnv, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw Error(`Network setup failed (${result.status})`);
}
run([resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/network/local.ts', '--status']);
run([resolve(app, 'node_modules/vite/bin/vite.js'), 'build', '--config', resolve(app, 'vite.network.config.ts')]);
let stopping = false, apiRestart;
function startApi() {
  if (stopping) return;
  const api = spawn(node, [resolve(app, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'dev', resolve(root, '.tmp/network-dist'), '--ip', '127.0.0.1', '--port', String(apiPort), '--persist-to', '.wrangler/state', '--binding', 'NETWORK_ENABLED=true', '--binding', 'NETWORK_INGEST_ENABLED=false'], { cwd: app, env: baseEnv, stdio: 'inherit', windowsHide: true });
  children.push(api);
  let ended = false;
  const recover = () => {
    if (ended) return;
    ended = true;
    const index = children.indexOf(api);
    if (index >= 0) children.splice(index, 1);
    if (!stopping) {
      console.warn('Network preview exited; restarting in 3 seconds.');
      apiRestart = setTimeout(startApi, 3000);
    }
  };
  api.once('exit', recover);
  api.once('error', recover);
}
startApi();
const allowed = new Set(['/', '/network', '/network/', '/network/countries.json', '/network/icon.svg', '/api/network/dashboard', '/api/network/history', '/api/network/members']);
const preview = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const stateMap = /^\/network\/states\/[A-Z]{2}\.json$/.test(url.pathname);
  const asset = /^\/assets\/[a-zA-Z0-9._-]+\.(js|css)$/.test(url.pathname) && readdirSync(resolve(root, '.tmp/network-dist/assets')).includes(url.pathname.slice(8));
  if (!['GET', 'HEAD'].includes(req.method ?? '') || !allowed.has(url.pathname) && !asset && !stateMap) { res.writeHead(404, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end('Not found'); return; }
  const upstream = proxyRequest({ hostname: '127.0.0.1', port: apiPort, path: url.pathname + url.search, method: req.method,
    headers: { host: 'network-local.10x.meme', 'x-10x-public-origin': 'https://network-local.10x.meme', accept: req.headers.accept ?? '*/*' } }, response => {
    res.writeHead(response.statusCode ?? 502, { ...response.headers, 'x-network-preview': nonce, 'x-robots-tag': 'noindex, nofollow' }); response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(503); res.end('Network preview is starting'); });
  upstream.end();
});
await new Promise((ok, reject) => { preview.once('error', reject); preview.listen(publicPort, '127.0.0.1', ok); });
let refreshing = false;
const refreshTimer = setInterval(() => {
  if (refreshing) return;
  refreshing = true;
  const child = spawn(node, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/network/local.ts'], { cwd: root, env: baseEnv, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.once('exit', () => { refreshing = false; const index = children.indexOf(child); if (index >= 0) children.splice(index, 1); });
  child.once('error', () => { refreshing = false; });
}, 300_000);
const stop = () => { stopping = true; clearTimeout(apiRestart); clearInterval(refreshTimer); for (const child of children) child.kill(); preview.close(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
let ready = false;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`http://127.0.0.1:${publicPort}/api/network/dashboard`, { signal: AbortSignal.timeout(3000) }); await r.body?.cancel(); if (r.ok) { ready = true; break; } } catch {}
  await new Promise(r => setTimeout(r, 1000));
}
if (!ready) { stop(); throw Error('Network Pages Functions did not become ready'); }
if (!localOnly) {
  const credentials = process.env.NETWORK_TUNNEL_CREDENTIALS_FILE || resolve(root, '.tmp/network-tunnel.json');
  const tunnel = spawn('C:/Program Files (x86)/cloudflared/cloudflared.exe', ['tunnel', '--credentials-file', credentials, 'run', '--url', `http://127.0.0.1:${publicPort}`, process.env.NETWORK_TUNNEL_ID || 'network-local'], { env: baseEnv, stdio: 'inherit', windowsHide: true });
  children.push(tunnel); tunnel.once('exit', () => stop());
}
console.log(`Network compiled preview ready: ${localOnly ? `http://127.0.0.1:${publicPort}` : 'https://network-local.10x.meme'} (restricted to public Network GET routes).`);
