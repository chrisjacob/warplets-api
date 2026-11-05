import { encode58, decode58 } from '../server/base58.mjs';
import { transaction } from '../storage/database.mjs';
import { importMarket } from '../markets/catalog.mjs';
import { recordVaultManifest } from '../vault/ledger.mjs';
import { seedFarm, observeFarm } from '../stake/farms.mjs';
import { seedBallot } from '../governance/ballots.mjs';
import { addCampaign, recordStakeRead } from '../earn/workflow.mjs';
import { LEVEL_QUOTAS } from '../domain/collections/policy.mjs';
import { NOTICE_MS } from '../domain/collections/ballot.mjs';
import { createCollection, publishCollectionStage, reserveMint, inspectOperation,
  fulfillMint, observeCollectionAsset } from '../collect/store.mjs';

export const DEFAULT_DEMO_OWNER = encode58(Buffer.alloc(32, 9));
const DAY = 86_400_000;
const key = n => encode58(Buffer.alloc(32, n));

/** Synthetic, in-memory fixtures only. No key generation, signer, RPC or transport.
 * Seed a NEW database once. Draw tickets are deliberate local examples, not proof
 * of real payment, ownership, finality, randomness or protocol participation.
 */
export function seedDemo(db, { wallet = DEFAULT_DEMO_OWNER, now = Date.now() } = {}) {
  decode58(wallet, 32);
  if (!Number.isSafeInteger(now) || now < 5 * DAY) throw Error('Invalid demo clock.');
  const start = Math.floor(now / 1000) * 1000 - 3 * DAY;
  const marketId = 'demo-att', genesisId = 'demo-genesis', seasonId = 'demo-season';
  return transaction(db, () => {
    if (db.prepare('SELECT COUNT(*) AS n FROM market_fixtures').get().n
      || db.prepare('SELECT COUNT(*) AS n FROM collect_inventories').get().n) {
      throw Error('Demo data requires a new empty database.');
    }
    createCollection(db, { id: genesisId, kind: 'genesis', tranche: 1 });
    createCollection(db, { id: seasonId, kind: 'season', seasonStart: start });
    function stage(inventoryId, id, opensAt, closesAt, walletLimit = 1) {
      publishCollectionStage(db, { inventoryId, stage: { id, type: 'whitelist',
        publishedAt: start - NOTICE_MS, opensAt, closesAt, allocation: 1000,
        priceLamports: '100000000', costLamports: '5000', wallets: [wallet], walletLimit } }, now);
    }
    function mint(inventoryId, stageId, assetId, at) {
      const { operation } = reserveMint(db, { inventoryId, stageId, wallet,
        requestKey: 'seed-' + assetId, now: at });
      fulfillMint(db, { operationId: operation.id, assetId,
        commitment: inspectOperation(db, operation.id).commitment,
        proofId: 'synthetic-' + assetId, finalized: true, at: at + 1000, ticket: 0,
        traits: { model: 'Demo Ink', backdrop: 'Synthetic Studio', symbol: 'Star' } });
      observeCollectionAsset(db, { sourceId: 'synthetic-reveal-' + assetId,
        kind: 'reveal', assetId, at: at + 2000, finalized: true });
    }
    stage(genesisId, 'demo-early', start, start + DAY);
    mint(genesisId, 'demo-early', 'demo-genesis-1', start + 3000);
    stage(genesisId, 'demo-priority', start + DAY, now + 7 * DAY);
    stage(seasonId, 'demo-early', start, start + DAY, 2);
    mint(seasonId, 'demo-early', 'demo-season-1', start + 3000);
    mint(seasonId, 'demo-early', 'demo-season-2', start + 6000);
    stage(seasonId, 'demo-priority', start + DAY, now + 7 * DAY);

    const activationMs = start + 10_000;
    const activatedAt = new Date(activationMs).toISOString();
    importMarket(db, { id: marketId, symbol: 'DEMOATT', ogSymbol: 'DEMOOG',
      attMint: key(1), ogMint: key(2), poolAddress: key(3), activatedAt });
    const originalUnits = '402600000';
    recordVaultManifest(db, { marketId, originalUnits, seasons: [{ id: seasonId,
      startsAt: new Date(start).toISOString(), levels: LEVEL_QUOTAS.flatMap((count, i) => Array(count).fill(i + 1)) }] });
    seedFarm(db, { marketId, originalUnits, treasuryFeeBps: 0 });
    observeFarm(db, { id: 'demo-deposit', marketId, kind: 'deposit', at: activatedAt,
      wallet, amount: '1234000000' }, now);
    addCampaign(db, { tokenId: marketId, activationMs, originalUnits });
    recordStakeRead(db, { wallet, tokenId: marketId, observedMs: now,
      expiresMs: now + 300_000, microUsd: '10000000', sourceRef: 'synthetic-demo-stake' });
    seedBallot(db, { id: 'demo-next-tranche', opensAt: now - 60_000,
      currentTrancheOpenedAt: start, holders: [wallet], nextWhitelist: [] });
    return Object.freeze({ source: 'local-fixture', wallet, marketId, genesisId, seasonId,
      ballotId: 'demo-next-tranche', seededAt: new Date(now).toISOString(),
      stakeEligibilityExpiresAt: new Date(now + 300_000).toISOString() });
  });
}
