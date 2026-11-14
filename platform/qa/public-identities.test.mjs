import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {importPublicIdentities,readQaIdentitySource,loadPublicIdentities,publicIdentityResponse,safePublicImageUrl} from './public-identities.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHxoAAAAASUVORK5CYII=','base64');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'tenx-public-identities-'));t.after(()=>{assert(root.startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});});const directory=join(root,'qa-source'),output=join(root,'qa-overlay');mkdirSync(directory);
 const snapshot={mode:'synthetic-local',participants:[{wallet:'synthetic-a'},{wallet:'synthetic-b'},{wallet:'owner'}],tokens:[{id:'qa-att-1',symbol:'QA1',launchAt:'2026-11-13T00:00:00.000Z'},{id:'qa-att-2',symbol:'QA2',launchAt:'2026-11-14T00:00:00.000Z'}],rewards:[{awardedUnits:'100'}]},text=JSON.stringify(snapshot),report={scope:'synthetic-local-only',status:'complete',wallet:'owner',performance:{sha256:sha(text)}};
 writeFileSync(join(directory,'performance.json'),text);writeFileSync(join(directory,'scenario.json'),JSON.stringify(report));writeFileSync(join(directory,'core.sqlite'),'UNTOUCHED ECONOMIC DATABASE');return {root,directory,output,snapshot,report};}
function sourceFetch({badImage=false,unavailable=false,unsafeImage=false}={}){const calls=[];return {calls,async fetcher(url,options){calls.push({url,options});assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');if(unavailable)return new Response('Unavailable',{status:503});
 if(url.startsWith('https://client.farcaster.xyz/'))return Response.json({result:{users:[{fid:12,username:'public-one',displayName:'Public One',pfp:{url:unsafeImage?'http://127.0.0.1/private':'https://imagedelivery.net/public-one/original'},profile:{bio:{text:'DO NOT RETAIN BIO'}},custodyAddress:'DO NOT RETAIN WALLET'},{fid:13,username:'public-two',pfp:{url:'https://imagedelivery.net/public-two/original'}}]}});
 if(url.startsWith('https://api.geckoterminal.com/'))return Response.json({data:[1,2].map(n=>({attributes:{address:String(n).repeat(32)},relationships:{base_token:{data:{id:'token-'+n}}}})),included:[1,2].map(n=>({id:'token-'+n,type:'token',attributes:{address:String(n+2).repeat(32),name:'Public token '+n,symbol:'PUBLIC'+n,image_url:'https://assets.geckoterminal.com/token-'+n,price_usd:'DO NOT RETAIN PRICE'}}))});
 return new Response(badImage?'<svg onload="alert(1)"></svg>':png,{headers:{'content-type':badImage?'image/svg+xml':'image/png'}});
 }};}
test('public refresh creates a pinned presentation-only overlay, caches raster art and preserves all source data',async t=>{
 const f=fixture(t),mock=sourceFetch(),before=['performance.json','scenario.json','core.sqlite'].map(n=>readFileSync(join(f.directory,n))),result=await importPublicIdentities({...f,...mock,nowMs:1794600000000});
 assert.equal(result.coverage.profiles,2);assert.equal(result.coverage.ownerPreserved,1);assert.equal(result.coverage.tokenNames,2);assert.equal(result.coverage.cachedImages,4);assert.equal(result.images.length,1,'identical raster bytes share one immutable cache object');assert.equal(result.profiles.some(p=>p.wallet==='owner'),false);
 for(const [n,name]of ['performance.json','scenario.json','core.sqlite'].entries())assert.deepEqual(readFileSync(join(f.directory,name)),before[n]);
 const text=readFileSync(join(f.output,'identities.json'),'utf8');assert.doesNotMatch(text,/DO NOT RETAIN|awardedUnits/);
 const loaded=loadPublicIdentities(join(f.output,'identities.json'),f);assert.equal(loaded.value.profiles[0].username,'public-one');assert.equal(loaded.value.tokens[0].tokenId,'qa-att-2');
 const response=publicIdentityResponse(new Request('http://localhost/api/v1/qa/identities'),loaded);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).scope,'synthetic-presentation-only');
 const image=publicIdentityResponse(new Request('http://localhost'+result.images[0].path),loaded);assert.equal(image.headers.get('content-type'),'image/png');assert.match(image.headers.get('cache-control'),/immutable/);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
 const count=mock.calls.length;await assert.rejects(importPublicIdentities({...f,...mock}),/overwrite/);assert.equal(mock.calls.length,count);
});
test('unsafe URLs, active image types and missing sources fall back without a network proxy',async t=>{
 const f=fixture(t),mock=sourceFetch({badImage:true,unsafeImage:true}),result=await importPublicIdentities({...f,...mock});assert.equal(result.images.length,0);assert.equal(result.coverage.imageFallbacks,4);assert.ok(mock.calls.every(c=>!c.url.includes('127.0.0.1')));
 for(const url of ['http://imagedelivery.net/a','https://imagedelivery.net.evil.invalid/a','https://name:password@imagedelivery.net/a','https://imagedelivery.net:444/a','file:///etc/passwd','data:image/png;base64,x','https://127.0.0.1/image'])assert.equal(safePublicImageUrl(url),null);
 const loaded=loadPublicIdentities(join(f.output,'identities.json'),f);for(const path of ['/qa-media/../../core.sqlite','/qa-media/'+('a'.repeat(64))+'.svg','/qa-media/nope.png','/api/v1/qa/identities?source=https://evil.invalid'])assert.equal(publicIdentityResponse(new Request('http://localhost'+path),loaded)?.status??404,404);
 assert.equal(publicIdentityResponse(new Request('http://localhost/api/v1/qa/identities',{method:'POST'}),loaded).status,405);assert.equal(publicIdentityResponse(new Request('http://localhost/api/v1/qa/identities'),null).status,404);
});
test('pinned overlay rejects altered cache, owner reassignment and another economic snapshot',async t=>{
 const f=fixture(t),result=await importPublicIdentities({...f,...sourceFetch()}),path=join(f.output,'identities.json');
 assert.throws(()=>loadPublicIdentities(path,{...f,report:{...f.report,performance:{sha256:'a'.repeat(64)}}}),/does not match/);
 result.profiles[0].wallet='owner';const bytes=Buffer.from(JSON.stringify(result));writeFileSync(path,bytes);assert.throws(()=>loadPublicIdentities(path,f),/digest differs/);writeFileSync(join(f.output,'identities.sha256'),sha(bytes));assert.throws(()=>loadPublicIdentities(path,f),/profile association/);
 result.profiles[0].wallet='synthetic-a';const repaired=Buffer.from(JSON.stringify(result));writeFileSync(path,repaired);writeFileSync(join(f.output,'identities.sha256'),sha(repaired));writeFileSync(join(f.output,'images',basename(result.images[0].path)),Buffer.alloc(png.length));assert.throws(()=>loadPublicIdentities(path,f),/image format|digest differs/);
});
test('unavailable sources are honestly failed; bad source snapshot is rejected before requests',async t=>{
 const f=fixture(t),mock=sourceFetch({unavailable:true});await assert.rejects(importPublicIdentities({...f,...mock}),/No verified public identities/);assert.match(readFileSync(join(f.output,'FAILED.txt'),'utf8'),/No economic data changed/);
 writeFileSync(join(f.directory,'performance.json'),'{}');const count=mock.calls.length;assert.throws(()=>readQaIdentitySource(f.directory),/digest or scope/);await assert.rejects(importPublicIdentities({...f,output:join(f.root,'qa-another'),...mock}),/digest or scope/);assert.equal(mock.calls.length,count);
});

test('oversized decoded JPEG/WebP dimensions and oversized downloads remain placeholders',async t=>{
 const jpeg=Buffer.from([255,216,255,192,0,11,8,255,255,0,1,1,1,17,0,255,217]),webp=Buffer.alloc(30);webp.write('RIFF');webp.writeUInt32LE(22,4);webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUInt32LE(10,16);webp.writeUIntLE(16777215,24,3);
 for(const [name,payload,type,reason] of [['jpeg',jpeg,'image/jpeg','image-dimension-bound'],['webp',webp,'image/webp','image-dimension-bound'],['large',Buffer.alloc(262145),'image/png','image-byte-bound']]){
  const f=fixture(t),mock=sourceFetch(),fetcher=(url,options)=>url.startsWith('https://client.farcaster.xyz/')||url.startsWith('https://api.geckoterminal.com/')?mock.fetcher(url,options):Promise.resolve(new Response(payload,{headers:{'content-type':type}}));
  const result=await importPublicIdentities({...f,fetcher});assert.equal(result.images.length,0,name);assert.equal(result.coverage.imageFallbacks,4,name);assert.equal(result.imageAttempts.failuresByReason[reason],4,name);
 }
});

test('bounded extra candidates replace failed avatars with distinct real profiles while preserving the owner',async t=>{
 const f=fixture(t),mock=sourceFetch(),fetcher=async(url,options)=>{
  if(url.startsWith('https://client.farcaster.xyz/'))return Response.json({result:{users:[1,2,3,4].map(n=>({fid:n,username:'public-'+n,displayName:'Person '+n,pfp:{url:'https://imagedelivery.net/'+n+'/original'}}))}});
  if(/imagedelivery\.net\/[12]\//.test(url))return new Response('Missing',{status:404});return mock.fetcher(url,options);
 };
 const result=await importPublicIdentities({...f,fetcher});assert.deepEqual(result.profiles.map(p=>p.fid),[3,4]);assert.equal(result.coverage.cachedImages,4);assert.equal(result.coverage.imageFallbacks,0);assert.equal(result.imageAttempts.candidateProfiles,4);assert.equal(result.imageAttempts.failuresByReason['Public source HTTP 404'],2);assert.equal(result.profiles.some(p=>p.wallet==='owner'),false);
});
