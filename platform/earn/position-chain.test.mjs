import test from 'node:test';
import assert from 'node:assert/strict';
import {DAY_MS} from '../domain/earn/index.mjs';
import {verifyPositionChain} from './position-chain.mjs';
const at=epoch=>(epoch+1)*DAY_MS-1;
const event=(sequence,type,atMs,extra={})=>({type,signature:'tx'+sequence,instructionIndex:2,wallet:'alice',tokenId:'ATT',sequence,atMs,confirmed:true,...extra});
const buy=(sequence,atMs,amount='10')=>event(sequence,'verified-buy-and-stake',atMs,{swapIndex:1,netBoughtUnits:amount,depositedUnits:amount});
function fixture(){return {wallet:'alice',tokenId:'ATT',enrolledMs:100,activationMs:100,throughEpoch:2,events:[buy(1,200)],
 checkpoints:[0,1,2].map(epoch=>({epoch,sequence:1,credited:'10',stake:'10',numerator:'1000000',denominator:'1',flags:Array.from({length:epoch+1},(_,i)=>i),
  tokenDays:epoch+1,sourceRef:'synthetic-history / price-'+epoch})),
 valuations:[0,1,2].map(epoch=>({epoch,asOfMs:at(epoch),status:'verified',microUsd:'10000000',stakedUnits:'10',priceNumerator:'1000000',priceDenominator:'1',
  expiresMs:at(epoch)+1000,receipt:'price-'+epoch,readId:'read-'+epoch}))};}
const reasons=result=>result.dependencies.map(d=>[d.epoch,d.reason]);
test('chronological chain matches fixed checkpoints, preserves inputs and returns independent normalized values',()=>{
 const input=fixture(),before=structuredClone(input),result=verifyPositionChain(input);
 assert.equal(result.status,'ready');assert.equal(result.tokenDays,3);assert.deepEqual(result.position.flags,[0,1,2]);
 assert.equal(result.position.creditedUnits,'10');assert.deepEqual(result.chain,input.checkpoints);assert.deepEqual(input,before);
 result.chain[0].flags.push(99);result.position.flags.push(99);assert.deepEqual(input,before);
 assert.deepEqual(verifyPositionChain(input),verifyPositionChain(structuredClone(input)));
});
test('full external withdrawal and repurchase resets day flags even when terminal sequence and credit match benign activity',()=>{
 const reset=fixture();reset.events.push(event(2,'withdrawal',DAY_MS+100,{withdrawnUnits:'10',remainingStakeUnits:'0'}),buy(3,DAY_MS+200));
 for(const c of reset.checkpoints.slice(1)){c.sequence=3;c.flags=c.flags.slice(1);c.tokenDays--;}
 const good=verifyPositionChain(reset);assert.equal(good.status,'ready');assert.deepEqual(good.position.flags,[1,2]);
 const retained=fixture();retained.events.push(event(2,'deposit',DAY_MS+100),event(3,'reward',DAY_MS+200));
 for(const c of retained.checkpoints.slice(1))c.sequence=3;
 const benign=verifyPositionChain(retained);assert.equal(benign.status,'ready');assert.equal(benign.position.sequence,good.position.sequence);
 assert.equal(benign.position.creditedUnits,good.position.creditedUnits);assert.deepEqual(benign.position.flags,[0,1,2]);
 reset.checkpoints=retained.checkpoints;
 assert.deepEqual(reasons(verifyPositionChain(reset)),[[1,'position-checkpoint-flags'],[1,'position-checkpoint-tokenDays'],[2,'position-checkpoint-flags'],[2,'position-checkpoint-tokenDays']]);
});
test('partial withdrawal preserves past flags and a temporary price dip suspends rather than invents token days',()=>{
 const partial=fixture();partial.events=[buy(1,200,'12'),event(2,'withdrawal',DAY_MS+100,{withdrawnUnits:'1',remainingStakeUnits:'11'})];
 for(let i=0;i<3;i++){
  partial.checkpoints[i].sequence=i?2:1;partial.checkpoints[i].credited=i?'11':'12';partial.checkpoints[i].stake=i?'11':'12';
  partial.valuations[i].stakedUnits=i?'11':'12';partial.valuations[i].microUsd=i?'11000000':'12000000';
 }
 const result=verifyPositionChain(partial);assert.equal(result.status,'ready');assert.deepEqual(result.position.flags,[0,1,2]);assert.equal(result.position.creditedUnits,'11');
 const dip=fixture();dip.valuations[1].priceNumerator='999999';dip.valuations[1].microUsd='9999990';
 dip.checkpoints[1].numerator='999999';dip.checkpoints[1].flags=[0];dip.checkpoints[1].tokenDays=0;
 dip.checkpoints[2].flags=[0,2];dip.checkpoints[2].tokenDays=2;
 assert.equal(verifyPositionChain(dip).status,'ready');assert.equal(verifyPositionChain(dip).tokenDays,2);
});
test('missing middle checkpoints and prices identify only their exact daily dependencies',()=>{
 for(const [field,reason] of [['checkpoints','position-checkpoint-missing'],['valuations','position-valuation-missing']]){
  const input=fixture();input[field].splice(1,1);assert.deepEqual(reasons(verifyPositionChain(input)),[[1,reason]]);
 }
 const pending=fixture();pending.valuations[1]={epoch:1,asOfMs:at(1),status:'pending'};
 assert.deepEqual(reasons(verifyPositionChain(pending)),[[1,'position-valuation-pending']]);
 const duplicate=fixture();duplicate.valuations.push({...duplicate.valuations[1]});
 assert.deepEqual(reasons(verifyPositionChain(duplicate)),[[1,'position-valuation-duplicate']]);
});
test('daily valuation cutoff, exact fraction, expiration and persisted price reference must all agree',()=>{
 for(const [mutate,reason] of [[x=>x.valuations[1].asOfMs--,'position-valuation-cutoff'],[x=>x.valuations[1].expiresMs=at(1)-1,'position-valuation-expired'],
  [x=>x.valuations[1].microUsd='9999999','position-valuation-amount'],[x=>x.valuations[1].priceDenominator='0','position-valuation-amount'],
  [x=>x.checkpoints[1].sourceRef='history / different-price','position-checkpoint-price-reference'],[x=>x.checkpoints[1].stake='11','position-checkpoint-stake'],
  [x=>x.checkpoints[1].numerator='2000000','position-checkpoint-numerator'],[x=>x.checkpoints[1].credited='9','position-checkpoint-credited']]){
  const input=fixture();mutate(input);assert.deepEqual(reasons(verifyPositionChain(input)),[[1,reason]]);
 }
 const inclusive=fixture();inclusive.valuations[1].expiresMs=at(1);assert.equal(verifyPositionChain(inclusive).status,'ready');
});
test('final millisecond belongs to its day, exact midnight to the next, and enrollment does not invent an earlier checkpoint',()=>{
 const input=fixture();input.events=[buy(1,at(0)),event(2,'withdrawal',DAY_MS,{withdrawnUnits:'10',remainingStakeUnits:'0'})];
 for(const c of input.checkpoints.slice(1)){c.sequence=2;c.credited='0';c.flags=[];c.tokenDays=0;}
 assert.equal(verifyPositionChain(input).status,'ready');
 const enrolled=fixture();enrolled.enrolledMs=DAY_MS;enrolled.events=[buy(1,DAY_MS)];enrolled.checkpoints.shift();enrolled.valuations.shift();
 enrolled.checkpoints[0].flags=[1];enrolled.checkpoints[0].tokenDays=1;enrolled.checkpoints[1].flags=[1,2];enrolled.checkpoints[1].tokenDays=2;
 assert.equal(verifyPositionChain(enrolled).status,'ready');
 const future=fixture();future.events.push(event(2,'deposit',at(2)+1));assert.deepEqual(reasons(verifyPositionChain(future)),[[3,'position-history-time']]);
});
test('journal rejects duplicate instructions, reordered timestamps, missing sequence and unnormalized provenance fields',()=>{
 for(const [mutate,reason,epoch] of [[x=>x.events.push({...event(2,'deposit',300),signature:'tx1'}),'position-history-duplicate-instruction',0],
  [x=>x.events.push(event(3,'deposit',300)),'position-history-sequence',0],
  [x=>x.events.push(event(2,'deposit',199)),'position-history-time',0],
  [x=>x.events[0].sourceRef='arbitrary','position-history-fields',0],
  [x=>x.events[0].wallet='bob','position-history-identity',0],
  [x=>x.events[0].netBoughtUnits='18446744073709551616','position-history-purchase',0]]){
  const input=fixture();mutate(input);assert.deepEqual(reasons(verifyPositionChain(input)),[[epoch,reason]]);
 }
});
test('stale checkpoint flags cannot be accepted and campaign activity uses the original activation phase',()=>{
 const stale=fixture();stale.checkpoints[1].flags=[1];assert.deepEqual(reasons(verifyPositionChain(stale)),[[1,'position-checkpoint-flags']]);
 const input=fixture();input.throughEpoch=10;
 for(let epoch=3;epoch<=10;epoch++){
  const active=epoch<10;
  input.checkpoints.push({epoch,sequence:1,credited:'10',stake:'10',numerator:'1000000',denominator:'1',flags:active?Array.from({length:epoch+1},(_,i)=>i):[],
   tokenDays:active?epoch+1:0,sourceRef:'synthetic-history / price-'+epoch});
  input.valuations.push({...input.valuations[0],epoch,asOfMs:at(epoch),expiresMs:at(epoch)+1000,receipt:'price-'+epoch,readId:'read-'+epoch});
 }
 const ended=verifyPositionChain(input);assert.equal(ended.status,'ready');assert.equal(ended.tokenDays,0);assert.deepEqual(ended.position.flags,[]);
});
