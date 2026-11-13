import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createApp} from './application.mjs';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from './base58.mjs';
import {handleAuth} from './auth.mjs';

test('authentication routes require the canonical API prefix',async t=>{
  const db=openDatabase();t.after(()=>db.close());
  for(const path of ['/abcdef/auth/challenges','/abcdef/auth/verify','/abcdef/auth/logout','/api/v10/auth/challenges']){
    const result=await handleAuth(db,new Request('http://127.0.0.1:4173'+path,{method:'POST'}),'loopback',1_800_000_000_000);
    assert.equal(result,null,path);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_challenges').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM request_limits').get().n,0);
});

function fixture(t,origin='http://127.0.0.1:4173') {
  const db=openDatabase(); t.after(()=>db.close());
  let now=1_800_000_000_000;
  const handler=createApp(db,{clock:()=>now});
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

test('HTTPS auth sets Secure on issuance and revocation using the request URL, never forwarded headers',async t=>{
  const https=fixture(t,'https://127.0.0.1:4173');
  const challenge=await (await https.request('/auth/challenges',{wallet:https.wallet})).json();
  const proof=https.proof(challenge),downgrade={'x-forwarded-proto':'http',forwarded:'proto=http'};
  assert.equal((await https.request('/auth/verify',proof,{origin:'http://127.0.0.1:4173','x-forwarded-proto':'https'})).status,403);
  const issued=await https.request('/auth/verify',proof,downgrade);assert.equal(issued.status,200);
  const secureCookie=issued.headers.get('set-cookie');assert.match(secureCookie,/; Secure(?:;|$)/);
  assert.match(secureCookie,/HttpOnly/);assert.match(secureCookie,/SameSite=Strict/);
  const cookie=secureCookie.split(';')[0];assert.equal((await https.request('/me',undefined,{cookie})).status,200);
  const sameDb=createApp(https.db,{clock:()=>1_800_000_000_000});
  assert.equal((await sameDb(new Request('http://127.0.0.1:4173/api/v1/me',{headers:{cookie}}))).status,401);
  const revoked=await https.request('/auth/logout',{}, {cookie,...downgrade});assert.equal(revoked.status,200);
  assert.match(revoked.headers.get('set-cookie'),/; Secure(?:;|$)/);assert.match(revoked.headers.get('set-cookie'),/Max-Age=0/);
  const http=fixture(t),localChallenge=await (await http.request('/auth/challenges',{wallet:http.wallet})).json();
  const local=await http.request('/auth/verify',http.proof(localChallenge),{'x-forwarded-proto':'https',forwarded:'proto=https'});assert.equal(local.status,200);
  assert.doesNotMatch(local.headers.get('set-cookie'),/; Secure(?:;|$)/);
  const localLogout=await http.request('/auth/logout',{}, {cookie:local.headers.get('set-cookie').split(';')[0],'x-forwarded-proto':'https'});
  assert.equal(localLogout.status,200);assert.doesNotMatch(localLogout.headers.get('set-cookie'),/; Secure(?:;|$)/);
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

test('exhausting anonymous authentication quota cannot prevent session revocation',async t=>{
  const f=fixture(t),raw='synthetic-logout-under-quota',cookie='tenx_local_session='+raw;
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(raw).digest('hex'),f.wallet,'http://127.0.0.1:4173',1_800_000_600_000);
  for(let i=0;i<15;i++)assert.equal((await f.request('/auth/challenges',{wallet:f.wallet})).status,201);
  assert.equal((await f.request('/auth/challenges',{wallet:f.wallet})).status,429);
  assert.equal((await f.request('/auth/logout',{}, {cookie,origin:'https://other.invalid'})).status,403);
  assert.equal((await f.request('/me',undefined,{cookie})).status,200);
  const revoked=await f.request('/auth/logout',{}, {cookie});
  assert.equal(revoked.status,200);
  assert.match(revoked.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await f.request('/me',undefined,{cookie})).status,401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
  // Revocation must neither bypass nor reset the issuance quota.
  assert.equal((await f.request('/auth/challenges',{wallet:f.wallet})).status,429);
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
test('request cleanup is bounded and retained expired sessions remain unusable',async t=>{
 const db=openDatabase();t.after(()=>db.close());const now=1800000000000,origin='http://localhost';
 for(let i=0;i<201;i++){
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update('expired'+i).digest('hex'),'synthetic-wallet',origin,now-i);
  db.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,NULL)').run('nonce'+i,'synthetic-wallet',origin,'synthetic-message',now-i);
  db.prepare('INSERT INTO request_limits VALUES(?,?,?)').run('synthetic-bucket'+i,now-i,1);
 }
 const app=createApp(db,{clock:()=>now}),response=await app(new Request(origin+'/api/v1/me',{headers:{cookie:'tenx_local_session=expired0'}}));
 assert.equal(response.status,401);
 for(const table of ['sessions','auth_challenges','request_limits'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,101);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash=?').get(createHash('sha256').update('expired0').digest('hex')).n,1);
});
