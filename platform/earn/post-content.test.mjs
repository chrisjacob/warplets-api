import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicEarnRepository} from '../storage/atomic-earn.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {command,seed,start} from '../storage/fixtures/atomic-earn.mjs';
import {admissionRequestBytes} from '../application/commands.mjs';
import {createPostContentService} from './post-content.mjs';
import {createApp} from '../server/application.mjs';
const crypto=createNodeCrypto(),url='https://farcaster.xyz/fixture/0xabcdef12',sourceText='SYNTHETIC public post text',privateText='PRIVATE-REVIEW-CAPTURE';
const publicResponse=()=>Response.json({result:{casts:[{hash:'0xabcdef12'+'1'.repeat(32),author:{fid:3,username:'fixture',displayName:'SYNTHETIC author'},text:sourceText,timestamp:start-1,embeds:{}}]}});
async function fixture(t){const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);await seed(driver,{limit:10});const repository=createAtomicEarnRepository(driver,{crypto,ids:{next:randomUUID}}),rows=[];
 for(const wallet of ['w1','w2']){const c=await command(wallet);c.input.url=url;c.requestDigest=await crypto.sha256(admissionRequestBytes(c));const admitted=await repository.admitSubmission(c);assert.equal(admitted.kind,'committed');rows.push(db.prepare('SELECT * FROM earn_submissions WHERE wallet=?').get(wallet));}
 let calls=0;const fetcher=async()=>{calls++;return publicResponse();};const service=createPostContentService({driver,crypto,clock:{nowMs:()=>start},fetcher});return {db,driver,rows,service,fetcher,calls:()=>calls};}
async function installPrivateCapture(db,row){const job={submissionId:row.id,tokenId:row.token_id,url:row.url,capturedAt:new Date(start).toISOString(),contentType:'text',content:privateText,projectContext:'PRIVATE-CONTEXT'};db.prepare('INSERT INTO ai_review_captures VALUES(?,?,?,?,?,?)').run('submission:'+row.id,canonicalJson(job),await crypto.sha256(utf8(canonicalJson(job))),'PRIVATE-REF','synthetic-operator',start);}
test('owner sees verified capture; strangers see nothing until exact qualified winner publication and never receive private capture',async t=>{
 const f=await fixture(t),[winner,loser]=f.rows;await installPrivateCapture(f.db,winner);
 for(const principal of [null,{kind:'wallet',wallet:'stranger'}])await assert.rejects(f.service.walletContent(principal,winner.id),e=>e.status===404);
 assert.equal(f.calls(),0);const owner=await f.service.walletContent({kind:'wallet',wallet:'w1'},winner.id);assert.equal(owner.text,privateText);assert.equal(owner.provenance,'operator-capture');assert.doesNotMatch(JSON.stringify(owner),/PRIVATE-CONTEXT|PRIVATE-REF/);
 f.db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(winner.id,8,'synthetic-operator','private',start,'fixture');await assert.rejects(f.service.walletContent(null,winner.id),e=>e.status===404,'final review alone is private');
 f.db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(winner.epoch,JSON.stringify([{wallet:'w1',submissionId:winner.id}]),start,'a'.repeat(64),'SYNTHETIC public board fixture');
 await assert.rejects(f.service.walletContent(null,winner.id),e=>e.status===404,'board membership without qualified decision is private');
 for(const row of f.rows)f.db.prepare('INSERT INTO earn_decisions VALUES(?,?,1,?)').run(row.id,row.epoch,row.entry_read_id);
 const publicView=await f.service.walletContent(null,winner.id);assert.equal(publicView.text,sourceText);assert.equal(publicView.provenance,'farcaster-public-api');assert.equal(publicView.automatedScoringEnabled,false);assert.doesNotMatch(JSON.stringify(publicView),/PRIVATE-/);
 await assert.rejects(f.service.walletContent(null,loser.id),e=>e.status===404,'qualified nonwinner remains private');assert.equal(f.calls(),1);
 f.db.prepare("UPDATE app_recovery_state SET status='held'").run();await assert.rejects(f.service.walletContent(null,winner.id),e=>e.status===409);assert.equal(f.calls(),1);
});
test('published wallet is insufficient when immutable board points to another submission',async t=>{
 const f=await fixture(t),[row]=f.rows;f.db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(row.epoch,JSON.stringify([{wallet:row.wallet,submissionId:'different-id'}]),start,'b'.repeat(64),'SYNTHETIC isolation');f.db.prepare('INSERT INTO earn_decisions VALUES(?,?,1,?)').run(row.id,row.epoch,row.entry_read_id);await assert.rejects(f.service.walletContent(null,row.id),e=>e.status===404);assert.equal(f.calls(),0);
});
test('recovery transition while public fetch is awaited denies text',async t=>{
 const f=await fixture(t),[row]=f.rows;const delayed=createPostContentService({driver:f.driver,crypto,clock:{nowMs:()=>start},fetcher:async()=>{f.db.prepare("UPDATE app_recovery_state SET status='held'").run();return publicResponse();}});await assert.rejects(delayed.walletContent({kind:'wallet',wallet:row.wallet},row.id),e=>e.status===409);
});
test('tampered private capture hash cannot be exposed as verified content',async t=>{
 const f=await fixture(t),[row]=f.rows;const job={submissionId:row.id,tokenId:row.token_id,url:row.url,capturedAt:new Date(start).toISOString(),contentType:'text',content:privateText,projectContext:'private facts'};
 f.db.prepare('INSERT INTO ai_review_captures VALUES(?,?,?,?,?,?)').run('submission:'+row.id,canonicalJson(job),'0'.repeat(64),'private-ref','fixture',start);
 await assert.rejects(f.service.walletContent({kind:'wallet',wallet:row.wallet},row.id),e=>e.status===503&&e.code==='review_evidence_unavailable');assert.equal(f.calls(),0);
});
test('HTTP content route is owner-private, query-free, no-store and bounded without arbitrary URL proxy',async t=>{
 const f=await fixture(t),[row]=f.rows,origin='https://local.invalid';f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update('owner').digest('hex'),row.wallet,origin,start+10000);
 const app=createApp(f.db,{clock:()=>start,postSourceFetch:f.fetcher}),path='/api/v1/earn/submissions/'+row.id+'/content',request=(suffix='',cookie='owner')=>app(new Request(origin+path+suffix,{headers:{cookie:'tenx_local_session='+cookie}}));
 assert.equal((await request('','unknown')).status,404);assert.equal((await request('?url=http://127.0.0.1')).status,400);
 const good=await request();assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');assert.equal((await good.json()).text,sourceText);
 for(let i=0;i<5;i++)assert.equal((await request()).status,200);assert.equal((await request()).status,429);assert.equal(f.calls(),6);
});
