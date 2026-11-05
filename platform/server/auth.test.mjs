import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createApp} from './application.mjs';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from './base58.mjs';

function fixture(t) {
  const db=openDatabase(); t.after(()=>db.close());
  let now=1_800_000_000_000;
  const handler=createApp(db,{clock:()=>now});
  const origin='http://127.0.0.1:4173';
  const pair=generateKeyPairSync('ed25519');
  const wallet=encode58(pair.publicKey.export({type:'spki',format:'der'}).subarray(-32));
  return {
    db,wallet,advance:ms=>{now+=ms;},
    request:(route,body,headers={})=>handler(new Request(origin+'/api/v1'+route,{
      method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...headers},
      body:body===undefined?undefined:JSON.stringify(body)})),
    proof:challenge=>({nonce:challenge.nonce,signature:encode58(sign(null,Buffer.from(challenge.message),pair.privateKey))})
  };
}
test('wallet-only sign-in consumes origin-bound proof, issues revocable owner session',async t=>{
  const f=fixture(t);
  assert.equal((await f.request('/me')).status,401);
  assert.equal((await f.request('/auth/challenges',{wallet:f.wallet},{origin:'http://evil.test'})).status,403);
  const challenge=await (await f.request('/auth/challenges',{wallet:f.wallet})).json();
  assert.ok(challenge.message.includes(f.wallet));assert.ok(challenge.message.includes('Chain: solana'));
  const proof=f.proof(challenge);
  const [one,two]=await Promise.all([f.request('/auth/verify',proof),f.request('/auth/verify',proof)]);
  assert.deepEqual([one.status,two.status].sort(),[200,401]);
  const cookie=(one.status===200?one:two).headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  const headers={cookie:cookie.split(';')[0]};
  assert.equal((await (await f.request('/me',undefined,headers)).json()).wallet,f.wallet);
  assert.equal((await f.request('/auth/logout',{},headers)).status,200);
  assert.equal((await f.request('/me/wallets',undefined,headers)).status,401);
});
test('wrong signature and expired challenge never establish a session',async t=>{
  const f=fixture(t);
  const challenge=await (await f.request('/auth/challenges',{wallet:f.wallet})).json();
  const other=generateKeyPairSync('ed25519');
  const signature=encode58(sign(null,Buffer.from(challenge.message),other.privateKey));
  assert.equal((await f.request('/auth/verify',{nonce:challenge.nonce,signature})).status,401);
  f.advance(301000);
  assert.equal((await f.request('/auth/verify',f.proof(challenge))).status,401);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
});
test('challenge quota caps requests and recovers at the next interval',async t=>{
  const f=fixture(t);
  for(let i=0;i<15;i++)assert.equal((await f.request('/auth/challenges',{wallet:f.wallet})).status,201);
  const limited=await f.request('/auth/challenges',{wallet:f.wallet});assert.equal(limited.status,429);
  assert.ok(Number(limited.headers.get('retry-after'))>0);
  f.advance(61000);assert.equal((await f.request('/auth/challenges',{wallet:f.wallet})).status,201);
});
test('identity-point wallet cannot authenticate with a universal forged proof',async t=>{
  const f=fixture(t);
  const identity=Buffer.alloc(32);identity[0]=1;
  const wallet=encode58(identity);
  assert.equal((await f.request('/auth/challenges',{wallet})).status,400);
  // Even a challenge persisted before strict checking cannot issue a session.
  const nonce='n'.repeat(43);
  f.db.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,NULL)').run(nonce,wallet,'http://127.0.0.1:4173','legacy',1_800_000_300_000);
  const signature=encode58(Buffer.concat([identity,Buffer.alloc(32)]));
  assert.equal((await f.request('/auth/verify',{nonce,signature})).status,400);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
});
