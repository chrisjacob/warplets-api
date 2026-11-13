import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
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
