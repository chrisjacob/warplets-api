import test from 'node:test';
import assert from 'node:assert/strict';
import { startDemo, DEMO_NOTICE, parseDemoOptions } from './demo.mjs';
import { DEFAULT_DEMO_OWNER } from './demo-data.mjs';
import { encode58 } from '../server/base58.mjs';

test('in-memory demo serves synthetic public fixtures without creating wallet sessions', async () => {
  const demo = await startDemo({ port: 0 });
  try {
    const get = async path => {
      const response = await fetch(demo.origin + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('set-cookie'), null);
      return response.json();
    };
    const markets = await get('/api/v1/markets');
    assert.equal(markets.items[0].id, demo.info.marketId);
    assert.equal(markets.items[0].source, 'local-fixture');
    assert.equal(markets.items[0].executable, false);
    const inventories = await get('/api/v1/collect/inventories');
    assert.equal(inventories.items.length, 2);
    const nft = await get('/api/v1/collect/assets/demo-genesis-1');
    assert.equal(nft.owner, DEFAULT_DEMO_OWNER);
    assert.equal(nft.revealStatus, 'revealed');
    assert.equal(nft.level, 1);
    assert.equal(nft.traits.model, 'Demo Ink');
    const farm = await get('/api/v1/farms/demo-att');
    assert.equal(farm.source, 'local-fixture');
    assert.equal(farm.treasuryFeeBps, 0);
    const vault = await get('/api/v1/nfts/demo-genesis-1/vault');
    assert.equal(vault.items.length, 1);
    assert.equal(vault.items[0].marketId, 'demo-att');
    assert.ok(BigInt(vault.items[0].allocated) > 0n);
    assert.ok(BigInt(vault.items[0].claimable) > 0n);
    const ballots = await get('/api/v1/genesis/ballots');
    assert.equal(ballots.items[0].status, 'open');
    assert.deepEqual(ballots.items[0].choices, ['ASAP', '7', '14', '30']);
    const availability = await get('/api/v1/markets/demo-att/quote-status');
    assert.equal(availability.available, false);
    for (const path of ['/api/v1/vault', '/api/v1/stake/positions', '/api/v1/collect/me/assets']) {
      assert.equal((await fetch(demo.origin + path)).status, 401);
    }
    const html = await fetch(demo.origin + '/markets');
    assert.equal(html.status, 200);
    assert.ok((await html.text()).includes(DEMO_NOTICE));
    assert.equal(html.headers.get('cache-control'), 'no-store');
    assert.throws(() => parseDemoOptions(['--port=0']));
    assert.throws(() => parseDemoOptions(['--unknown=yes']));
    await assert.rejects(startDemo({ port: 0, wallet: 'not-a-wallet' }));
  } finally { await demo.close(); }
});

test('custom public address owns the new fixture without bypassing sign-in', async () => {
  const wallet = encode58(Buffer.alloc(32, 7));
  assert.equal(parseDemoOptions(['--wallet=' + wallet, '--port=4174']).wallet, wallet);
  const demo = await startDemo({ port: 0, wallet });
  try {
    const response = await fetch(demo.origin + '/api/v1/collect/assets/demo-season-1');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).owner, wallet);
    const reserve = await fetch(demo.origin + '/api/v1/collect/inventories/demo-season/stages/demo-priority/reservations', {
      method: 'POST', headers: { Origin: demo.origin, 'Content-Type': 'application/json', 'Idempotency-Key': 'demo-unauthorized' }, body: '{}'
    });
    assert.equal(reserve.status, 401);
    assert.equal(reserve.headers.get('set-cookie'), null);
  } finally { await demo.close(); }
});
