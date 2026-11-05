import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../storage/database.mjs';
import { decodePoolAccount } from './accounts.mjs';
import { quoteAmounts,quoteValuation } from './math.mjs';
import { importQuoteEvidence,quoteExactInput,quoteAvailability } from './evidence.mjs';
import { seedQuoteFixture } from './fixtures.mjs';
import { handleQuotes } from './http.mjs';

const vector=JSON.parse(readFileSync(new URL('./fixtures/sdk-vectors.json',import.meta.url)));
const pool=decodePoolAccount(vector.pool),code=expected=>error=>error.code===expected;
const at=Date.UTC(2026,10,5,12);

test('both directions match 80 pinned SDK exact-input cases including fee-side, dust and range failures',()=>{
  for(const example of vector.results){
    const input={direction:example.direction,inputUnits:example.inputUnits,slippageBps:50,pool,
      nowMs:pool.activationMs+example.elapsedSeconds*1000};
    if(example.error){assert.throws(()=>quoteAmounts(input),code(example.error));continue;}
    if(example.outputUnits==='0'){assert.throws(()=>quoteAmounts(input),e=>['dust_output','dust_input'].includes(e.code));continue;}
    const quote=quoteAmounts(input);
    assert.equal(quote.expectedOutputUnits,example.outputUnits);
    assert.equal(quote.nextSqrtPriceX64,example.nextSqrtPriceX64);
    assert.equal((BigInt(quote.inputFeeUnits)+BigInt(quote.outputFeeUnits)).toString(),example.feeUnits);
    assert.equal(example.direction==='buy-att'?quote.outputFeeUnits:quote.inputFeeUnits,'0');
    assert.ok(BigInt(quote.minimumOutputUnits)*10000n>=BigInt(quote.expectedOutputUnits)*9950n);
  }
});

test('raw account decoding, fee schedule, pool configuration and input boundaries fail closed',()=>{
  const bad=Buffer.from(vector.pool.data,'base64');bad[16]=1;
  assert.throws(()=>decodePoolAccount({...vector.pool,data:bad.toString('base64')}),code('fee_schedule'));
  const basic={direction:'buy-att',inputUnits:'1000000',slippageBps:50,pool,nowMs:pool.activationMs};
  assert.throws(()=>quoteAmounts({...basic,nowMs:pool.activationMs-1}),code('preactivation'));
  assert.throws(()=>quoteAmounts({...basic,slippageBps:501}),code('slippage_limit'));
  assert.throws(()=>quoteAmounts({...basic,inputUnits:'1.5'}),code('invalid_units'));
  assert.throws(()=>quoteAmounts({...basic,inputUnits:(1n<<64n).toString()}),code('overflow'));
  assert.throws(()=>quoteAmounts({...basic,pool:{...pool,dynamicFeeInitialized:1}}),code('unsupported_pool'));
});

test('quote captures pin source/manifest identities and expire; newer incomplete observations mask older valid data',t=>{
  const db=openDatabase();t.after(()=>db.close());
  const fixture=seedQuoteFixture(db,at);
  const request={marketId:fixture.marketId,direction:'buy-att',inputUnits:'1000000',slippageBps:50};
  const quote=quoteExactInput(db,request,at);
  assert.equal(quote.feeBps,100);assert.equal(quote.fees.side,'input');assert.equal(quote.executable,false);
  assert.equal(quote.contextSlot,fixture.slot);
  assert.equal(Date.parse(quote.expiresAt),at+15_000);
  assert.ok(BigInt(quote.effectiveBuyFdvUsdMicros)>BigInt(quote.spotFdvUsdMicros));
  assert.equal(quoteAvailability(db,fixture.marketId,at+30_000).available,false);
  assert.throws(()=>quoteExactInput(db,request,at+30_000),code('stale_quote_source'));
  assert.equal(importQuoteEvidence(db,fixture,at).replayed,true);
  const incomplete=structuredClone(fixture);incomplete.id='changed';incomplete.observedMs=at+1;incomplete.og.feed='unapproved';
  for(const key of ['pool','attMint','ogMint','attVault','ogVault','og'])incomplete[key].observedMs=at+1;
  const result=importQuoteEvidence(db,incomplete,at+1);
  assert.equal(result.status,'pending');assert.equal(result.reason,'oracle_mismatch');
  assert.throws(()=>quoteExactInput(db,request,at+2),code('evidence_pending'));
});

test('expiry includes the actual activation-second boundary and an output cannot overdraw the decoded vault',t=>{
  const db=openDatabase();t.after(()=>db.close());
  const fixture=seedQuoteFixture(db,at);
  const row=db.prepare('SELECT body FROM quote_pool_snapshots WHERE id=?').get(fixture.id);
  const data=JSON.parse(row.body);data.pool.activationMs=at-30_250;data.attVaultUnits='1';
  db.prepare('UPDATE quote_pool_snapshots SET body=? WHERE id=?').run(JSON.stringify(data),fixture.id);
  const req={marketId:fixture.marketId,direction:'buy-att',inputUnits:'1000000',slippageBps:0};
  assert.throws(()=>quoteExactInput(db,req,at),code('insufficient_vault'));
  data.attVaultUnits='800000000000000000';db.prepare('UPDATE quote_pool_snapshots SET body=? WHERE id=?').run(JSON.stringify(data),fixture.id);
  const quote=quoteExactInput(db,req,at);
  assert.equal(quote.feeBps,6000);assert.equal(Date.parse(quote.expiresAt),at+750);
  assert.equal(quote.minimumOutputUnits,quote.expectedOutputUnits);
});

test('a later timestamp cannot replace a finalized checkpoint with an older slot',t=>{
  const db=openDatabase();t.after(()=>db.close());
  const fixture=seedQuoteFixture(db,at);
  const stale=structuredClone(fixture);stale.id='rolled-back';stale.observedMs=at+1;stale.slot=1;
  for(const field of ['pool','attMint','ogMint','attVault','ogVault','og']){
    stale[field].observedMs=at+1;stale[field].slot=1;
  }
  const decision=importQuoteEvidence(db,stale,at+1);
  assert.equal(decision.status,'pending');assert.equal(decision.reason,'slot_regression');
  assert.equal(quoteAvailability(db,fixture.marketId,at+1).available,false);
  assert.throws(()=>quoteExactInput(db,{marketId:fixture.marketId,direction:'buy-att',inputUnits:'1000000',slippageBps:50},at+1),
    code('evidence_pending'));
});

test('read-only quote HTTP rejects swapped fields and missing evidence without requiring a wallet',async t=>{
  const db=openDatabase();t.after(()=>db.close());seedQuoteFixture(db,at);
  const request=(body,origin='http://localhost')=>new Request('http://localhost/api/v1/quotes',{
    method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  const input={marketId:'quote-demo',direction:'buy-att',inputUnits:'1000000',slippageBps:50};
  assert.equal((await handleQuotes(db,request(input),'peer',at)).status,200);
  assert.equal((await handleQuotes(db,request({...input,inputUnits:1000000}),'peer',at)).status,400);
  assert.equal((await handleQuotes(db,request({...input,wallet:'ignored'}),'peer',at)).status,400);
  assert.equal((await handleQuotes(db,request(input,'https://elsewhere.example'),'peer',at)).status,403);
  assert.equal((await handleQuotes(db,request({...input,marketId:'missing'}),'peer',at)).status,503);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tx_intents').get().n,0);
});
