import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { serveSite } from '../serve.mjs';
import { initialPage, renderInitialPage, routeFor } from '../public-pages.mjs';

test('static adapter serves known routes and hashed assets with restrictive CSP; no accidental source serving',async t=>{
  const path=await mkdtemp(join(tmpdir(),'10x-site-'));t.after(()=>rm(path,{recursive:true,force:true}));
  const dist=pathToFileURL(path+'/');
  const request=(pathname,method='GET')=>new Request('http://localhost'+pathname,{method});
  assert.equal(await serveSite(request('/earn'),dist),null);
  await mkdir(join(path,'site-assets'));await writeFile(join(path,'index.html'),'<main>local-build</main>');
  await writeFile(join(path,'site-assets','index-demo.js'),'console.log(1)');
  for(const route of ['/','/markets','/vault','/stake','/earn','/collect']){
    const response=await serveSite(request(route),dist);
    assert.equal(await response.text(),'<main>local-build</main>');
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  }
  assert.equal(await serveSite(request('/src/main.tsx'),dist),null);
  assert.equal((await serveSite(request('/site-assets/missing.js'),dist)).status,404);
  const js=await serveSite(request('/site-assets/index-demo.js','HEAD'),dist);
  assert.match(js.headers.get('cache-control'),/immutable/);assert.equal(await js.text(),'');
});

test('public initial HTML uses anonymous allowlisted reads, meaningful status and escaped share metadata',async()=>{
  const base='http://localhost:4173';
  const market=new URL(base+'/markets/att?unused=secret');
  const requests=[];
  const page=await initialPage(routeFor(market),market,async path=>{
    requests.push(path);
    return Response.json({id:'att',symbol:'ATT<img src=x>',ogSymbol:'OG',status:'active',
      activatedAt:'2026-11-05T00:00:00Z',feeBps:100,attMint:'<mint>',ogMint:'original'});
  });
  const html=renderInitialPage('<head><title>old</title><meta name="description" content="old"></head><!--initial:start-->old<!--initial:end-->',page);
  assert.deepEqual(requests,['/api/v1/markets/att']);
  assert.equal(page.status,200);assert.match(html,/ATT&lt;img src=x&gt; \/ OG/);assert.doesNotMatch(html,/unused=secret|<mint>/);
  assert.match(html,/property="og:image"/);assert.match(html,/rel="canonical" href="http:\/\/localhost:4173\/markets\/att"/);
  const unknown=new URL(base+'/nfts/missing');
  assert.equal((await initialPage(routeFor(unknown),unknown,async()=>new Response(null,{status:404}))).status,404);
  assert.equal((await initialPage(routeFor(unknown),unknown,async()=>new Response(null,{status:500}))).status,503);
  const invalid=new URL(base+'/earn/2026-02-31');
  assert.equal((await initialPage(routeFor(invalid),invalid,()=>{throw Error('unexpected read');})).status,404);
});

test('private routes never call the public renderer with cookies, wallet identifiers or activity queries',async()=>{
  for(const path of ['/vault?asset=travel','/stake?farm=local','/collect?receipt=secret','/earn?awards=1']){
    const url=new URL('http://localhost'+path);let calls=0;
    const page=await initialPage(routeFor(url),url,async()=>{calls++;throw Error('Unexpected private read.');});
    assert.equal(page.status,200);assert.equal(calls,0);assert.match(page.metadata,/noindex, nofollow/);
    assert.doesNotMatch(page.content+page.metadata,/travel|receipt=secret/);
  }
  assert.equal(routeFor(new URL('http://localhost/markets?market=demo')).canonical,'/markets/demo');
  assert.equal(routeFor(new URL('http://localhost/earn?date=2026-10-20')).canonical,'/earn/2026-10-20');
});

test('React chart and summary components render API-supplied values and accessible controls',async t=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const vite=await createServer({root,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
  t.after(()=>vite.close());
  const {FeeChart}=await vite.ssrLoadModule('/src/markets.tsx');
  const curve=renderToStaticMarkup(createElement(FeeChart,{points:[{elapsedSeconds:0,feeBps:8112},{elapsedSeconds:90,feeBps:97}]}));
  assert.match(curve,/81.12%/);assert.match(curve,/0.97%/);
  assert.match(curve,/id="curve-seconds"/);assert.match(curve,/aria-valuetext="0 seconds, 81.12% fee"/);
  const empty=renderToStaticMarkup(createElement(FeeChart,{points:[]}));
  assert.match(empty,/unavailable/);assert.doesNotMatch(empty,/type="range"/);
  const {sol}=await vite.ssrLoadModule('/src/common.tsx');
  assert.equal(sol('18446744073709551615'),'18446744073.709551615 SOL');
});
