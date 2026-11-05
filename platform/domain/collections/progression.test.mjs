import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUR_MS, seasonExpiry } from './policy.mjs';
import { applyVerifiedProgressionDraw, prepareProgression, progressionState, transferSeasonAsset,
  visualRerollQuote } from './progression.mjs';

const start = Date.UTC(2024,0,31,18);
const visual = Object.freeze({ model: 'm', backdrop: 'b', symbol: 's' });
const asset = (id, level = 1, owner = 'alice') => ({ id, level, owner, traits: visual });
const stateOf = (assets = [asset('a'),asset('b')]) => progressionState({ seasonId:'s',start,assets });
const upgrade = (changes = {}) => ({ kind:'upgrade',operationId:'o',commitment:'c',signer:'alice',
  targetId:'a',expectedTargetVersion:0,materialId:'b',expectedMaterialVersion:0,at:start,...changes });
const reroll = (changes = {}) => ({ kind:'visual',operationId:'r',commitment:'v',signer:'alice',
  targetId:'a',expectedTargetVersion:0,at:start,...changes });
const code = code => err => err.code === code;

test('upgrade validates the full pair before reserving either asset', () => {
  for (const [s, req, error] of [
    [stateOf(),upgrade({materialId:'a'}),'identical_upgrade_assets'],
    [stateOf(),upgrade({materialId:'another-season-id'}),'unknown_season_asset'],
    [stateOf([asset('a'),asset('b',1,'bob')]),upgrade(),'wrong_owner'],
    [stateOf([asset('a'),asset('b',2)]),upgrade(),'ineligible_upgrade_level'],
    [stateOf([asset('a',10),asset('b',10)]),upgrade(),'ineligible_upgrade_level'],
    [stateOf(),upgrade({expectedMaterialVersion:1}),'stale_asset_version'],
  ]) {
    assert.throws(()=>prepareProgression(s,req),code(error));
    assert.equal(s.operations.length,0);
    assert.ok(s.assets.every(nft=>nft.pending===null && nft.version===0));
  }
});

test('two-asset intent reserves both versions, retries once, survives delayed evidence, reactivates target', () => {
  const before = stateOf();
  const at = Date.UTC(2024,2,1);
  const req = upgrade({at});
  const prepared = prepareProgression(before,req);
  assert.strictEqual(prepareProgression(prepared,req),prepared);
  assert.equal(prepared.operations[0].feeLamports,10_000_000n);
  assert.ok(prepared.assets.every(a=>a.pending==='o'));
  assert.throws(()=>prepareProgression(prepared,reroll({expectedTargetVersion:1})),code('asset_reserved'));
  assert.throws(()=>transferSeasonAsset(prepared,{assetId:'b',signer:'alice',expectedVersion:1,to:'bob'}),code('asset_reserved'));
  assert.throws(()=>applyVerifiedProgressionDraw(prepared,{operationId:'o',commitment:'other',proofId:'p',at,ticket:999}),
    code('unknown_committed_operation'));
  const ev = { operationId:'o',commitment:'c',proofId:'p',at:at+250,ticket:999 };
  const after = applyVerifiedProgressionDraw(prepared,ev);
  assert.deepEqual(after.assets.map(a=>[a.level,a.expiresAt]),[[2,seasonExpiry(start,2)],[10,seasonExpiry(start,10)]]);
  assert.deepEqual(after.assets.map(a=>a.traits),[visual,visual]);
  assert.ok(after.assets.every(a=>a.pending===null && a.version===2));
  assert.deepEqual(before.assets.map(a=>a.level),[1,1]);
  assert.strictEqual(applyVerifiedProgressionDraw(after,ev),after);
  assert.throws(()=>applyVerifiedProgressionDraw(after,{...ev,ticket:998}),code('conflicting_draw_retry'));
  assert.strictEqual(prepareProgression(after,req),after);
});

test('material downgrade can shorten eligibility without changing prior state or identity', () => {
  const before = stateOf([asset('a',9),asset('b',9)]);
  const prepared=prepareProgression(before,upgrade());
  assert.equal(prepared.operations[0].feeLamports,90_000_000n);
  const after=applyVerifiedProgressionDraw(prepared,{operationId:'o',commitment:'c',proofId:'p',at:start,ticket:0});
  assert.deepEqual(after.assets.map(a=>[a.id,a.level]),[['a',10],['b',1]]);
  assert.deepEqual(before.assets.map(a=>a.level),[9,9]);
});

test('visual price, fulfillment-time cooldown and counter survive transfer and retries', () => {
  const initial=stateOf();
  const prepared=prepareProgression(initial,reroll());
  const t=start+41*HOUR_MS;
  const newTraits={model:'x',backdrop:'y',symbol:'z'};
  const result={operationId:'r',commitment:'v',proofId:'p',at:t,traits:newTraits};
  const done=applyVerifiedProgressionDraw(prepared,result);
  const current=done.assets[0];
  assert.equal(current.level,1);
  assert.deepEqual(current.traits,newTraits);
  assert.equal(current.rerolls,1);
  assert.equal(current.eligibleAt,t+HOUR_MS);
  assert.strictEqual(applyVerifiedProgressionDraw(done,{...result,at:t+1000}),done);
  assert.throws(()=>applyVerifiedProgressionDraw(done,{...result,traits:visual}),code('conflicting_draw_retry'));
  const moved=transferSeasonAsset(done,{assetId:'a',signer:'alice',to:'bob',expectedVersion:2});
  const next=reroll({signer:'bob',expectedTargetVersion:3,operationId:'r2',commitment:'v2',at:t+HOUR_MS});
  assert.throws(()=>prepareProgression(moved,{...next,at:next.at-1}),code('reroll_cooldown'));
  const second=prepareProgression(moved,next);
  assert.equal(second.operations[1].feeLamports,20_000_000n);
  assert.equal(moved.assets[0].eligibleAt,current.eligibleAt);
  const final=applyVerifiedProgressionDraw(second,{operationId:'r2',commitment:'v2',proofId:'p2',at:next.at,traits:visual});
  assert.equal(final.assets[0].eligibleAt,next.at+2*HOUR_MS);
});

test('visual quote rejects unrepresentable cost/timestamp without truncation or enormous allocation', () => {
  for (const [r, fee, cooldown] of [[0,10_000_000n,1],[3,80_000_000n,8],[7,1_280_000_000n,128]]) {
    assert.deepEqual(visualRerollQuote(r,start),{ feeLamports:fee,cooldownMs:cooldown*HOUR_MS });
  }
  assert.throws(()=>visualRerollQuote(Number.MAX_SAFE_INTEGER,start),code('reroll_quote_unrepresentable'));
  assert.throws(()=>visualRerollQuote(0,8_640_000_000_000_000),code('reroll_quote_unrepresentable'));
});
