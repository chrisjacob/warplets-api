import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
let require=createRequire(new URL('./browser-tools/package.json',import.meta.url));
try{require.resolve('playwright')}catch{require=createRequire(new URL('../.tmp/browser-tools/package.json',import.meta.url))}
const {chromium}=require('playwright');
const origin=process.env.STONKLETS_TEST_ORIGIN||'http://127.0.0.1:5199';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});page.on('requestfailed',r=>console.error(r.url(),r.failure()?.errorText));
 await page.route('**/__headline-test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
 import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
 const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {default:Headline}=await import('/src/StonkletNewsHeadline.tsx');await import('/src/index.css');
 const root=createRoot(document.getElementById('root'));window.renderHeadline=(props,width,scale)=>root.render(React.createElement('div',{style:{width:width+'px',transform:'scale('+scale+')',transformOrigin:'top left',fontFamily:'Arial'}},React.createElement(Headline,{url:'https://example.com',publishedAt:'2026-07-29',sector:false,evidence:'test',expanded:false,onHover:()=>{},...props})));
 </script></body></html>`}));
 await page.goto(origin+'/__headline-test');await page.waitForFunction(()=>typeof window.renderHeadline==='function').catch(e=>{throw new Error(e.message+' '+JSON.stringify(errors))});
 let checked=0,shortened=0;
 const titles=['Apple launches iPhone','Strategy acquires Bitcoin and expands its treasury','Final Cut Camera now supports variable aperture on iPhone 18 Pro','This headline has several meaningful announcements ... ... and continues with extensive detail about new launches and much greater adoption across the entire world','Supercalifragilisticexpialidocious product launch with more information for investors'];
 for(const width of [150,190,240,300])for(const expanded of [false,true])for(const metadata of [false,true])for(const scale of [1,1.25])for(const headline of titles){
  await page.evaluate(({headline,width,scale,expanded,metadata})=>window.renderHeadline({headline,expanded,sector:metadata,attribution:metadata?'Yahoo Finance':undefined},width,scale),{headline,width,scale,expanded,metadata});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>{
   const h=document.querySelector('h3'),content=h.querySelector('[data-news-content]'),text=content.querySelector('[data-news-text]'),date=content.querySelector('time');
   const clone=content.cloneNode(true);Object.assign(clone.style,{position:'absolute',width:'100%',height:'auto',visibility:'hidden'});clone.querySelector('[data-news-text]').textContent=text.closest('a').title;h.appendChild(clone);const fullFits=clone.scrollHeight<=parseFloat(getComputedStyle(h).lineHeight)*3+1;clone.remove();
   return {text:text.textContent,fullFits,height:content.scrollHeight,limit:h.clientHeight,date:date.textContent,dateVisible:date.getBoundingClientRect().bottom<=h.getBoundingClientRect().bottom+1,clamp:getComputedStyle(h).webkitLineClamp,sector:content.querySelector('.stonklets-news-sector')?.textContent,attribution:content.querySelector('.stonklets-news-attribution')?.textContent,content:content.textContent};
  });
  const context=JSON.stringify({width,expanded,metadata,scale,headline,result});
  assert(result.height<=result.limit+1,context);assert(result.dateVisible,context);assert.equal(result.date,'29th JUL',context);assert.equal(result.clamp,'none',context);
  if(result.fullFits)assert.equal(result.text,headline,context);else{assert(result.text.endsWith('\u2026'),context);assert(!/[.\u2026]\s*\u2026$/.test(result.text),context);shortened++;}
  assert.equal(result.attribution,undefined,context);assert(!result.content.includes('Yahoo Finance'),context);
  if(metadata)assert.equal(result.sector,'Market news',context);checked++;
 }
 assert.deepEqual(errors,[]);assert(shortened>0);console.log(JSON.stringify({cases:checked,truncated:shortened,browserErrors:errors.length}));
}finally{await browser.close()}
