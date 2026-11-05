import {
  HOUR_MS, LAMPORTS_PER_SOL, LEVEL_QUOTAS, checkId, checkLevel, checkTimestamp, drawLevel,
  requirePolicy, seasonExpiry,
} from './policy.mjs';

const BASE_FEE = LAMPORTS_PER_SOL / 100n;
const MAX_LAMPORTS = (1n << 64n) - 1n;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000n;

function checkCounter(value) {
  requirePolicy(Number.isSafeInteger(value) && value >= 0, 'invalid_counter');
  return value;
}

function nextVersion(version) {
  return checkCounter(checkCounter(version) + 1);
}

function traits(value) {
  requirePolicy(value && typeof value === 'object', 'invalid_traits');
  return Object.freeze({ model: checkId(value.model), backdrop: checkId(value.backdrop), symbol: checkId(value.symbol) });
}

export function visualRerollQuote(completedRerolls, at) {
  const r = checkCounter(completedRerolls);
  checkTimestamp(at);
  // Bound before shifting: an untrusted huge exponent must never allocate a huge bigint.
  requirePolicy(r < 64, 'reroll_quote_unrepresentable');
  const multiplier = 1n << BigInt(r);
  const feeLamports = BASE_FEE * multiplier;
  const cooldownMs = BigInt(HOUR_MS) * multiplier;
  requirePolicy(feeLamports <= MAX_LAMPORTS && BigInt(at) + cooldownMs <= MAX_TIMESTAMP_MS,
    'reroll_quote_unrepresentable');
  return Object.freeze({ feeLamports, cooldownMs: Number(cooldownMs) });
}

/** Minimal, bounded state for reference evaluation of a single Season. Vault
 * allocation history is held by the allocation ledger, keyed by stable asset ID.
 */
export function progressionState({ seasonId, start, assets }) {
  checkId(seasonId);
  checkTimestamp(start);
  requirePolicy(Array.isArray(assets) && assets.length <= 1000, 'invalid_season_assets');
  const seen = new Set();
  const normalized = assets.map(asset => {
    const id = checkId(asset.id);
    requirePolicy(!seen.has(id), 'duplicate_asset');
    seen.add(id);
    return Object.freeze({ id, owner: checkId(asset.owner), level: checkLevel(asset.level),
      traits: traits(asset.traits), version: checkCounter(asset.version ?? 0),
      rerolls: checkCounter(asset.rerolls ?? 0), eligibleAt: checkTimestamp(asset.eligibleAt ?? 0),
      pending: null, expiresAt: seasonExpiry(start, asset.level) });
  });
  return Object.freeze({ seasonId, start, assets: Object.freeze(normalized), operations: Object.freeze([]) });
}

function getAsset(state, id) {
  const asset = state.assets.find(nft => nft.id === id);
  requirePolicy(asset, 'unknown_season_asset');
  return asset;
}

function replacement(state, writes, operations) {
  const changes = new Map(writes.map(nft => [nft.id, Object.freeze(nft)]));
  return Object.freeze({ ...state, assets: Object.freeze(state.assets.map(nft => changes.get(nft.id) ?? nft)),
    operations: Object.freeze(operations) });
}

function requireOwnerVersion(asset, signer, version) {
  requirePolicy(asset.owner === signer, 'wrong_owner');
  requirePolicy(asset.version === checkCounter(version), 'stale_asset_version');
  requirePolicy(asset.pending === null, 'asset_reserved');
}

export function transferSeasonAsset(state, { assetId, signer, expectedVersion, to }) {
  const asset = getAsset(state, assetId);
  requireOwnerVersion(asset, signer, expectedVersion);
  return replacement(state, [{ ...asset, owner: checkId(to), version: nextVersion(asset.version) }], state.operations);
}

/** Preparation reserves all participants or none. operationId identifies the
 * single charge/disbursement intent for any later escrow adapter. Only verified
 * chain ownership and escrow locks may justify this state in live execution.
 */
export function prepareProgression(state, request) {
  const { kind, operationId, commitment, signer, targetId, expectedTargetVersion, at } = request;
  checkId(operationId);
  checkId(commitment);
  checkId(signer);
  checkTimestamp(at);
  requirePolicy(at >= state.start, 'season_not_started');
  requirePolicy(kind === 'upgrade' || kind === 'visual', 'unknown_progression_kind');
  requirePolicy(kind === 'upgrade' || (request.materialId == null && request.expectedMaterialVersion == null),
    'unexpected_material');
  const prior = state.operations.find(op => op.operationId === operationId);
  if (prior) {
    requirePolicy(prior.commitment === commitment && prior.kind === kind && prior.signer === signer
      && prior.targetId === targetId && prior.expectedTargetVersion === expectedTargetVersion
      && prior.materialId === (request.materialId ?? null)
      && prior.expectedMaterialVersion === (request.expectedMaterialVersion ?? null), 'conflicting_operation_retry');
    return state;
  }
  requirePolicy(!state.operations.some(op => op.commitment === commitment), 'duplicate_draw_commitment');
  const target = getAsset(state, targetId);
  requireOwnerVersion(target, signer, expectedTargetVersion);
  const writes = [{ ...target, pending: operationId, version: nextVersion(target.version) }];
  let feeLamports;
  if (kind === 'upgrade') {
    requirePolicy(request.materialId !== targetId, 'identical_upgrade_assets');
    const material = getAsset(state, request.materialId);
    requireOwnerVersion(material, signer, request.expectedMaterialVersion);
    requirePolicy(material.level === target.level && target.level < 10, 'ineligible_upgrade_level');
    writes.push({ ...material, pending: operationId, version: nextVersion(material.version) });
    feeLamports = BASE_FEE * BigInt(target.level);
  } else {
    requirePolicy(at >= target.eligibleAt, 'reroll_cooldown');
    feeLamports = visualRerollQuote(target.rerolls, at).feeLamports;
  }
  const op = Object.freeze({ kind, operationId, commitment, signer, targetId, expectedTargetVersion,
    materialId: request.materialId ?? null, expectedMaterialVersion: request.expectedMaterialVersion ?? null,
    preparedAt: at, feeLamports, result: null });
  return replacement(state, writes, [...state.operations, op]);
}

function assertLock(asset, operation, expectedVersion) {
  requirePolicy(asset.pending === operation.operationId && asset.owner === operation.signer
    && asset.version === nextVersion(expectedVersion), 'operation_lock_mismatch');
}

function sameTraits(a, b) {
  return a.model === b.model && a.backdrop === b.backdrop && a.symbol === b.symbol;
}

/** Apply an adapter-verified result, atomically with the intent receipt. A provider
 * outage leaves the original operation and commitment pending. The clock starts
 * from successful fulfillment, including when a provider response was delayed.
 */
export function applyVerifiedProgressionDraw(state, evidence) {
  const { operationId, commitment, proofId, at } = evidence;
  checkId(proofId);
  checkTimestamp(at);
  const op = state.operations.find(row => row.operationId === operationId);
  requirePolicy(op && op.commitment === commitment, 'unknown_committed_operation');
  requirePolicy(at >= op.preparedAt, 'draw_before_commitment');
  const newLevel = op.kind === 'upgrade' ? drawLevel(LEVEL_QUOTAS, evidence.ticket) : null;
  const newTraits = op.kind === 'visual' ? traits(evidence.traits) : null;
  if (op.result) {
    requirePolicy(op.result.proofId === proofId && (op.kind === 'upgrade'
      ? op.result.ticket === evidence.ticket : sameTraits(op.result.traits, newTraits)), 'conflicting_draw_retry');
    return state;
  }
  requirePolicy(!state.operations.some(row => row.result?.proofId === proofId), 'duplicate_draw_proof');
  const target = getAsset(state, op.targetId);
  assertLock(target, op, op.expectedTargetVersion);
  const updatedTarget = { ...target, pending: null, version: nextVersion(target.version) };
  const writes = [updatedTarget];
  if (op.kind === 'upgrade') {
    const material = getAsset(state, op.materialId);
    assertLock(material, op, op.expectedMaterialVersion);
    updatedTarget.level = checkLevel(target.level + 1);
    updatedTarget.expiresAt = seasonExpiry(state.start, updatedTarget.level);
    writes.push({ ...material, pending: null, version: nextVersion(material.version), level: newLevel,
      expiresAt: seasonExpiry(state.start, newLevel) });
  } else {
    const quote = visualRerollQuote(target.rerolls, at);
    updatedTarget.rerolls = checkCounter(target.rerolls + 1);
    updatedTarget.eligibleAt = at + quote.cooldownMs;
    updatedTarget.traits = newTraits;
  }
  const result = Object.freeze({ proofId, fulfilledAt: at, ticket: evidence.ticket ?? null, traits: newTraits });
  const settled = Object.freeze({ ...op, result });
  return replacement(state, writes, state.operations.map(row => row === op ? settled : row));
}
