// Isolated headless browser checks of actual components; no app bindings/keys.
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const output=resolve(process.argv[2]??'');if(!process.argv[2]||!output.startsWith(resolve('.tmp')+sep))throw Error('new_private_output_required');
await mkdir(output); // Exclusive, never overwrite prior evidence or a browser profile.
const base=createRequire(new URL('../app/package.json',import.meta.url)),require=createRequire(base.resolve('wrangler/package.json')),{build}=require('esbuild');
const bundle=await build({entryPoints:['scripts/fixtures/discovery-artwork-browser.tsx'],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},outfile:join(output,'lab.js')});
const js=bundle.outputFiles[0].text,css=await readFile('app/src/discovery/discovery.css','utf8');await writeFile(join(output,'lab.js'),js,{flag:'wx'});
const requests=[],pending=[],unexpected=[],errors=[],cases=[];let metadataMode='partial',phase='initial';
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(url.pathname==='/lab.js'){res.writeHead(200,{'content-type':'text/javascript'}).end(js);return;}
  if(url.pathname==='/api/10x/artwork'){
    const addresses=url.searchParams.get('addresses')?.split(',')??[];assert(addresses.length>0&&addresses.length<=100);
    requests.push({phase,count:addresses.length,addresses,mode:metadataMode});
    if(metadataMode==='stall'){pending.push(res);return;}
    if(metadataMode==='partial'&&requests.filter(r=>r.phase===phase).length%2===0){res.writeHead(503).end('{}');return;}
    const data=Object.fromEntries(addresses.map(address=>[address,{image_url:'https://cdn.dexscreener.com/good.svg',metadata_uri:null,creation_hash:'a'.repeat(64),metadata_hash:null,fetched_at:'2026-10-22T01:00:00Z',error:null}]));
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({data}));return;
  }
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname!=='/'){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src https://cdn.dexscreener.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline artwork lab</title><style>*{box-sizing:border-box}body{margin:0;background:#101011}${css}.artwork-cases{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));gap:12px}.artwork-cases>section{border:1px solid #34443b;padding:12px}button{min-height:44px;max-width:100%}output{display:none}h1{overflow-wrap:anywhere}</style><div id="root"></div><script type="module" src="/lab.js"></script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const profile=join(output,'chrome'),chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket;const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let port;for(let i=0;i<60;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await wait(250);}if(!port)throw Error('isolated_chrome_not_ready');
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),tab=tabs.find(t=>t.type==='page');assert(tab);
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  let id=0;const calls=new Map();
  const send=(method,params={})=>new Promise((r,j)=>{const n=++id,timer=setTimeout(()=>{calls.delete(n);j(Error('cdp_timeout:'+method));},15000);calls.set(n,{r,j,timer});socket.send(JSON.stringify({id:n,method,params}));});
  const imageRequests=[],stalled=[];
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#27563a"/><circle cx="32" cy="32" r="19" fill="#8cf5ad"/><path d="M20 32l8 8 16-18" fill="none" stroke="#163a24" stroke-width="5"/></svg>').toString('base64');
  socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));
    if(m.id&&calls.has(m.id)){const c=calls.get(m.id);clearTimeout(c.timer);calls.delete(m.id);m.error?c.j(Error(JSON.stringify(m.error))):c.r(m.result);return;}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request}=m.params,url=new URL(request.url);
    void(async()=>{
      if(request.url.startsWith(origin+'/')){await send('Fetch.continueRequest',{requestId});return;}
      if(url.origin==='https://cdn.dexscreener.com'){
        imageRequests.push({phase,path:url.pathname,at_ms:performance.now()});
        if(url.pathname.includes('stall')){stalled.push(requestId);return;}
        await send('Fetch.fulfillRequest',{requestId,responseCode:url.pathname.includes('broken')?404:200,responseHeaders:[{name:'Content-Type',value:url.pathname.includes('invalid')?'image/png':'image/svg+xml'},{name:'Cache-Control',value:'no-store'}],body:url.pathname.includes('broken')?'':url.pathname.includes('invalid')?Buffer.from('not an image').toString('base64'):svg});return;
      }
      unexpected.push(request.url);await send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
    })().catch(e=>errors.push(String(e)));
  });
  const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  const until=async(expression,ms=15000)=>{const started=performance.now();while(performance.now()-started<ms){if(await evaluate(expression))return;await wait(100);}throw Error('browser_condition_timeout:'+expression);};
  const state=id=>evaluate(`document.querySelector('#${id} [data-artwork-state]')?.dataset.artworkState`);
  const scroll=id=>evaluate(`document.getElementById('${id}').scrollIntoView({block:'center'})`);
  await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`const originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){if(this.src.includes('late-decode'))return new Promise(resolve=>{window.finishOldDecode=resolve});return originalDecode.call(this);};`});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin+'/'});
  await until(`document.querySelector('#good [data-artwork-state]')?.dataset.artworkState==='loaded'`);
  await until(`document.querySelector('#fallback [data-artwork-state]')?.dataset.artworkState==='loaded'`);await until(`document.querySelector('#invalid-data [data-artwork-state]')?.dataset.artworkState==='loaded'`);await until(`document.querySelector('#all-broken [data-artwork-state]')?.dataset.artworkState==='unavailable'`);assert.equal(await state('missing'),'unavailable');assert.equal(await state('unsafe'),'unavailable');
  cases.push({case:'primary_decode_error_fallback_missing_unsafe',passed:true});
  const before=await evaluate(`(()=>{const r=document.querySelector('#stalled [data-artwork-state]').getBoundingClientRect();return {width:r.width,height:r.height}})()`);
  await until(`document.querySelector('#stalled [data-artwork-state]')?.dataset.artworkState==='loaded'`,12000);
  await until(`document.querySelector('#late-decode [data-artwork-state]')?.dataset.artworkState==='loaded'`,12000);
  await evaluate(`window.finishOldDecode?.()`);await wait(100);
  assert((await evaluate(`document.querySelector('#late-decode img').src`)).endsWith('/fallback.svg'));
  assert.deepEqual(await evaluate(`(()=>{const r=document.querySelector('#stalled [data-artwork-state]').getBoundingClientRect();return {width:r.width,height:r.height}})()`),before);
  cases.push({case:'stalled_fetch_decode_deadline_late_result_and_stable_frame',passed:true});
  assert.equal(await state('offscreen'),'loading');assert(!imageRequests.some(r=>r.path==='/fallback.svg'&&r.phase==='offscreen'));
  phase='offscreen';const shown=performance.now();await scroll('offscreen');await until(`document.querySelector('#offscreen [data-artwork-state]')?.dataset.artworkState==='loaded'`,12000);assert(performance.now()-shown>6500);
  cases.push({case:'offscreen_deadline_starts_near_viewport',passed:true});
  await scroll('reset');await evaluate(`document.getElementById('image-reset').click()`);await until(`document.querySelector('#reset [data-artwork-state]')?.dataset.artworkState==='loaded'`);cases.push({case:'new_source_resets_failed_attempts',passed:true});
  assert.equal(requests.filter(r=>r.phase==='initial').length,2);assert(requests.every(r=>r.count<=100));
  await until(`!document.getElementById('metadata-state').textContent.includes('pending')`);
  const partial=await evaluate(`JSON.parse(document.getElementById('metadata-state').textContent)`);assert.equal(Object.values(partial).filter(v=>v==='missing').length,100);assert.equal(Object.values(partial).filter(v=>v.includes('https:')).length,100);cases.push({case:'deduplicated_200_addresses_two_partial_batches',passed:true});
  metadataMode='success';phase='recovery';await evaluate(`document.getElementById('metadata-reload').click()`);await until(`Object.values(JSON.parse(document.getElementById('metadata-state').textContent)).every(v=>v.includes('https:'))`);
  await evaluate(`document.querySelector('#saved-tokens details').open=true`);await scroll('saved-tokens');await until(`document.querySelector('#saved-tokens [data-artwork-state]')?.dataset.artworkState==='loaded'&&document.getElementById('saved-open-state').dataset.open==='true'`);assert((await evaluate(`document.getElementById('saved-tokens').textContent`)).includes('Outside current results'));cases.push({case:'saved_outside_results_renders_cached_artwork',passed:true});
  metadataMode='stall';phase='preserve';await evaluate(`document.getElementById('metadata-prune').click()`);for(let i=0;i<100&&requests.filter(r=>r.phase==='preserve').length<2;i++)await wait(25);assert.equal(requests.filter(r=>r.phase==='preserve').length,2);
  await wait(10500);const retained=await evaluate(`Object.values(JSON.parse(document.getElementById('metadata-state').textContent))`);assert.equal(retained.length,199);assert(retained.every(v=>v.includes('https:')));cases.push({case:'metadata_timeout_preserves_prior_success_for_still_selected_mints',passed:true});
  metadataMode='stall';phase='timeout';await evaluate(`document.getElementById('metadata-reload').click()`);await until(`document.getElementById('metadata-state').textContent.includes('pending')`);await until(`!document.getElementById('metadata-state').textContent.includes('pending')`,13000);assert.equal(await evaluate(`Object.values(JSON.parse(document.getElementById('metadata-state').textContent)).every(v=>v==='missing')`),true);cases.push({case:'metadata_deadline_ends_loading_without_provider_calls',passed:true});
  metadataMode='stall';phase='stale';await evaluate(`document.getElementById('metadata-reload').click()`);await until(`document.getElementById('metadata-state').textContent.includes('pending')`);
  for(let i=0;i<100&&requests.filter(r=>r.phase==='stale').length<2;i++)await wait(25);assert.equal(requests.filter(r=>r.phase==='stale').length,2);
  metadataMode='success';phase='changed';await evaluate(`document.getElementById('metadata-switch').click()`);await until(`Object.values(JSON.parse(document.getElementById('metadata-state').textContent)).length===1&&!document.getElementById('metadata-state').textContent.includes('pending')`);assert.equal(requests.filter(r=>r.phase==='changed').length,1);cases.push({case:'selection_change_aborts_previous_request_identity',passed:true});
  const layouts=[];for(const [label,width,height] of [['desktop',1280,900],['mobile',390,844],['reflow',320,900],['zoom_equivalent',640,450]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate(`window.scrollTo(0,0)`);await wait(150);
    const metrics=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,images:[...document.querySelectorAll('[data-artwork-state]')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0}).map(e=>({label:e.getAttribute('aria-label'),state:e.dataset.artworkState,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))})`);
    assert(metrics.scroll<=width+1);const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,label+'.png'),Buffer.from(shot.data,'base64'),{flag:'wx'});layouts.push({label,...metrics});
  }
  await evaluate(`document.getElementById('image-reset').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert(await evaluate(`document.activeElement?.tagName==='BUTTON'`));cases.push({case:'keyboard_focus_and_320px_reflow',passed:true});
  await scroll('compact-missing');
  assert(await evaluate(`Array.from(document.querySelectorAll('#compact-missing .tenx-artwork-frame')).every(frame=>{const outer=frame.getBoundingClientRect();return outer.width===48&&Array.from(frame.querySelectorAll('.tenx-artwork-placeholder>span,.tenx-artwork-placeholder>small')).every(child=>{const r=child.getBoundingClientRect();return r.top>=outer.top&&r.bottom<=outer.bottom&&r.left>=outer.left&&r.right<=outer.right;});})`));
  cases.push({case:'compact_card_and_saved_unavailable_labels_fit_48px_frames',passed:true});
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  const report={version:1,scope:'Synthetic rendered-component lab; not live artwork coverage, full journey acceptance or independent usability testing.',cases,layouts,metadata_requests:requests.map(({addresses,...r})=>r),image_requests:imageRequests,unexpected_outbound:unexpected,browser_errors:errors,bundle_sha256:createHash('sha256').update(js).digest('hex'),provider_calls:0,score_changes:false,release_acceptance:false,free_acceptance:false};
  const text=JSON.stringify(report,null,2)+'\n';await writeFile(join(output,'report.json'),text,{flag:'wx'});console.log(JSON.stringify({report:join(output,'report.json'),sha256:createHash('sha256').update(text).digest('hex'),cases:cases.length,passed:true}));
}finally{
  socket?.close();chrome.kill();for(const res of pending)res.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));
}
