import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {serveSite} from '../serve.mjs';
const fixture=async t=>{
 const dir=await mkdtemp(join(tmpdir(),'tenx-static-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'site-assets'));const source='export const label="public build asset";\n'.repeat(400);
 await writeFile(join(dir,'site-assets','index-testhash.js'),source);await writeFile(join(dir,'index.html'),'<html><body>private page shell</body></html>');
 const request=(headers={},method='GET',path='/site-assets/index-testhash.js')=>serveSite(new Request('http://localhost'+path,{headers,method}),pathToFileURL(dir+'/'));
 return {dir,source,request};
};
test('public build assets negotiate compressed representations and HEAD without changing content',async t=>{
 const {source,request}=await fixture(t);
 for(const [accept,expected] of [['br, gzip','br'],['gzip','gzip'],['br;q=0, gzip;q=1','gzip'],['br;q=0.5, identity;q=1','identity'],['','identity']]){
  const response=await request({'accept-encoding':accept}),bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get('content-encoding'),expected==='identity'?null:expected);
  assert.equal((expected==='br'?brotliDecompressSync(bytes):expected==='gzip'?gunzipSync(bytes):bytes).toString(),source);
  assert.equal(Number(response.headers.get('content-length')),bytes.length);assert.match(response.headers.get('vary'),/Accept-Encoding/);
  if(expected!=='identity')assert.ok(bytes.length<source.length/4);
  const head=await request({'accept-encoding':accept},'HEAD');assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),String(bytes.length));
 }
 assert.equal((await request({'accept-encoding':'*;q=0'})).status,406);
});
test('conditional assets retain security headers and rebuilt files invalidate the bounded cache',async t=>{
 const {dir,request}=await fixture(t),first=await request(),tag=first.headers.get('etag');
 for(const validators of [tag,tag.slice(2),'"other", '+tag,'*']){
  const response=await request({'if-none-match':validators,'accept-encoding':'br'});assert.equal(response.status,304);assert.equal(await response.text(),'');
  assert.match(response.headers.get('cache-control'),/immutable/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 await writeFile(join(dir,'site-assets','index-testhash.js'),'rebuilt asset');
 const changed=await request({'if-none-match':tag});assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),tag);assert.equal(await changed.text(),'rebuilt asset');
 assert.equal((await request({},'GET','/site-assets/missing.js')).status,404);
});
test('HTML and unknown paths never enter the public compressed asset cache',async t=>{
 const {request}=await fixture(t),page=await request({'accept-encoding':'br'},'GET','/earn');
 assert.equal(page.headers.get('content-encoding'),null);assert.equal(page.headers.get('etag'),null);assert.equal(page.headers.get('cache-control'),'no-cache');
 assert.equal(await request({},'GET','/site-assets/private.sqlite'),null);
 assert.equal((await request({},'POST')).status,405);
});

test('concurrent cold requests share one asset build and a failed build can be retried',async t=>{
 for(const failFirst of [false,true]){
  const {dir,request,source}=await fixture(t),target=pathToFileURL(join(dir,'site-assets','index-testhash.js')).href;
  const originalRead=fsPromises.readFile,originalStat=fsPromises.stat;let reads=0,stats=0,release,allStarted;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{allStarted=resolve;});
  fsPromises.stat=async(...args)=>{const info=await originalStat(...args);if(args[0]?.href===target&&++stats===8)allStarted();return info;};
  fsPromises.readFile=async(...args)=>{if(args[0]?.href===target){const attempt=++reads;await gate;if(failFirst&&attempt===1)throw Error('Synthetic read failure');}return originalRead(...args);};
  syncBuiltinESMExports();
  try{
   const requests=Array.from({length:8},()=>request({'accept-encoding':'br'}));
   const settled=Promise.allSettled(requests);await started;assert.equal(reads,1);release();
   const results=await settled;
   if(failFirst){assert(results.every(result=>result.status==='rejected'));const retried=await request();assert.equal(await retried.text(),source);assert.equal(reads,2);}
   else{assert(results.every(result=>result.status==='fulfilled'));const responses=results.map(result=>result.value);assert.equal(new Set(responses.map(response=>response.headers.get('etag'))).size,1);for(const response of responses)assert.equal(brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString(),source);await request();assert.equal(reads,1);}
  }finally{release();fsPromises.readFile=originalRead;fsPromises.stat=originalStat;syncBuiltinESMExports();}
 }
});

test('a rebuilt file is not stuck behind an older in-flight version',async t=>{
 const {dir,request,source}=await fixture(t),file=join(dir,'site-assets','index-testhash.js'),target=pathToFileURL(file).href;
 const originalRead=fsPromises.readFile;let reads=0,release,entered;
 const gate=new Promise(resolve=>{release=resolve;}),reading=new Promise(resolve=>{entered=resolve;});
 fsPromises.readFile=async(...args)=>{const bytes=await originalRead(...args);if(args[0]?.href===target&&++reads===1){entered();await gate;}return bytes;};syncBuiltinESMExports();
 try{
  const earlier=request();await reading;await writeFile(file,'newer rebuilt public asset');
  const newer=await request(),newTag=newer.headers.get('etag');assert.equal(await newer.text(),'newer rebuilt public asset');
  release();assert.equal(await (await earlier).text(),source);
  const after=await request();assert.equal(await after.text(),'newer rebuilt public asset');assert.equal(after.headers.get('etag'),newTag);
 }finally{release();fsPromises.readFile=originalRead;syncBuiltinESMExports();}
});
