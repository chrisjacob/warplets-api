// Read-only lab audit. Uses an already-running synthetic QA app; never signs in or writes data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const origin=process.env.AUDIT_ORIGIN??'http://127.0.0.1:4181';
const directory=process.env.AUDIT_DIR??'work/audit-performance';mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
const routes=['/','/tokens','/participants/4nQTuFuY38vevToXAuMwT3nm4SFVfuRRWMEXRm68JeX9'];
const results=[];
try{for(const width of [390,1280])for(const route of routes){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(30000);
 await page.addInitScript(()=>{
  window.__lab={lcp:0,shifts:[],longTasks:[],events:[]};
  for(const [type,key] of [['largest-contentful-paint','lcp'],['layout-shift','shifts'],['longtask','longTasks'],['event','events']]){
   new PerformanceObserver(list=>{for(const e of list.getEntries()){
    if(key==='lcp')window.__lab.lcp=e.startTime;
    else if(key==='shifts'&&!e.hadRecentInput)window.__lab.shifts.push({at:e.startTime,value:e.value,sources:e.sources?.map(s=>s.node?.className??s.node?.nodeName)});
    else if(key!=='shifts')window.__lab[key].push({at:e.startTime,duration:e.duration,interactionId:e.interactionId});
   }}).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});
  }
 });
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:200000,uploadThroughput:93750});
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 for(const cache of ['cold','warm']){
  const errors=[],requests=[];const error=e=>errors.push(e.message),response=r=>requests.push({path:new URL(r.url()).pathname,status:r.status(),encoding:r.headers()['content-encoding']??'identity',cache:r.headers()['cache-control']});
  page.on('pageerror',error);page.on('response',response);
  assert.equal((await page.goto(origin+route)).status(),200);await page.waitForLoadState('networkidle');
  await page.locator('.performance-row, .profile-tokens article').first().waitFor();await page.locator('#view[aria-busy=false]').waitFor();
  const initial=await page.evaluate(()=>{
   let max=0,total=0,start=0,previous=0;
   for(const s of window.__lab.shifts){if(s.at-previous>1000||s.at-start>5000){total=0;start=s.at;}total+=s.value;max=Math.max(max,total);previous=s.at;}
   return {...window.__lab,cls:max,paint:performance.getEntriesByType('paint').map(e=>({name:e.name,at:e.startTime})),resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,bytes:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize,duration:e.duration})),domNodes:document.querySelectorAll('*').length,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  if(route==='/tokens'){await page.getByRole('button',{name:'Market',exact:true}).click();await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'Next ranks',exact:true}).click();}
  if(route.startsWith('/participants')){await page.getByRole('button',{name:'Market',exact:true}).click();await page.getByRole('button',{name:'Next tokens',exact:true}).click();await page.waitForLoadState('networkidle');}
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const events=await page.evaluate(()=>window.__lab.events.filter(e=>e.interactionId));
  assert.deepEqual(errors,[]);assert.equal(initial.overflow,false);
  results.push({width,route,cache,...initial,events,requests});
  if(cache==='cold')await page.screenshot({path:directory+'/'+width+'-'+(route==='/'?'home':route.split('/')[1])+'.png'});
  page.off('pageerror',error);page.off('response',response);
 }await context.close();
}}finally{await browser.close();}
writeFileSync(directory+'/results.json',JSON.stringify({at:new Date().toISOString(),origin,browser:browser.version(),scope:'read-only synthetic local lab; not field INP or hosted capacity',conditions:{latencyMs:80,downloadBytesPerSecond:200000,cpuSlowdown:4},results},null,2));
console.log(JSON.stringify(results.map(r=>({width:r.width,route:r.route,cache:r.cache,lcp:Math.round(r.lcp),cls:r.cls,resourceBytes:r.resources.reduce((n,a)=>n+a.bytes,0),longTaskMs:Math.round(r.longTasks.reduce((n,a)=>n+a.duration,0)),maxInteractionMs:Math.max(0,...r.events.map(e=>e.duration))}))));
