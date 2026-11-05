import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS, GENESIS_STAGE_ONE_PRICE, LEVEL_QUOTAS, drawLevel, seasonActiveWeight,
  seasonExpiry, snapshotSeasonFreeWallets,
} from './policy.mjs';
import { castVote, earliestTrancheOpening, openBallot, tallyBallot } from './ballot.mjs';
import {
  admitMint, applyVerifiedMintDraw, createInventory, freezeFreeStage, inventoryCounts,
  publishStage,
} from './inventory.mjs';

const opensAt = 2 * DAY_MS;
const genesis = () => createInventory({ id: 'genesis-1', kind: 'genesis', tranche: 1 });
const whitelist = (id, overrides = {}) => ({ id, type: 'whitelist', publishedAt: 0, opensAt,
  closesAt: opensAt + DAY_MS, priceLamports: GENESIS_STAGE_ONE_PRICE, allocation: 1_000,
  wallets: ['alice','bob'], walletLimit: 1, ...overrides });
const mint = (wallet, stageId, overrides = {}) => ({ wallet, stageId, at: opensAt, costLamports: 7n,
  operationId: 'op-' + wallet + '-' + stageId, drawCommitment: 'draw-' + wallet + '-' + stageId, ...overrides });
const code = code => error => error.code === code;

test('one canonical vote per wallet at the opening snapshot, even with overlapping eligibility', () => {
  const holders = ['alice', 'alice'], list = ['alice','bob'];
  let b = openBallot({ id: 'b', opensAt, currentTrancheOpenedAt: 0, holders, nextWhitelist: list });
  list.push('late-wallet');
  assert.deepEqual(b.voters, ['alice','bob']);
  const vote = { wallet: 'alice', at: opensAt, choice: 'ASAP' };
  b = castVote(b, vote);
  assert.throws(() => castVote(b, vote), code('wallet_already_voted'));
  assert.throws(() => castVote(b, { ...vote, wallet: 'late-wallet' }), code('voter_ineligible'));
  assert.throws(() => tallyBallot(b, b.closesAt - 1), code('ballot_still_open'));
  assert.throws(() => castVote(b, { ...vote, wallet: 'bob', at: b.closesAt }), code('ballot_closed'));
  assert.deepEqual(tallyBallot(b, b.closesAt), { eligibleWallets: 2, votesCast: 1,
    counts: { ASAP: 1, 7: 0, 14: 0, 30: 0 } });
});

test('no turnout; advisory founder choice, concurrent notice and 7/14/30 from tranche opening', () => {
  const ballot = openBallot({ id: 'b', opensAt, currentTrancheOpenedAt: 0, holders: [], nextWhitelist: [] });
  assert.equal(tallyBallot(ballot, ballot.closesAt).votesCast, 0);
  const base = { ballot, noticeAt: opensAt, decidedAt: ballot.closesAt };
  assert.equal(earliestTrancheOpening({ ...base, founderChoice: 'ASAP' }), 4 * DAY_MS);
  for (const days of [7, 14, 30]) assert.equal(
    earliestTrancheOpening({ ...base, founderChoice: String(days) }), days * DAY_MS);
  assert.equal(earliestTrancheOpening({ ...base, noticeAt: 7 * DAY_MS, founderChoice: '7' }), 9 * DAY_MS);
});

test('original inventory has exactly 1000 slots, 2013 weight, all draw boundaries and ten tranches', () => {
  const hist = Array(10).fill(0);
  for (let i=0;i<1000;i++) hist[drawLevel(LEVEL_QUOTAS, i)-1]++;
  assert.deepEqual(hist, [...LEVEL_QUOTAS]);
  assert.equal(hist.reduce((w,count,i) => w + count*(i+1), 0), 2013);
  assert.throws(() => drawLevel(LEVEL_QUOTAS, 1000), code('invalid_draw_ticket'));
  assert.throws(() => createInventory({ id: '11', kind: 'genesis', tranche: 11 }), code('invalid_genesis_tranche'));
});

test('Genesis notices and per-stage pricing, deduplicated wallet eligibility, shared inventory', () => {
  let stock = genesis();
  assert.throws(() => publishStage(stock, whitelist('first',{ opensAt: opensAt-1 })),code('insufficient_genesis_notice'));
  assert.throws(() => publishStage(stock, whitelist('first',{ priceLamports: 1n })),code('initial_genesis_price'));
  assert.throws(() => publishStage(stock, whitelist('public',{ type:'public' })),code('public_stage_requires_approval'));
  stock = publishStage(stock, whitelist('discount',{ wallets:['alice','alice'], allocation:1 }));
  stock = publishStage(stock, whitelist('second',{ priceLamports: 150_000_000n, opensAt: opensAt + DAY_MS,
    closesAt: opensAt + 2 * DAY_MS }));
  const first = mint('alice','discount');
  stock = admitMint(stock, first);
  assert.strictEqual(admitMint(stock, first), stock);
  assert.throws(() => admitMint(stock, { ...first, drawCommitment: 'a' }), code('conflicting_mint_retry'));
  assert.throws(() => admitMint(stock, { ...first, operationId: 'b', drawCommitment: 'b' }), code('stage_wallet_limit'));
  stock = admitMint(stock, mint('alice','second',{at:opensAt+DAY_MS}));
  assert.equal(inventoryCounts(stock).pending, 2);
  assert.equal(inventoryCounts(stock).unsold, 998);
});

test('committed draws settle once in admission order, consume fixed quotas, retries never redraw', () => {
  let stock = publishStage(genesis(), whitelist('a'));
  stock = admitMint(stock, mint('alice','a'));
  stock = admitMint(stock, mint('bob','a'));
  const first = { ...mint('alice','a'), proofId:'p1', ticket:999 };
  const second = { ...mint('bob','a'), proofId:'p2', ticket:998 };
  assert.throws(() => applyVerifiedMintDraw(stock,second), code('draw_out_of_order'));
  const after = applyVerifiedMintDraw(stock,first);
  assert.strictEqual(applyVerifiedMintDraw(after,first), after);
  assert.throws(() => applyVerifiedMintDraw(after, {...first, ticket:0}),code('conflicting_draw_retry'));
  assert.throws(() => applyVerifiedMintDraw(after, {...second, proofId:'p1'}),code('duplicate_draw_proof'));
  const final = applyVerifiedMintDraw(after,second);
  assert.deepEqual(final.admissions.map(x=>x.level),[10,9]);
  assert.deepEqual(final.remaining.slice(-2), [1,0]);
  assert.equal(stock.fulfilled,0);
  assert.equal(inventoryCounts(final).unmintedReserve,998);
});

test('wallet cap does not allow the 1001st admission even across different stages', () => {
  let stock=publishStage(genesis(),whitelist('public',{ type:'public', founderApproved:true }));
  stock=publishStage(stock,whitelist('later',{ type:'public', founderApproved:true }));
  for(let i=0;i<1000;i++) stock=admitMint(stock,mint('wallet'+i,'public'));
  assert.equal(inventoryCounts(stock).unsold,0);
  assert.throws(()=>admitMint(stock,mint('last','later')),code('sold_out'));
});

test('Season month-end, leap years, timestamp precision, expiry and reserved weight', () => {
  for (const [year,last] of [[2024,29],[2025,28]]) {
    const start=Date.UTC(year,0,31,23,11,32,921);
    const expiry=Date.UTC(year,1,last,23,11,32,921);
    assert.equal(seasonExpiry(start,1), expiry);
    assert.equal(seasonExpiry(start,2), Date.UTC(year,2,31,23,11,32,921));
    assert.equal(seasonActiveWeight(start,1,expiry-1),1);
    assert.equal(seasonActiveWeight(start,1,expiry),0);
    assert.equal(seasonActiveWeight(start,1,start-1),0);
    assert.equal(LEVEL_QUOTAS.reduce((sum,n,i)=>sum+n*seasonActiveWeight(start,i+1,expiry),0),1524);
  }
});

test('free Season snapshot uses only revealed Genesis 1X owner at the cutoff and freezes eligibility', () => {
  let stock=createInventory({ id:'season',kind:'season' });
  stock=publishStage(stock,whitelist('priority',{opensAt:0,closesAt:DAY_MS}));
  stock=publishStage(stock,whitelist('expanded',{opensAt:DAY_MS,closesAt:opensAt}));
  stock=publishStage(stock,whitelist('free',{type:'free',priceLamports:0n}));
  const hold=(id,owner,collection,level,revealedAt)=>({id,owner,collection,level,revealedAt});
  const holds=[hold('a','alice','solana-genesis',1,opensAt-1),hold('b','alice','solana-genesis',1,opensAt-1),
    hold('c','bob','solana-genesis',1,opensAt+1),hold('d','bob','season',1,opensAt-2),
    hold('e','eve','solana-genesis',null,null),hold('f','fran','solana-genesis',2,opensAt-1)];
  const snap=snapshotSeasonFreeWallets({at:opensAt,holdings:holds});
  assert.deepEqual(snap.wallets,['alice']);
  stock=freezeFreeStage(stock,'free',snap);
  holds[0].owner='buyer';
  assert.throws(()=>admitMint(stock,mint('buyer','free')),code('wallet_ineligible'));
  stock=admitMint(stock,mint('alice','free'));
  assert.throws(()=>admitMint(stock,mint('alice','free',{operationId:'another',drawCommitment:'x'})),
    code('stage_wallet_limit'));
  assert.throws(()=>freezeFreeStage(stock,'free',snap),code('free_stage_unavailable'));
});
