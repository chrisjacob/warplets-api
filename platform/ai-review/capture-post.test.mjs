import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicEarnRepository} from '../storage/atomic-earn.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {command,seed,start} from '../storage/fixtures/atomic-earn.mjs';
import {admissionRequestBytes} from '../application/commands.mjs';
import {capturePublicPost} from './capture-post.mjs';
async function fixture(t,url){const directory=mkdtempSync(join(tmpdir(),'tenx-post-capture-')),database=join(directory,'db.sqlite'),contextFile=join(directory,'context.txt'),receiptFile=join(directory,'receipt.json');let inspector;t.after(()=>{inspector?.close();rmSync(directory,{recursive:true,force:true});});writeFileSync(contextFile,'SYNTHETIC trusted project context');const db=openDatabase(database),driver=createNodeAtomicDriver(db),crypto=createNodeCrypto();await seed(driver);db.prepare("INSERT INTO app_operator_scopes VALUES('synthetic-operator','ai-review',0,1)").run();const c=await command();c.input.url=url;c.requestDigest=await crypto.sha256(admissionRequestBytes(c));const admitted=await createAtomicEarnRepository(driver,{crypto,ids:{next:randomUUID},supportedPostsOnly:true}).admitSubmission(c);assert.equal(admitted.kind,'committed');db.close();return {database,contextFile,receiptFile,inspect:()=>inspector??=openDatabase(database),operatorId:'synthetic-operator',jobId:'submission:'+admitted.value.submission.id};}
test('authorized public Farcaster text capture persists evidence and remains held with no model call or score',async t=>{
 const f=await fixture(t,'https://farcaster.xyz/fixture/0xabcdef12');let reads=0;const ports={clock:{nowMs:()=>start+1},fetcher:async endpoint=>{reads++;const cast={hash:'0xabcdef12'+'1'.repeat(32),author:{fid:1,username:'fixture',displayName:'SYNTHETIC author'},text:'SYNTHETIC text-only public source',timestamp:start,embeds:{images:[],urls:[],videos:[],casts:[],unknowns:[]}};if(endpoint.includes('/thread-casts'))delete cast.embeds;return Response.json({result:{casts:[cast]}});}};
 assert.equal((await capturePublicPost(f,ports)).state,'held');assert.equal(reads,2);const receipt=JSON.parse(readFileSync(f.receiptFile,'utf8'));assert.equal(receipt.format,'10x.public-post-capture.v1');assert.equal(receipt.automaticScoringEnabled,false);assert.match(receipt.sha256,/^[a-f0-9]{64}$/);assert.match(receipt.attachmentEvidence.sha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(receipt),/SYNTHETIC text-only|trusted project/);
 const db=f.inspect();assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_review_captures').get().n,1);assert.equal(db.prepare('SELECT evidence_ref FROM ai_review_captures').get().evidence_ref,'public-post-v1:farcaster:'+receipt.sourceReceiptHash);assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_review_reports').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);
 await assert.rejects(capturePublicPost(f,ports),/new receipt/);assert.equal(reads,2);
});
test('X excerpts and unauthorized operators do not create a capture or source receipt',async t=>{
 const f=await fixture(t,'https://x.com/i/status/20');let reads=0;const ports={clock:{nowMs:()=>start+1},fetcher:async()=>{reads++;return Response.json({provider_name:'X',provider_url:'https://x.com',type:'rich',url:'https://x.com/i/status/20',html:'<p>SYNTHETIC excerpt</p>'});}};
 await assert.rejects(capturePublicPost({...f,operatorId:'not-authorized'},ports),/active ai-review/);assert.equal(reads,0);
 await assert.rejects(capturePublicPost(f,ports),/excerpt or attached media/);assert.equal(existsSync(f.receiptFile),false);const db=f.inspect();assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_review_captures').get().n,0);assert.equal(db.prepare('SELECT state FROM ai_review_jobs WHERE id=?').get(f.jobId).state,'awaiting-capture');
});
