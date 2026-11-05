import { CAMPAIGN_SECONDS, U64_MAX, launchAllocations, launchFeeBps } from '../domain/economics/index.mjs';
import { decode58 } from '../server/base58.mjs';
import { launchPlanTerms, validateInput } from './schema.mjs';
import { assessPilotBudget } from '../costs/budget.mjs';

const calendar = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney', day: '2-digit', month: '2-digit', year: 'numeric',
});
function sydneyDate(seconds) {
  const parts = Object.fromEntries(calendar.formatToParts(new Date(seconds * 1000)).map(p => [p.type, p.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}
function gate(id, status, detail) { return { id, status, detail }; }
function fresh(observedAt, now) {
  return observedAt <= now && now - observedAt <= launchPlanTerms.maxEvidenceAgeSeconds;
}
function rawUnits(value, name) {
  const units = BigInt(value);
  if (units > U64_MAX) throw new RangeError(`${name} exceeds u64`);
  return units;
}

function unixSeconds(timestamp, field) {
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis) || millis < 0 || new Date(millis).toISOString() !== timestamp.replace(/(?:\.0{1,3})?Z$/, '.000Z')) {
    throw new RangeError(`${field} must be a real UTC calendar timestamp`);
  }
  return millis / 1000;
}
function normalizeScenario(input) {
  const withObservation = (value) => value?.observedAt === undefined ? value :
    { ...value, observedAt: unixSeconds(value.observedAt, 'observedAt') };
  return {
    ...input, proposedActivation: unixSeconds(input.proposedActivation, 'proposedActivation'),
    og: withObservation(input.og), swapSimulation: withObservation(input.swapSimulation),
    history: input.history && {
      ...withObservation(input.history), coversFrom: unixSeconds(input.history.coversFrom, 'coversFrom'),
      launches: input.history.launches.map(launch => ({ ...launch, activatedAt: unixSeconds(launch.activatedAt, 'activatedAt') })),
    },
  };
}

function recentCampaigns(history, now, proposed, day, gates) {
  if (!history) {
    gates.push(gate('launchHistory', 'unknown', 'Supply all recent campaigns and their actual activation times.'));
    return null;
  }
  if (history.coversFrom > history.observedAt) throw new RangeError('history coverage starts after its observation');
  const ids = new Set();
  for (const launch of history.launches) {
    if (ids.has(launch.id)) throw new RangeError('launch history contains a duplicate id');
    if (launch.activatedAt > history.observedAt || launch.activatedAt < history.coversFrom) {
      throw new RangeError('launch outside declared history coverage');
    }
    ids.add(launch.id);
  }
  if (!fresh(history.observedAt, now) ||
      history.coversFrom > Math.max(0, proposed - Number(CAMPAIGN_SECONDS))) {
    gates.push(gate('launchHistory', 'unknown', 'Refresh history with coverage for the preceding ten campaign days.'));
    return null;
  }
  const sameDay = history.launches.some(launch => sydneyDate(launch.activatedAt) === day);
  const active = history.launches.filter(launch =>
    launch.activatedAt <= proposed && proposed < launch.activatedAt + Number(CAMPAIGN_SECONDS)).length;
  gates.push(gate('sydneyDay', sameDay ? 'blocked' : 'pass', sameDay ?
    'The supplied history already includes a launch on this Sydney date.' : 'No launch on this date in supplied history.'));
  gates.push(gate('capacity', active >= 10 ? 'blocked' : 'pass',
    `${active} existing campaigns would still be active at the proposed time.`));
  return active;
}

function checkCost(cost, gates) {
  if (!cost) {
    gates.push(gate('pilotCost', 'unknown', 'Provide cash, rent, fees, retries and other quoted charges.'));
    return null;
  }
  const totalCents = cost.networkCents + cost.rentCents + cost.protocolCents + cost.retryCents + cost.otherCents;
  const reviewed = assessPilotBudget(BigInt(totalCents)*10000n, BigInt(cost.availableCashCents)*10000n);
  const ordinaryTargetCents = Number(BigInt(reviewed.ordinaryTargetUsdMicros)/10000n);
  const { founderExceptionNeeded, reserveGuidelineMet } = reviewed;
  if (reviewed.status==='blocked') {
    gates.push(gate('pilotCost', 'blocked', 'The total exceeds available cash or the US$30 exception ceiling.'));
  } else {
    gates.push(gate('pilotCost', founderExceptionNeeded ? 'review' : 'pass', founderExceptionNeeded ?
      'This estimate needs founder exception review.' : 'The estimate fits the ordinary pilot target.'));
  }
  gates.push(gate('reserveGuideline', reserveGuidelineMet ? 'pass' : 'review',
    'The 50% cash reserve is a founder planning guideline.'));
  return { totalCents, availableCashCents: cost.availableCashCents, ordinaryTargetCents, reserveGuidelineMet, founderExceptionNeeded };
}

function marketEstimate(og, simulation, supply, now, gates) {
  if (!og) {
    gates.push(gate('ogEvidence', 'unknown', 'OG mint compatibility and price evidence are missing.'));
    return null;
  }
  try { decode58(og.mint, 32); } catch { throw new RangeError('og.mint must be a canonical 32-byte Solana address'); }
  gates.push(gate('ogCompatibility', { reviewed: 'review', unknown: 'unknown', unsupported: 'blocked' }[og.compatibility],
    'Mint extensions, program and route compatibility require independent inspection.'));
  const hasPrice = og.priceUsdMicros !== undefined && rawUnits(og.priceUsdMicros, 'OG price') > 0n &&
    Boolean(og.source?.trim()) && og.observedAt !== undefined && fresh(og.observedAt, now);
  gates.push(gate('ogUsd', hasPrice ? 'pass' : 'unknown', hasPrice ?
    'Scenario includes a fresh, positive OG reference price.' : 'Supply a positive, sourced OG price within the fixture freshness window.'));
  if (!simulation) {
    gates.push(gate('swapSimulation', 'unknown', 'A simulated buy with OG spent and ATT received is needed for effective FDV.'));
    return null;
  }
  const spent = rawUnits(simulation.ogSpentUnits, 'OG spent');
  const received = rawUnits(simulation.attReceivedUnits, 'ATT received');
  if (spent === 0n || received === 0n) throw new RangeError('swap amounts must both be positive');
  if (received > supply) throw new RangeError('swap output exceeds original supply');
  const usable = fresh(simulation.observedAt, now) && Boolean(simulation.source.trim());
  gates.push(gate('swapSimulation', usable ? 'pass' : 'unknown', usable ?
    'Scenario includes a recent sourced simulated buy.' : 'Refresh simulation evidence.'));
  if (!hasPrice || !usable || og.compatibility === 'unsupported') return null;
  // ATT decimals cancel between supply and received. Convert OG base units
  // before multiplying by USD micros per whole OG; floor only the final result.
  return String(supply * spent * BigInt(og.priceUsdMicros) / (10n ** BigInt(og.decimals) * received));
}

export function previewLaunchPlan(scenario, nowSeconds) {
  validateInput(scenario);
  const input = normalizeScenario(scenario);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0 || nowSeconds > 253402300799) {
    throw new RangeError('invalid observation time');
  }
  const supply = rawUnits(input.supplyBaseUnits, 'supply');
  const activation = BigInt(input.proposedActivation);
  const split = launchAllocations({ supply, activeSeasonWeight: rawUnits(input.activeSeasonWeight, 'Season weight') });
  const day = sydneyDate(input.proposedActivation);
  const gates = [gate('proposedTime', input.proposedActivation < nowSeconds ? 'blocked' : 'pass',
    'The actual chain activation, once observed, starts every token clock.')];
  const activeCampaigns = recentCampaigns(input.history, nowSeconds, input.proposedActivation, day, gates);
  const pilotCost = checkCost(input.firstPilotCost, gates);
  const simulatedFdvUsdMicros = marketEstimate(input.og, input.swapSimulation, supply, nowSeconds, gates);
  gates.push(gate('protocolParity', 'unknown', 'Verify deployed pool fee schedule, LP lock, fee rights and staking behavior.'),
    gate('rewardCustody', 'unknown', 'Verify permanent claims, reserves and vesting against reviewed programs.'));
  return {
    mode: launchPlanTerms.mode, executable: false, assessedAt: new Date(nowSeconds * 1000).toISOString(),
    proposedActivation: new Date(input.proposedActivation * 1000).toISOString(), sydneyLaunchDay: day,
    allocationBaseUnits: Object.fromEntries(Object.entries(split).map(([key, amount]) => [key, String(amount)])),
    feeSchedule: [0, 1, 30, 60, 88, 89, 90].map(elapsedSeconds => ({
      elapsedSeconds, feeBps: Number(launchFeeBps({ activatedAt: activation, at: activation + BigInt(elapsedSeconds) })),
    })), activeCampaigns, pilotCost, simulatedFdvUsdMicros, gates,
  };
}
