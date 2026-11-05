import { NOTICE_MS } from './ballot.mjs';
import {
  GENESIS_STAGE_ONE_PRICE, GENESIS_TRANCHES, LEVEL_QUOTAS, SLOTS_PER_TRANCHE, checkId,
  checkTimestamp, drawLevel, requirePolicy, walletSnapshot,
} from './policy.mjs';

/** A reference reducer for one tranche or monthly Season. The persistence adapter
 * must atomically compare inventory.version before committing any transition.
 * This domain library does not sign, submit or verify chain operations.
 */
export function createInventory({ id, kind, tranche }) {
  checkId(id);
  requirePolicy(kind === 'genesis' || kind === 'season', 'invalid_collection_kind');
  if (kind === 'genesis') requirePolicy(Number.isInteger(tranche) && tranche >= 1
    && tranche <= GENESIS_TRANCHES, 'invalid_genesis_tranche');
  return Object.freeze({ id, kind, tranche, version: 0, slots: SLOTS_PER_TRANCHE,
    stages: Object.freeze([]), admissions: Object.freeze([]), remaining: LEVEL_QUOTAS, fulfilled: 0 });
}

function update(inventory, patch) {
  return Object.freeze({ ...inventory, ...patch, version: inventory.version + 1 });
}

/** A canonical stage publication is an immutable price/eligibility contract.
 * The same eligible wallet may participate across stages as capacity permits.
 */
export function publishStage(inventory, input) {
  const { id, type, publishedAt, opensAt, closesAt, priceLamports, allocation } = input;
  checkId(id);
  checkTimestamp(publishedAt);
  checkTimestamp(opensAt);
  checkTimestamp(closesAt);
  requirePolicy(publishedAt <= opensAt && closesAt > opensAt, 'invalid_stage_window');
  requirePolicy(!inventory.stages.some(stage => stage.id === id), 'duplicate_stage');
  requirePolicy(typeof priceLamports === 'bigint' && priceLamports >= 0n, 'invalid_price');
  requirePolicy(Number.isInteger(allocation) && allocation > 0 && allocation <= inventory.slots,
    'invalid_stage_allocation');
  requirePolicy(['whitelist', 'public', 'free', 'founder'].includes(type), 'invalid_stage_type');
  if (type === 'public') requirePolicy(input.founderApproved === true, 'public_stage_requires_approval');
  if (type === 'founder') requirePolicy(input.founderApproved === true
    && typeof input.approvedSpendLamports === 'bigint' && input.approvedSpendLamports >= 0n,
    'founder_stage_requires_budget');
  if (inventory.kind === 'genesis') {
    requirePolicy(opensAt - publishedAt >= NOTICE_MS, 'insufficient_genesis_notice');
    requirePolicy(type !== 'free', 'invalid_genesis_stage');
    if (inventory.tranche === 1 && !inventory.stages.some(stage => stage.type === 'whitelist')
      && type === 'whitelist') requirePolicy(priceLamports === GENESIS_STAGE_ONE_PRICE, 'initial_genesis_price');
  }
  if (type === 'free') requirePolicy(priceLamports === 0n && inventory.kind === 'season', 'invalid_free_price');
  if (type === 'founder') requirePolicy(priceLamports === 0n, 'invalid_founder_price');
  // Only Genesis and the Season free stage have a settled one-per-wallet rule.
  // Paid Season phases and the founder backstop use their published quantity.
  const walletLimit = inventory.kind === 'genesis' || type === 'free' ? 1 : input.walletLimit;
  requirePolicy(Number.isInteger(walletLimit) && walletLimit > 0 && walletLimit <= inventory.slots,
    'invalid_wallet_limit');
  if (inventory.kind === 'season' && type === 'free') {
    requirePolicy(!inventory.stages.some(s => s.type === 'free'), 'duplicate_free_stage');
    requirePolicy(inventory.stages.filter(s => s.type === 'whitelist' && s.closesAt <= opensAt).length >= 2
      && !inventory.stages.some(s => s.closesAt > opensAt), 'paid_stages_incomplete');
  }
  if (inventory.kind === 'season' && (type === 'public' || type === 'founder')) {
    requirePolicy(inventory.stages.some(s => s.type === 'free' && s.closesAt <= opensAt),
      'free_stage_incomplete');
  }
  // The free-phase list must come from the ownership cut at opening, which may be
  // later than publication. Attach it once in freezeFreeStage().
  const wallets = type === 'public' || type === 'free' ? null : walletSnapshot(input.wallets);
  const stage = Object.freeze({ id, type, publishedAt, opensAt, closesAt, priceLamports,
    allocation, wallets, walletLimit, approvedSpendLamports: input.approvedSpendLamports });
  return update(inventory, { stages: Object.freeze([...inventory.stages, stage]) });
}

export function freezeFreeStage(inventory, stageId, snapshot) {
  const stage = inventory.stages.find(s => s.id === stageId);
  requirePolicy(stage?.type === 'free' && stage.wallets === null, 'free_stage_unavailable');
  requirePolicy(checkTimestamp(snapshot.at) === stage.opensAt, 'wrong_free_snapshot_boundary');
  const nextStage = Object.freeze({ ...stage, wallets: walletSnapshot(snapshot.wallets) });
  return update(inventory, { stages: Object.freeze(inventory.stages.map(s => s === stage ? nextStage : s)) });
}

/** Admit a pre-committed draw before its entropy is known. Store the admission order
 * alongside the verified payment in the same atomic operation in a future adapter.
 * The price is returned with the stage contract. No client-provided rarity or level.
 */
export function admitMint(inventory, { operationId, wallet, stageId, at, drawCommitment, costLamports }) {
  checkId(operationId);
  checkId(drawCommitment);
  checkId(wallet);
  checkTimestamp(at);
  const prior = inventory.admissions.find(row => row.operationId === operationId);
  if (prior) {
    requirePolicy(prior.wallet === wallet && prior.stageId === stageId && prior.drawCommitment === drawCommitment
      && prior.costLamports === costLamports, 'conflicting_mint_retry');
    return inventory;
  }
  const stage = inventory.stages.find(s => s.id === stageId);
  requirePolicy(stage && stage.opensAt <= at && at < stage.closesAt, 'stage_unavailable');
  requirePolicy(stage.type === 'public' || stage.wallets?.includes(wallet), 'wallet_ineligible');
  requirePolicy(typeof costLamports === 'bigint' && costLamports >= 0n, 'missing_cost_quote');
  requirePolicy(!inventory.admissions.some(row => row.drawCommitment === drawCommitment), 'duplicate_draw_commitment');
  const sameStage = inventory.admissions.filter(row => row.stageId === stageId);
  requirePolicy(sameStage.filter(row => row.wallet === wallet).length < stage.walletLimit, 'stage_wallet_limit');
  requirePolicy(sameStage.length < stage.allocation && inventory.admissions.length < inventory.slots, 'sold_out');
  if (stage.type === 'founder') {
    const spent = sameStage.reduce((sum, row) => sum + row.costLamports, 0n);
    requirePolicy(spent + costLamports <= stage.approvedSpendLamports, 'founder_budget_exceeded');
  }
  const row = Object.freeze({ operationId, wallet, stageId, drawCommitment, admittedAt: at,
    costLamports, level: null, proofId: null, ticket: null });
  return update(inventory, { admissions: Object.freeze([...inventory.admissions, row]) });
}

/** Input comes exclusively from a future proof-verified entropy adapter. Published
 * commitment binds inventory, sequence and request; the verifier must produce the
 * same unbiased ticket on retry. This function ONLY reduces verified evidence.
 */
export function applyVerifiedMintDraw(inventory, { operationId, drawCommitment, proofId, ticket }) {
  checkId(proofId);
  const index = inventory.admissions.findIndex(row => row.operationId === operationId);
  requirePolicy(index >= 0, 'unknown_mint');
  const row = inventory.admissions[index];
  requirePolicy(row.drawCommitment === drawCommitment, 'wrong_draw_commitment');
  if (row.level !== null) {
    requirePolicy(row.proofId === proofId && row.ticket === ticket, 'conflicting_draw_retry');
    return inventory;
  }
  requirePolicy(index === inventory.fulfilled, 'draw_out_of_order');
  requirePolicy(!inventory.admissions.some(entry => entry.proofId === proofId), 'duplicate_draw_proof');
  const level = drawLevel(inventory.remaining, ticket);
  const remaining = [...inventory.remaining];
  remaining[level - 1]--;
  const updated = Object.freeze({ ...row, level, proofId, ticket });
  return update(inventory, { fulfilled: inventory.fulfilled + 1, remaining: Object.freeze(remaining),
    admissions: Object.freeze(inventory.admissions.map((entry,i) => i === index ? updated : entry)) });
}

export function inventoryCounts(inventory) {
  const counts = { paid: 0, free: 0, founder: 0, pending: 0,
    unsold: inventory.slots - inventory.admissions.length, unmintedReserve: inventory.slots - inventory.fulfilled };
  const stageTypes = new Map(inventory.stages.map(stage => [stage.id, stage.type]));
  for (const row of inventory.admissions) {
    if (row.level === null) counts.pending++;
    else {
      const type = stageTypes.get(row.stageId);
      counts[type === 'founder' || type === 'free' ? type : 'paid']++;
    }
  }
  return Object.freeze(counts);
}
