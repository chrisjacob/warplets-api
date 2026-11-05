import { pathToFileURL } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { createApp } from '../server/application.mjs';
import { createLocalServer } from '../server/start.mjs';
import { DEFAULT_DEMO_OWNER, seedDemo } from './demo-data.mjs';

export const DEMO_NOTICE = 'Synthetic demo — all balances, prices, NFTs and evidence are local fixtures. Nothing is bought, minted or broadcast on-chain. Restart resets everything.';

export function parseDemoOptions(args) {
  const result = { port: 4173, wallet: DEFAULT_DEMO_OWNER };
  const seen = new Set();
  for (const arg of args) {
    const match = /^--(port|wallet)=(.+)$/.exec(arg);
    if (!match || seen.has(match[1])) throw Error('Use --port=4173 and/or --wallet=PUBLIC_KEY once each.');
    seen.add(match[1]);
    if (match[1] === 'port') {
      if (!/^[1-9]\d{0,4}$/.test(match[2]) || Number(match[2]) > 65535) throw Error('Invalid port.');
      result.port = Number(match[2]);
    } else result.wallet = match[2];
  }
  return result;
}

export async function startDemo({ port = 4173, wallet = DEFAULT_DEMO_OWNER, now = Date.now() } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port.');
  const db = openDatabase(':memory:');
  let server;
  try {
    const info = seedDemo(db, { wallet, now });
    const api = createApp(db);
    server = createLocalServer(async (request, peer) => {
      const response = await api(request, peer);
      if (request.method !== 'GET' || !response.headers.get('content-type')?.includes('text/html')) return response;
      const html = (await response.text()).replace('<body>', '<body><aside role="note" aria-label="Synthetic demo">' + DEMO_NOTICE + '</aside>');
      const headers = new Headers(response.headers);
      headers.delete('content-length'); headers.set('cache-control', 'no-store');
      return new Response(html, { status: response.status, headers });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    let stopped = false;
    const close = async () => {
      if (stopped) return;
      stopped = true; server.closeAllConnections();
      await new Promise(resolve => server.close(resolve)); db.close();
    };
    return { info, origin: 'http://127.0.0.1:' + server.address().port, close };
  } catch (error) { server?.close(); db.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).includes('--help')) {
    console.log('node platform/scripts/demo.mjs [--port=4173] [--wallet=SOLANA_PUBLIC_KEY]\n' + DEMO_NOTICE);
  } else {
    const demo = await startDemo(parseDemoOptions(process.argv.slice(2)));
    console.log(DEMO_NOTICE);
    console.log('Open ' + demo.origin + '/markets (browser is not launched automatically).');
    console.log('Fixture owner: ' + demo.info.wallet);
    console.log('Use --wallet=YOUR_PUBLIC_KEY to view private positions after normal wallet message sign-in. No sessions are pre-created.');
    console.log('Earn stake fixture expires at ' + demo.info.stakeEligibilityExpiresAt + '; restart to refresh. No quote evidence is seeded.');
    const stop = () => { void demo.close().then(() => process.exit(0)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
}
