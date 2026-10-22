// Dated saved-live image measurement. No token providers, bindings or keys.
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [input,pin,directory,permission]=process.argv.slice(2),output=resolve(directory??'');
if(!input||!pin||!directory||permission!=='--allow-image-network'||!output.startsWith(resolve('.tmp')+sep))throw Error('pinned_input_new_private_output_and_explicit_image_network_required');
await mkdir(output);
const base=createRequire(new URL('../app/package.json',import.meta.url)),require=createRequire(base.resolve('wrangler/package.json')),{build}=require('esbuild'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const admission=await build({entryPoints:['scripts/discovery-artwork-coverage.ts'],bundle:true,write:false,format:'esm',platform:'node',outfile:join(output,'admission.mjs')});
await writeFile(join(output,'admission.mjs'),admission.outputFiles[0].text,{flag:'wx'});
const {admitArtworkCohort,summarizeArtworkCoverage}=await import(pathToFileURL(join(output,'admission.mjs')).href);
const admitted=admitArtworkCohort(await readFile(join(input,'manifest.json'),'utf8'),await readFile(join(input,'candidates.json'),'utf8'),await readFile(join(input,'artwork.json'),'utf8'),pin),entries=admitted.entries;
const bundle=await build({entryPoints:['scripts/fixtures/discovery-artwork-coverage-browser.tsx'],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},outfile:join(output,'lab.js')});
const js=bundle.outputFiles[0].text,css=await readFile('app/src/discovery/discovery.css','utf8');await writeFile(join(output,'lab.js'),js,{flag:'wx'});
const sourceFiles={runner_sha256:'scripts/discovery-artwork-coverage-study.mjs',fixture_sha256:'scripts/fixtures/discovery-artwork-coverage-browser.tsx',admission_source_sha256:'scripts/discovery-artwork-coverage.ts',renderer_sha256:'app/src/discovery/TokenArtwork.tsx',css_sha256:'app/src/discovery/discovery.css',image_policy_sha256:'discovery/src/images.ts'},sourcePins=Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(async([key,path])=>[key,sha(await readFile(path))])));
const allowed=new Map();for(const e of entries)for(const url of e.sources)allowed.set(url,(allowed.get(url)??0)+1);
const origins=[...new Set([...allowed.keys()].map(url=>new URL(url).origin))],unexpected=[],errors=[],requests=[],responses=[],networkFailures=[],rows=[],pages=[];
const networkURLs=new Map();
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){unexpected.push({reason:'local_method',path:url.pathname});res.writeHead(405).end();return;}
  if(url.pathname==='/lab.js'){res.writeHead(200,{'content-type':'text/javascript'}).end(js);return;}
  if(url.pathname==='/cohort.json'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(entries));return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname!=='/'){unexpected.push({reason:'local_path',path:url.pathname});res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','content-security-policy':`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src ${origins.join(' ')}; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`}).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved live artwork measurement</title><style>*{box-sizing:border-box}body{margin:0;background:#101011}${css}#gallery{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}#gallery article{min-height:160px;padding:12px}#gallery h2{font-size:15px;overflow-wrap:anywhere;min-width:0}#gallery .tenx-candidate-heading{gap:8px}#gallery small.tenx-address{display:block;margin-top:12px;font-size:10px;overflow-wrap:anywhere}</style><div id="root"></div><script type="module" src="/lab.js"></script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const started=new Date().toISOString(),profile=join(output,'chrome'),chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,readFailure,currentPage=0;const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let port;for(let i=0;i<60;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await wait(250);}if(!port)throw Error('isolated_chrome_not_ready');
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),tab=tabs.find(t=>t.type==='page');assert(tab);
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  let id=0;const calls=new Map();
  const send=(method,params={})=>new Promise((r,j)=>{const n=++id,timer=setTimeout(()=>{calls.delete(n);j(Error('cdp_timeout:'+method));},15000);calls.set(n,{r,j,timer});socket.send(JSON.stringify({id:n,method,params}));});
  socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));
    if(m.id&&calls.has(m.id)){const c=calls.get(m.id);clearTimeout(c.timer);calls.delete(m.id);m.error?c.j(Error(JSON.stringify(m.error))):c.r(m.result);return;}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    if(m.method==='Network.requestWillBeSent'&&m.params.type==='Image')networkURLs.set(m.params.requestId,m.params.request.url);
    if(m.method==='Network.responseReceived'&&m.params.type==='Image')responses.push({url:m.params.response.url,status:m.params.response.status,mime:m.params.response.mimeType,from_disk_cache:m.params.response.fromDiskCache??false});
    if(m.method==='Network.loadingFailed'&&m.params.type==='Image')networkFailures.push({url:networkURLs.get(m.params.requestId)??null,error:m.params.errorText,blocked_reason:m.params.blockedReason??null});
    if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request,resourceType}=m.params;
    void(async()=>{
      if(request.url.startsWith(origin+'/')){await send('Fetch.continueRequest',{requestId});return;}
      const maximum=allowed.get(request.url)??0,used=requests.filter(r=>r.url===request.url).length;
      if(resourceType==='Image'&&request.method==='GET'&&maximum>used){
        requests.push({page:currentPage,url:request.url,at:new Date().toISOString()});
        // Fresh anonymous profile plus explicit credential/referrer exclusion.
        const headers=Object.entries(request.headers).filter(([name])=>!['cookie','authorization','proxy-authorization','referer'].includes(name.toLowerCase())).map(([name,value])=>({name,value:String(value)}));
        await send('Fetch.continueRequest',{requestId,headers});return;
      }
      unexpected.push({reason:maximum?'source_attempt_bound':'unadmitted_image_or_redirect',url:request.url,resourceType});await send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
    })().catch(e=>errors.push(String(e)));
  });
  const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  readFailure=()=>evaluate(`window.artworkCoverage?.snapshot()`);
  const until=async(expression,ms=15000)=>{const started=performance.now();while(performance.now()-started<ms){if(await evaluate(`Boolean(${expression})`))return;await wait(100);}throw Error('browser_condition_timeout:'+expression);};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin+'/'});
  for(let page=0;page<Math.ceil(entries.length/12);page++){
    currentPage=page;if(page)await evaluate(`window.artworkCoverage.setPage(${page})`);
    await until(`window.artworkCoverage?.ready&&window.artworkCoverage.page===${page}&&window.artworkCoverage.snapshot().every(r=>r.visible)`);
    const maximum=Math.max(...entries.slice(page*12,(page+1)*12).map(e=>e.sources.length));
    await until(`window.artworkCoverage.snapshot().every(r=>r.state!=='loading')`,maximum*8000+5000);
    const batch=await evaluate(`window.artworkCoverage.snapshot()`);rows.push(...batch);pages.push({page:page+1,visible:batch.length,decoded:batch.filter(r=>r.state==='loaded').length,unavailable:batch.filter(r=>r.state==='unavailable').length});
    if(page===0){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'first-page.png'),Buffer.from(shot.data,'base64'),{flag:'wx'});}
    console.log(JSON.stringify({page:page+1,total_pages:Math.ceil(entries.length/12),visible:batch.length,decoded:batch.filter(r=>r.state==='loaded').length}));
  }
  assert.deepEqual(errors,[]);
  for(const [key,path] of Object.entries(sourceFiles))assert.equal(sourcePins[key],sha(await readFile(path)),'study_source_changed_during_measurement');
  const summary=summarizeArtworkCoverage(entries,rows),report={version:1,scope:'Dated saved-live reference rendering in a bounded gallery; not current full-app visibility, token authenticity, scoring qualification, independent usability or release acceptance.',started_at:started,finished_at:new Date().toISOString(),input_manifest_sha256:pin,cohort_scored_at:admitted.manifest.cohort_scored_at,cohort_source_as_of:admitted.manifest.cohort_source_as_of,artwork_received_at:admitted.manifest.artwork_received_at,summary,pages,rows,image_asset_requests:requests,image_responses:responses,image_network_failures:networkFailures,blocked_requests:unexpected,browser_errors:errors,...sourcePins,admission_bundle_sha256:sha(admission.outputFiles[0].text),bundle_sha256:sha(js),provider_collection:0,live_database_writes:0,evidence_qualified:false,scoring_changed:false,release_acceptance:false,free_serving_acceptance:false};
  const text=JSON.stringify(report,null,2)+'\n';await writeFile(join(output,'report.json'),text,{flag:'wx'});console.log(JSON.stringify({report:join(output,'report.json'),sha256:sha(text),summary,blocked_requests:unexpected.length,passed:true}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),errors,unexpected,pages,rows,browser:await readFailure?.().catch(()=>null)},null,2)+'\n',{flag:'wx'});throw error;
}finally{socket?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
