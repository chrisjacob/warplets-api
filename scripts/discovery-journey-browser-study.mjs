// Actual Discovery page/router with synthetic fixtures and an isolated browser.
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const output=resolve(process.argv[2]??'');if(!process.argv[2]||!output.startsWith(resolve('.tmp')+sep))throw Error('new_private_output_required');
await mkdir(output);
const base=createRequire(new URL('../app/package.json',import.meta.url)),require=createRequire(base.resolve('wrangler/package.json')),{build}=require('esbuild');
const bundle=await build({entryPoints:['scripts/fixtures/discovery-journey-browser.tsx'],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',loader:{'.svg':'dataurl','.png':'dataurl','.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},outfile:join(output,'lab.js')});
const js=bundle.outputFiles[0].text,css=await readFile('app/src/discovery/discovery.css','utf8');await writeFile(join(output,'lab.js'),js,{flag:'wx'});
const unexpected=[],errors=[],journeys=[],checks=[];
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){unexpected.push(req.method+' '+url.pathname);res.writeHead(405).end();return;}
  if(url.pathname==='/lab.js'){res.writeHead(200,{'content-type':'text/javascript'}).end(js);return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname!=='/discover'&&!/^\/token\/solana\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.pathname)){unexpected.push(url.pathname);res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline Discovery journeys</title><style>*{box-sizing:border-box}body{margin:0;background:#101011}${css}</style><div id="root"></div><script type="module" src="/lab.js"></script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const profile=join(output,'chrome'),chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,readFailure;const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let port;for(let i=0;i<60;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await wait(250);}if(!port)throw Error('isolated_chrome_not_ready');
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),tab=tabs.find(t=>t.type==='page');assert(tab);
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  let id=0;const calls=new Map();
  const send=(method,params={})=>new Promise((r,j)=>{const n=++id,timer=setTimeout(()=>{calls.delete(n);j(Error('cdp_timeout:'+method));},15000);calls.set(n,{r,j,timer});socket.send(JSON.stringify({id:n,method,params}));});
  socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));
    if(m.id&&calls.has(m.id)){const c=calls.get(m.id);clearTimeout(c.timer);calls.delete(m.id);m.error?c.j(Error(JSON.stringify(m.error))):c.r(m.result);return;}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    if(m.method==='Fetch.requestPaused'){
      const {requestId,request}=m.params;
      if(request.url.startsWith(origin+'/'))void send('Fetch.continueRequest',{requestId}).catch(e=>errors.push(String(e)));
      else{unexpected.push(request.url);void send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(e=>errors.push(String(e)));}
    }
  });
  const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  readFailure=()=>evaluate(`({text:document.body?.innerText,requests:window.journeyLab?.requests})`);
  const until=async(expression,ms=15000)=>{const started=performance.now();while(performance.now()-started<ms){if(await evaluate(`Boolean(${expression})`))return;await wait(80);}throw Error('browser_condition_timeout:'+expression);};
  const click=selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing_click_target');e.click()})()`);
  const button=text=>evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e||e.disabled)throw Error('missing_enabled_button');e.click()})()`);
  const discover=async search=>{await send('Page.navigate',{url:origin+'/discover?mode=fixture&'+search});await until(`window.journeyLab?.ready&&document.querySelector('.tenx-candidate,.tenx-discovery-table')`);};
  await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  for(const [index,layout,search] of [[1,'cards',''],[2,'table','q=QA&sort=liquidity&age=all'],[3,'cards','q=Journey&freshness=stale&min_coverage=30'],[4,'table','q=QA&status=excluded&min_liquidity=25000'],[5,'cards','q=Journey&age=all&min_coverage=45']]){
    await discover(`layout=${layout}&${search}`);
    await evaluate(`localStorage.clear()`); // Only this exclusive synthetic origin/profile.
    // Reload so the actual shortlist hook reads the empty synthetic repository.
    await send('Page.reload');await until(`window.journeyLab?.ready&&document.querySelector('.tenx-candidate,.tenx-discovery-table')`);
    const identities=await evaluate(`window.journeyLab.candidates`),first=identities[0].address,second=identities[1].address;
    await click(`[aria-label="Compare mint ${first}"]`);await click(`[aria-label="Compare mint ${second}"]`);
    await until(`new URLSearchParams(location.search).get('compare')?.split(',').length===2`);
    const expected=await evaluate(`location.pathname+location.search`);
    await click(layout==='cards'?'.tenx-candidate h2 a':'.tenx-table-token a');
    await until(`document.querySelector('.tenx-token-heading h1')`);
    assert.equal(await evaluate(`document.querySelector('.tenx-back').getAttribute('href')`),expected);
    assert.equal(await evaluate(`new URLSearchParams(location.search).get('mode')`),'fixture');
    await evaluate(`document.querySelector('.tenx-back').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await until(`document.querySelector('.tenx-candidate,.tenx-discovery-table')`);
    assert.equal(await evaluate(`location.pathname+location.search`),expected);
    await button('Compare saved observations');await until(`document.querySelector('.tenx-comparison-table')`);
    const comparisonText=await evaluate(`document.querySelector('.tenx-comparison-table').textContent`);assert(comparisonText.includes('Unknown'));assert(comparisonText.includes('Qualified organic volume'));
    await click('.tenx-comparison-table th a');await until(`document.querySelector('.tenx-token-heading h1')`);
    assert.equal(await evaluate(`document.querySelector('.tenx-back').getAttribute('href')`),expected+'#compare-tokens');
    await click(`[aria-label="Save mint ${first}"]`);await until(`document.querySelector('[aria-label="Remove saved mint ${first}"]')`);
    await click('.tenx-back');await until(`location.hash==='#compare-tokens'&&document.querySelector('.tenx-candidate,.tenx-discovery-table')`);
    // Search excludes the saved token; reopening must still use its exact mint.
    await evaluate(`(()=>{const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'QA2');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await button('Search');await until(`new URLSearchParams(location.search).get('q')==='QA2'&&document.querySelector('.tenx-candidate h2 a,.tenx-table-token a')?.textContent.includes('Journey token 2')`);
    await click('a[href="#saved-tokens"]');await until(`document.querySelector('#saved-tokens details').open`);
    assert((await evaluate(`document.getElementById('saved-tokens').textContent`)).includes('Outside current results'));
    const savedHref=await evaluate(`document.querySelector('#saved-tokens a').getAttribute('href')`);assert(savedHref.includes(first));
    const reopenExpected=await evaluate(`location.pathname+location.search+'#saved-tokens'`);
    await click('#saved-tokens a');await until(`document.querySelector('.tenx-token-heading h1')`);assert.equal(await evaluate(`document.querySelector('.tenx-back').getAttribute('href')`),reopenExpected);
    await click('.tenx-back');await until(`document.querySelector('#saved-tokens details')?.open`);
    const requests=await evaluate(`window.journeyLab.requests`);assert(requests.every(r=>r.method==='GET'));
    journeys.push({index,layout,initial_search:search,find_inspect_compare_save_reopen:true,keyboard_return:true,selected_mints_preserved:true,off_page_saved_reopen:true,unknown_organic_metrics_preserved:true,read_requests:requests.length,synthetic:true});
  }
  // Failure and direct-link recovery keep a working mode-correct route out.
  await discover('layout=cards');await evaluate(`window.journeyLab.detailFailure=true`);await click('.tenx-candidate h2 a');await until(`document.querySelector('.tenx-back')&&document.querySelector('[role=alert]')`);
  await click('.tenx-back');await until(`document.querySelector('.tenx-candidate')`);checks.push('detail_error_retains_discovery_return');
  const mint=await evaluate(`window.journeyLab.candidates[0].address`);await send('Page.navigate',{url:origin+`/token/solana/${mint}?mode=fixture&returnTo=${encodeURIComponent('https://evil.example/discover')}`});await until(`document.querySelector('.tenx-back')`);
  const safe=await evaluate(`document.querySelector('.tenx-back').getAttribute('href')`);assert(safe.startsWith('/discover?mode=fixture&'));assert(!safe.includes('evil'));checks.push('unsafe_direct_return_falls_back_to_same_mode');
  await click('.tenx-back');await until(`document.querySelector('.tenx-candidate')`);
  const layouts=[];for(const [label,width,height] of [['desktop',1280,900],['mobile',390,844],['reflow',320,900]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate(`window.scrollTo(0,0)`);await wait(150);
    const scroll=await evaluate(`document.documentElement.scrollWidth`);assert(scroll<=width+1);const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,label+'.png'),Buffer.from(shot.data,'base64'),{flag:'wx'});layouts.push({label,width,height,scroll});
  }
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  const report={version:1,scope:'Five scripted synthetic journeys through actual Discovery components; not independent usability, live artwork coverage, live scoring calibration or release acceptance.',journeys,checks,layouts,unexpected_outbound:unexpected,browser_errors:errors,bundle_sha256:createHash('sha256').update(js).digest('hex'),runner_sha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),fixture_sha256:createHash('sha256').update(await readFile('scripts/fixtures/discovery-journey-browser.tsx')).digest('hex'),provider_calls:0,evidence_gates_changed:false,production_flags_changed:false,release_acceptance:false};
  const text=JSON.stringify(report,null,2)+'\n';await writeFile(join(output,'report.json'),text,{flag:'wx'});console.log(JSON.stringify({report:join(output,'report.json'),sha256:createHash('sha256').update(text).digest('hex'),journeys:journeys.length,checks:checks.length,passed:true}));
}catch(error){
  const failure={error:String(error),unexpected,errors,journeys,browser:await readFailure?.().catch(()=>null)};
  await writeFile(join(output,'failure.json'),JSON.stringify(failure,null,2)+'\n',{flag:'wx'});throw error;
}finally{socket?.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
