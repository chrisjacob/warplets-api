import assert from 'node:assert/strict';
import test from 'node:test';
import { handleLaunchPlans } from './router.mjs';
import { previewLaunchPlan as plan } from './planner.mjs';
import { launchPlanPaths } from './schema.mjs';

const day = 86400;
const now = Date.parse('2026-10-04T12:50:00Z') / 1000; // 23:50 Sydney after spring DST change.
const input = { proposedActivation: now, supplyBaseUnits: '1000000000', activeSeasonWeight: '2013' };
const history = { coversFrom: now - 11 * day, observedAt: now, launches: [] };
const cost = { availableCashCents: 3000, networkCents: 100, rentCents: 300, protocolCents: 99, retryCents: 40, otherCents: 0 };
const og = { mint: '11111111111111111111111111111111', decimals: 6, compatibility: 'reviewed',
  source: 'pool-lab', priceUsdMicros: '2500000', observedAt: now };
const swapSimulation = { ogSpentUnits: '2000000', attReceivedUnits: '100000', observedAt: now, source: 'fixture' };
const status = (p, id) => p.gates.find(g => g.id === id)?.status;
const endpoint = 'http://localhost/api/v1/launch-plans';
const post = (body, headers = { 'content-type': 'application/json' }) => new Request(endpoint + '/preview', { method: 'POST', body, headers });
// Fixtures use relative seconds for boundary arithmetic; the actual public
// contract always exercises UTC timestamp strings.
const wire = input => JSON.parse(JSON.stringify(input, (key, value) =>
  ['proposedActivation','observedAt','activatedAt','coversFrom'].includes(key) && typeof value === 'number' ?
    new Date(value * 1000).toISOString() : value));
const previewLaunchPlan = (input, now) => plan(wire(input), now);

test('stateless route gives exact allocations, elapsed fee boundary and simulated paid FDV', async () => {
  const response = await handleLaunchPlans(post(JSON.stringify(wire({ ...input, history, firstPilotCost: cost, og, swapSimulation }))), { nowSeconds: now });
  assert.equal(response.status, 200);
  const p = await response.json();
  assert.equal(p.executable, false);
  assert.equal(p.proposedActivation, new Date(now * 1000).toISOString());
  assert.equal(p.assessedAt, p.proposedActivation);
  assert.equal(p.allocationBaseUnits.stake, '50000000');
  assert.equal(p.feeSchedule.find(f => f.elapsedSeconds === 89).feeBps, 100);
  assert.equal(p.simulatedFdvUsdMicros, '50000000000');
  assert.equal(status(p, 'protocolParity'), 'unknown');
  assert.deepEqual((await (await handleLaunchPlans(new Request(endpoint))).json()).items, []);
  assert.equal(await handleLaunchPlans(new Request(endpoint + '/wrong')), null);
  assert.equal(launchPlanPaths['/launch-plans/preview'].post.requestBody.required, true);
});

test('launch day follows Sydney calendar; capacity excludes a campaign ending at activation', () => {
  const launches = Array.from({ length: 10 }, (_, i) => ({ id: String(i), activatedAt: now - (i + 1) * day + 1 }));
  const full = previewLaunchPlan({ ...input, history: { ...history, launches } }, now);
  assert.equal(full.sydneyLaunchDay, '2026-10-04');
  assert.equal(status(full, 'capacity'), 'blocked');
  launches[9].activatedAt -= 1;
  assert.equal(status(previewLaunchPlan({ ...input, history: { ...history, launches } }, now), 'capacity'), 'pass');
  const prior = { ...history, launches: [{ id: 'recent', activatedAt: now - 1 }] };
  assert.equal(status(previewLaunchPlan({ ...input, history: prior }, now), 'sydneyDay'), 'blocked');
  const tomorrow = previewLaunchPlan({ ...input, proposedActivation: now + 600, history: prior }, now);
  assert.equal(tomorrow.sydneyLaunchDay, '2026-10-05');
  assert.equal(status(tomorrow, 'sydneyDay'), 'pass');
});

test('cost review honors under-$10 and cash share, $30 hard ceiling, advisory reserve', () => {
  function atCost(total, cash) {
    const firstPilotCost = { ...cost, networkCents: total, rentCents: 0, protocolCents: 0, otherCents: 0, retryCents: 0, availableCashCents: cash };
    return previewLaunchPlan({ ...input, firstPilotCost }, now);
  }
  assert.equal(status(atCost(600, 3000), 'pilotCost'), 'pass');
  assert.equal(status(atCost(601, 3000), 'pilotCost'), 'review');
  assert.equal(status(atCost(1000, 15000), 'pilotCost'), 'review');
  assert.equal(status(atCost(3000, 4500), 'reserveGuideline'), 'review');
  assert.equal(status(atCost(3000, 4500), 'pilotCost'), 'review');
  assert.equal(status(atCost(3001, 15000), 'pilotCost'), 'blocked');
  assert.equal(status(atCost(901, 900), 'pilotCost'), 'blocked');
});

test('insufficient, future or stale evidence cannot produce an effective FDV or a clean history gate', () => {
  const missing = previewLaunchPlan(input, now);
  assert.equal(missing.simulatedFdvUsdMicros, null);
  assert.equal(missing.activeCampaigns, null);
  assert.equal(status(missing, 'pilotCost'), 'unknown');
  for (const observedAt of [now - 61, now + 1]) {
    const p = previewLaunchPlan({ ...input, og: { ...og, observedAt }, swapSimulation,
      history: { ...history, observedAt } }, now);
    assert.equal(p.simulatedFdvUsdMicros, null);
    assert.equal(status(p, 'launchHistory'), 'unknown');
  }
  assert.equal(previewLaunchPlan({ ...input, history: { ...history, coversFrom: now - day } }, now).activeCampaigns, null);
  assert.equal(previewLaunchPlan({ ...input, og: { ...og, compatibility: 'unsupported' }, swapSimulation }, now).simulatedFdvUsdMicros, null);
});

test('malformed, oversized and unsupported requests return typed errors without persisting plans', async () => {
  const invalid = [
    { ...input, activeSeasonWeight: '0.1' }, { ...input, supplyBaseUnits: '0200' }, { ...input, og: { ...og, mint: 'X'.repeat(44) } },
    { ...input, supplyBaseUnits: '18446744073709551616' }, { ...input, supplyBaseUnits: '50' },
    { ...input, signed: true }, { ...input, history: { ...history, launches: [{ id: 'x', activatedAt: now + 1 }] } },
  ];
  for (const value of invalid) assert.equal((await handleLaunchPlans(post(JSON.stringify(wire(value))), { nowSeconds: now })).status, 400);
  for (const proposedActivation of [now, '2026-02-30T08:00:00Z', '2026-01-01T00:00:00.100Z']) {
    assert.equal((await handleLaunchPlans(post(JSON.stringify({ ...wire(input), proposedActivation })), { nowSeconds: now })).status, 400);
  }
  assert.equal((await handleLaunchPlans(post('{'))).status, 400);
  assert.equal((await handleLaunchPlans(post('{}', { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handleLaunchPlans(post('x'.repeat(32769)))).status, 413);
  const wrong = await handleLaunchPlans(new Request(endpoint + '/preview'));
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST');
});
