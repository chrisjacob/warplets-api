import assert from 'node:assert/strict';
import test from 'node:test';
import {handleRequest} from './index';
test('every mutation method is disabled across participation and financial routes',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/api/meme/votes','/api/meme/claims','/api/meme/launches']){
  const response=await handleRequest(new Request('http://localhost'+path,{method,body:'{"fid":42}'}));
  assert.equal(response.status,405);assert.equal(response.headers.get('cache-control'),'no-store');
 }
});
test('fixture contract distinguishes voters, weights and finality without treating fixtures as authenticated data',async()=>{
 const response=await handleRequest(new Request('http://localhost/api/meme/preview'));const body=await response.json() as {mode:string;actionsEnabled:boolean;round:{finality:string;candidates:{uniqueVoters:number;weightedVotes:number}[]};participant:{solanaWallet:null};boost:{total:number;rewardPoints:number;voteWeight:number}};
 assert.equal(body.mode,'fixture');assert.equal(body.actionsEnabled,false);assert.equal(body.participant.solanaWallet,null);assert.equal(body.round.finality,'provisional');assert.notEqual(body.round.candidates[0].uniqueVoters,body.round.candidates[0].weightedVotes);
 assert.equal(body.boost.rewardPoints,10*body.boost.total);assert.equal(body.boost.voteWeight,body.boost.total);
 assert.equal((await handleRequest(new Request('http://localhost/api/meme/preview',{method:'HEAD'}))).body,null);
 assert.equal((await handleRequest(new Request('http://localhost/private'))).status,404);
});
