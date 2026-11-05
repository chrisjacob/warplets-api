import assert from 'node:assert/strict';
import test from 'node:test';
import { allocationWindow, advanceStreak, applyPurchaseActivity, claimableUnits, DAY_MS,
  distributeBudget, enrollPosition, MIN_STAKE_MICRO_USD, multiplierTenths, onboardingTenths,
  rankBoard, settleAllocation, snapshotPurchasePosition } from './index.mjs';

const components = { actionTenths: 0, streakDays: 0, highestEligibleLevel: 0, purchaseTokenDays: 0 };
const epoch = 20_000;
const start = epoch * DAY_MS;
const cutoff = start + DAY_MS - 1;
const campaigns = ['A','B'].map(tokenId => ({ tokenId, activationMs: start - 4 * DAY_MS }));
const participant = (userId, override = {}) => ({ userId, wallet: `wallet-${userId}`, components, ...override });
function submission(userId, tokenId, contentScore, offset = 1000) {
  const submittedAtMs = start + offset;
  const atSubmission = { status: 'verified', userId, tokenId, asOfMs: submittedAtMs, microUsd: MIN_STAKE_MICRO_USD };
  return { userId, tokenId, contentScore, submittedAtMs, submissionId: `${tokenId}-${userId}`,
    atSubmission, atSnapshot: { ...atSubmission, asOfMs: cutoff } };
}
function boardInput(participants, submissions) {
  return { epoch, complete: true, participants, submissions, campaigns };
}

test('picks one eligible post per user globally with deterministic tie-breaking', () => {
  const ineligible = submission('alice','A',10);
  ineligible.atSnapshot.microUsd -= 1n;
  const posts = [ineligible, submission('alice','B',5), submission('bob','A',5,999)];
  const participants = [participant('alice'),participant('bob')];
  const normal = rankBoard(boardInput(participants, posts));
  assert.equal(normal.status, 'final');
  assert.deepEqual(normal.winners.map(w => w.submissionId), ['A-bob','B-alice']);
  assert.deepEqual(rankBoard(boardInput(participants, posts.toReversed())), normal);
  const sameScore = submission('alice','A',5);
  assert.equal(rankBoard(boardInput(participants, [posts[1],sameScore])).winners[0].submissionId, 'A-alice');
});

test('both thresholds apply to their own token and checkpoint', () => {
  for (const side of ['atSubmission','atSnapshot']) {
    const post = submission('alice','A',9);
    post[side].microUsd -= 1n;
    assert.equal(rankBoard(boardInput([participant('alice')],[post])).winners.length, 0);
    post[side].status = 'stale';
    assert.equal(rankBoard(boardInput([participant('alice')],[post])).status, 'pending');
    post[side].status = 'verified';
    post[side].tokenId = 'B';
    assert.throws(() => rankBoard(boardInput([participant('alice')],[post])), /another position/);
  }
});

test('a duplicate submission or shared wallet cannot collect two rewards', () => {
  const first = submission('alice','A',9);
  assert.throws(() => rankBoard(boardInput([participant('alice')], [first, { ...first, submissionId: 'other' }])), /one submission/);
  const inputs = boardInput([participant('alice'),participant('bob',{wallet: 'wallet-alice'})],
    [first,submission('bob','A',7)]);
  assert.equal(rankBoard(inputs).reason, 'wallet-conflict');
});

test('global Top 100 includes only the best 100 even across different ATTs', () => {
  const users = Array.from({ length: 120 }, (_, i) => participant(String(i)));
  const posts = users.map(({ userId }, i) => submission(userId, i % 2 === 0 ? 'A' : 'B', (i%10)+1, i));
  const result = rankBoard(boardInput(users, posts));
  assert.equal(result.winners.length, 100);
  assert.equal(result.winners[0].contentScore, 10);
  assert.equal(result.winners.at(-1).contentScore, 2);
});

test('max and floor multiplier use tenths with no automatic base', () => {
  assert.equal(multiplierTenths(components), 1);
  assert.equal(multiplierTenths({ actionTenths:10, streakDays:10, highestEligibleLevel:10, purchaseTokenDays:99 }), 100);
  const post = submission('alice','A',10);
  assert.equal(rankBoard(boardInput([participant('alice')],[post])).winners[0].pointsTenths,10);
});

test('actions are active at the snapshot and cannot be credited twice', () => {
  const intervals = Array.from({ length:11 }, (_, i) => ({ actionId:String(i), startEpoch:1, endEpoch:i < 2 ? 3 : null }));
  const proofs = intervals.map(i => ({ actionId:i.actionId, verifiedAtMs:DAY_MS })).concat({ actionId:'0', verifiedAtMs:DAY_MS });
  assert.equal(onboardingTenths(2,intervals,proofs),10);
  assert.equal(onboardingTenths(3,intervals,proofs),9);
  intervals.push({actionId:'0',startEpoch:4});
  assert.equal(onboardingTenths(4,intervals,proofs),10);
});

test('rolling streak detects 24-hour gaps across adjacent nonempty boards', () => {
  const first = advanceStreak({ epoch, approvalsMs:[start,start+1_000] });
  const second = advanceStreak({ epoch:epoch+1, previous:first, approvalsMs:[start+DAY_MS] });
  assert.equal(second.days,2);
  for (const gap of [DAY_MS,DAY_MS+1]) {
    const restart = advanceStreak({ epoch:epoch+2, previous:second, approvalsMs:[second.lastApprovalMs+gap] });
    assert.equal(restart.days,1);
  }
  assert.equal(advanceStreak({ epoch:epoch+2, previous:second, approvalsMs:[] }).days,0);
});

const winner = (wallet, pointsTenths) => ({ wallet, pointsTenths });
test('water-filling redistributes a dominant winner and conserves integer dust', () => {
  const ranked = [winner('large',100), ...Array.from({length:19},(_,i)=>winner(String(i),1))];
  const result = distributeBudget(10_000n,ranked);
  assert.equal(result.awards[0].amountUnits,1_000n);
  assert.ok(result.awards.slice(1).every(x=>x.amountUnits===473n));
  assert.equal(result.burnUnits,13n);
});

test('all board sizes conserve supply, enforce the wallet cap and give ties the same payout', () => {
  for (let n=0; n<=100; n++) {
    const ranked = Array.from({length:n},(_,i)=>winner(String(i),i%6===0 ? 1000 : (i%4)+1));
    for (const budget of [0n,9n,99n,10_003n,10n**25n+7n]) {
      const plan = distributeBudget(budget,ranked);
      const paid = plan.awards.reduce((sum,a)=>sum+a.amountUnits,0n);
      assert.equal(paid+plan.burnUnits,budget);
      assert.ok(plan.burnUnits>=0n);
      const tieAward = new Map();
      for (let i=0; i<n; i++) {
        const amount = plan.awards[i].amountUnits;
        assert.ok(amount<=budget/10n);
        if (n<=10) assert.equal(amount,budget/10n);
        if (tieAward.has(ranked[i].pointsTenths)) assert.equal(amount,tieAward.get(ranked[i].pointsTenths));
        tieAward.set(ranked[i].pointsTenths,amount);
      }
    }
  }
});

test('bootstrap burns only day-one budget, missing evidence or wrong board cannot burn', () => {
  const activationMs = start + DAY_MS + 6000;
  const params = { tokenId:'A',originalSupplyUnits:1_000_000n,activationMs,day:1,nowMs:activationMs };
  const snapshot = boardInput([],[]);
  assert.equal(settleAllocation({...params,board:rankBoard(snapshot)}).burnUnits,10_000n);
  const unresolved = rankBoard(boardInput([participant('alice')],[submission('alice','A',null)]));
  for (const board of [unresolved, rankBoard({...snapshot,complete:false}),undefined]) {
    const pending = settleAllocation({...params,board});
    assert.equal(pending.status,'pending');
    assert.ok(!Object.hasOwn(pending,'burnUnits'));
  }
  assert.throws(()=>settleAllocation({...params,board:{epoch:epoch-1,status:'final',winners:[]}}), /wrong global board/);
});

test('same global winners share each contributing token; actual activation controls vesting', () => {
  const ranked = rankBoard(boardInput([participant('alice')],[submission('alice','A',10)]));
  const activationMs = start + DAY_MS + 3600000;
  for (const [tokenId,offset] of [['A',0],['B',35*60000]]) {
    const t = activationMs + offset;
    const plan = settleAllocation({tokenId,originalSupplyUnits:10_000n,activationMs:t,day:1,nowMs:t,board:ranked});
    assert.deepEqual(plan.awards,[{wallet:'wallet-alice',amountUnits:10n}]);
    assert.equal(plan.boardEpoch,epoch);
    assert.equal(plan.vestsFromMs,t+DAY_MS);
    const claim = (time, claimedUnits=0n) => claimableUnits({awardedUnits:10n,claimedUnits,window:plan,nowMs:time});
    assert.equal(claim(t+DAY_MS),0n);
    assert.equal(claim(t+1.5*DAY_MS),5n);
    assert.equal(claim(t+730*DAY_MS,5n),5n);
    assert.throws(()=>claim(t,1n),/claimed balance/);
    assert.equal(allocationWindow(t,10).vestsThroughMs,t+11*DAY_MS);
  }
});

const activity = (sequence,type,details={}) => ({wallet:'alice',tokenId:'A',sequence,type,confirmed:true,...details});
const purchase = (sequence,qty) => activity(sequence,'verified-buy-and-stake',{netBoughtUnits:qty,depositedUnits:qty});
const price = {active:true,stakedUnits:10n,priceNumerator:1_000_000n,priceDenominator:1n};
test('purchase journal credits only verified same-transaction purchase and stake', () => {
  let position=enrollPosition('alice','A');
  const buy = {...purchase(1,20n),depositedUnits:12n};
  position=applyPurchaseActivity(position,buy);
  assert.equal(position.creditedUnits,12n);
  assert.strictEqual(applyPurchaseActivity(position,buy),position);
  for (const type of ['deposit','reward','restake']) position=applyPurchaseActivity(position,activity(position.sequence+1,type));
  assert.equal(position.creditedUnits,12n);
  assert.throws(()=>applyPurchaseActivity(position,purchase(position.sequence+2,30n)),/missing/);
  assert.throws(()=>applyPurchaseActivity(position,{...purchase(position.sequence+1,1n),tokenId:'B'}),/another position/);
});

test('purchase flags suspend below threshold, expire after ten boards and clear on full exit', () => {
  let position=applyPurchaseActivity(enrollPosition('alice','A'),purchase(1,12n));
  for(let day=1;day<=11;day++) {
    const result=snapshotPurchasePosition(position,{...price,epoch:day,reconciledSequence:1});
    assert.equal(result.tokenDays,Math.min(day,10));
    position=result.position;
  }
  assert.deepEqual(position.flags,[2,3,4,5,6,7,8,9,10,11]);
  assert.equal(snapshotPurchasePosition(position,{...price,epoch:12,reconciledSequence:0}).status,'pending');
  const dip=snapshotPurchasePosition(position,{...price,epoch:12,reconciledSequence:1,priceNumerator:999_999n});
  assert.equal(dip.tokenDays,0);
  assert.equal(snapshotPurchasePosition(dip.position,{...price,epoch:13,reconciledSequence:1}).tokenDays,9);
  const ended=snapshotPurchasePosition(position,{epoch:12,active:false});
  assert.deepEqual(ended.position.flags,[]);
  position=applyPurchaseActivity(position,activity(2,'withdrawal',{withdrawnUnits:3n,remainingStakeUnits:20n}));
  assert.equal(position.creditedUnits,9n);
  position=applyPurchaseActivity(position,activity(3,'withdrawal',{withdrawnUnits:20n,remainingStakeUnits:0n}));
  position=applyPurchaseActivity(position,activity(4,'deposit'));
  assert.deepEqual(position.flags,[]);
  assert.equal(position.creditedUnits,0n);
});
