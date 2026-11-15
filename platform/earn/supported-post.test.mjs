import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {supportedPost} from './supported-post.mjs';
import {readSupportedPost,createPostCapture} from './post-source.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicEarnRepository} from '../storage/atomic-earn.mjs';
import {command,seed,start} from '../storage/fixtures/atomic-earn.mjs';
import {admissionRequestBytes} from '../application/commands.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const crypto=createNodeCrypto(),clock={nowMs:()=>start},hash='0x'+'abcdef12'+'1'.repeat(32);
export const castPayload=()=>({result:{casts:[{hash,author:{fid:3,username:'fixture',displayName:'SYNTHETIC author'},text:'SYNTHETIC source text <script>never executes</script>',timestamp:start-100,embeds:{images:[],urls:[],videos:[],casts:[],unknowns:[]}}]}});
const response=data=>Response.json(data);
export const sourceUrl='https://farcaster.xyz/fixture/0xabcdef12';
test('supported post identity rejects profiles, arbitrary hosts and redirect-shaped input',()=>{
 for(const url of ['https://twitter.com/fixture/status/20?s=20','https://x.com/i/web/status/20/photo/1','https://x.com/i/status/20#share'])assert.equal(supportedPost(url).canonicalUrl,'https://x.com/i/status/20');
 assert.equal(supportedPost('https://warpcast.com/FIXTURE/0xABCDEF12').canonicalUrl,sourceUrl);
 for(const url of ['http://x.com/a/status/1','https://x.com','https://x.com/a','https://x.com/home','https://x.com.evil.test/a/status/1','https://x.com@evil.test/a/status/1','https://user@x.com/a/status/1','https://x.com:8080/a/status/1','https://127.0.0.1/a/status/1','https://x.com/a/../a/status/1','https://x.com/a%2fb/status/1','https://x.com/a/status/01','https://x.com/a/status/18446744073709551616','https://x.com/a/status/1?url=http://127.0.0.1','https://farcaster.xyz/fixture','https://farcaster.xyz/fixture/0x1234567','https://farcaster.xyz/fixture/0xabcdef12/extra'])assert.throws(()=>supportedPost(url),e=>e.code==='unsupported_post_url',url);
});
test('public source fetch is fixed, redirect-free, bounded and binds Farcaster author/hash',async()=>{
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://client.farcaster.xyz/v2/thread-casts?castHash=0xabcdef12');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return response(castPayload());};
 const source=await readSupportedPost(sourceUrl,{fetcher,crypto,clock});assert.equal(source.textComplete,true);assert.equal(source.hasMedia,false);assert.match(source.message,/Authorship.*separately/);assert.match(source.text,/<script>/);assert.equal(calls,1);
 const capture=await createPostCapture({submission:{id:'s',token_id:'A',url:sourceUrl,submitted_ms:start-1},projectContext:'Trusted project facts',source,nowMs:start,crypto});assert.equal(capture.job.content,source.text);assert.equal(capture.receipt.automaticScoringEnabled,false);assert.equal(capture.receipt.postId,hash);
 for(const modify of [d=>d.result.casts[0].author.username='wrong',d=>d.result.casts.push({...d.result.casts[0]}),d=>d.result.casts[0].deleted=true,d=>d.result.disallowed=true]){const data=castPayload();modify(data);await assert.rejects(readSupportedPost(sourceUrl,{fetcher:async()=>response(data),crypto,clock}));}
 await assert.rejects(readSupportedPost(sourceUrl,{fetcher:async()=>new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}}),crypto,clock}));
 await assert.rejects(readSupportedPost(sourceUrl,{fetcher:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1'}}),crypto,clock}));
 const media=castPayload();media.result.casts[0].embeds.images.push({url:'http://127.0.0.1/private'});const attached=await readSupportedPost(sourceUrl,{fetcher:async()=>response(media),crypto,clock});assert.equal(attached.hasMedia,true);await assert.rejects(createPostCapture({submission:{id:'s',token_id:'A',url:sourceUrl,submitted_ms:start-1},projectContext:'Facts',source:attached,nowMs:start,crypto}));
 for(const embeds of [{images:[],urls:['https://example.test'],videos:[],casts:[],unknowns:[]},{images:[],urls:[],videos:[],casts:[],unknowns:[],newField:['attachment']},[],{},null]){const payload=castPayload();payload.result.casts[0].embeds=embeds;const ambiguous=await readSupportedPost(sourceUrl,{fetcher:async()=>response(payload),crypto,clock});assert.equal(ambiguous.hasMedia,true);await assert.rejects(createPostCapture({submission:{id:'s',token_id:'A',url:sourceUrl,submitted_ms:start-1},projectContext:'Facts',source:ambiguous,nowMs:start,crypto}));}
});
test('X oEmbed is escaped plain text and explicitly incomplete, never scoring capture',async()=>{
 const data={provider_name:'Twitter',provider_url:'https://twitter.com/',type:'rich',url:'https://twitter.com/fixture/status/20',author_name:'SYNTHETIC author',html:'<blockquote><p>Text &amp; &lt;script&gt; <a href="http://127.0.0.1">link</a><br>second line</p></blockquote><script src="https://evil.test"></script>'};
 const source=await readSupportedPost('https://x.com/fixture/status/20',{crypto,clock,fetcher:async(url,options)=>{assert.match(url,/^https:\/\/publish\.x\.com\/oembed\?url=/);assert.equal(options.redirect,'error');return response(data);}});assert.equal(source.text,'Text & <script> link\nsecond line');assert.equal(source.textComplete,false);assert.equal(source.provenance,'x-oembed');
 await assert.rejects(createPostCapture({submission:{id:'s',token_id:'A',url:'https://x.com/fixture/status/20',submitted_ms:start-1},projectContext:'Facts',source,nowMs:start,crypto}));
 await assert.rejects(readSupportedPost('https://x.com/fixture/status/21',{crypto,clock,fetcher:async()=>response(data)}));
 await assert.rejects(readSupportedPost('https://x.com/fixture/status/20',{crypto,clock,fetcher:async()=>response({...data,html:'<p>Unsafe<img src="x"></p>'})}));
});
test('trusted Farcaster capture supplements omitted metadata once, binds both receipts and refuses ambiguity',async()=>{
 const thread=castPayload();delete thread.result.casts[0].embeds;
 const calls=[],fetcher=async endpoint=>{calls.push(endpoint);return response(endpoint.includes('/thread-casts')?thread:castPayload());};
 const preview=await readSupportedPost(sourceUrl,{fetcher,crypto,clock});assert.equal(preview.hasMedia,true);assert.equal(calls.length,1,'ordinary preview never supplements');calls.length=0;
 const source=await readSupportedPost(sourceUrl,{fetcher,crypto,clock,requireCompleteText:true});assert.equal(source.hasMedia,false);assert.deepEqual(calls,['https://client.farcaster.xyz/v2/thread-casts?castHash=0xabcdef12','https://client.farcaster.xyz/v2/casts?fid=3&limit=20']);assert.match(source.receipt.attachmentEvidence.sha256,/^[a-f0-9]{64}$/);
 const capture=await createPostCapture({submission:{id:'s',token_id:'A',url:sourceUrl,submitted_ms:start-1},projectContext:'Facts',source,crypto,nowMs:start}),{sourceReceiptHash,...combined}=capture.receipt;assert.equal(sourceReceiptHash,await crypto.sha256(utf8(canonicalJson(combined))));assert.equal(capture.evidenceRef,'public-post-v1:farcaster:'+sourceReceiptHash);
 const changed=structuredClone(source);changed.receipt.attachmentEvidence.sha256='0'.repeat(64);const altered=await createPostCapture({submission:{id:'s',token_id:'A',url:sourceUrl,submitted_ms:start-1},projectContext:'Facts',source:changed,crypto,nowMs:start});assert.notEqual(capture.evidenceRef,altered.evidenceRef);
 for(const modify of [d=>d.result.disallowed=true,d=>d.result.casts=[],d=>d.result.casts[0].text+=' changed',d=>d.result.casts[0].timestamp--,d=>d.result.casts[0].author.fid++,d=>d.result.casts[0].author.username='other',d=>d.result.casts[0].embeds.urls.push('https://example.test'),d=>delete d.result.casts[0].embeds.unknowns,d=>d.result.casts[0].embeds.extra=['unknown attachment']]){
  const supplement=castPayload();modify(supplement);let attempts=0;await assert.rejects(readSupportedPost(sourceUrl,{crypto,clock,requireCompleteText:true,fetcher:async endpoint=>{attempts++;return response(endpoint.includes('/thread-casts')?thread:supplement);}}));assert.equal(attempts,2,'no pagination or retry after incomplete recent page');
 }
 const attached=castPayload();attached.result.casts[0].embeds.urls=['https://example.test'];let attempts=0;const incomplete=await readSupportedPost(sourceUrl,{crypto,clock,requireCompleteText:true,fetcher:async()=>{attempts++;return response(attached);}});assert.equal(incomplete.hasMedia,true);assert.equal(attempts,1,'never override an attachment with a second response');
});
test('new intake requires supported posts but old immutable commands still replay unchanged',async t=>{
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db),ports={crypto,ids:{next:randomUUID}};await seed(driver,{limit:10});
 const legacy=await command(),internal=createAtomicEarnRepository(driver,ports),accepted=await internal.admitSubmission(legacy);assert.equal(accepted.kind,'committed');
 const strict=createAtomicEarnRepository(driver,{...ports,supportedPostsOnly:true});assert.deepEqual(await strict.admitSubmission(legacy),{...accepted,kind:'replayed'});
 const next=await command('w2');assert.equal((await strict.admitSubmission(next)).code,'unsupported_post_url');assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,1);
 next.input.url='https://twitter.com/fixture/status/20?s=20';next.requestDigest=await crypto.sha256(admissionRequestBytes(next));assert.equal((await strict.admitSubmission(next)).kind,'committed');
 assert.equal(db.prepare('SELECT url FROM earn_submissions WHERE wallet=?').get('w2').url,next.input.url,'generic persisted URL stays backward compatible');
});
