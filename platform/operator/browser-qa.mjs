import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {createOperatorApp} from './console.mjs';
import {createLocalServer} from '../server/start.mjs';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {addCampaign,recordStakeRead,submitContent} from '../earn/workflow.mjs';

if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to local installations.');
const db=openDatabase(),now=Date.now(),token=randomBytes(32).toString('base64url');
const wallet=encode58(Buffer.alloc(32,7));
addCampaign(db,{tokenId:'operator-demo',activationMs:now-86400000,originalUnits:'200000'});
recordStakeRead(db,{wallet,tokenId:'operator-demo',observedMs:now-1000,expiresMs:now+1000,microUsd:'10000000',sourceRef:'operator_browser_fixture'});
submitContent(db,{wallet,tokenId:'operator-demo',url:'https://example.org/original',requestKey:'browser-post',nowMs:now});
const server=createLocalServer(createOperatorApp(db,{bootToken:token,clock:()=>now}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
 const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);
 await page.getByLabel('Startup code').fill(token);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('heading',{name:'Content reviews'}).waitFor();
 await page.getByText('operator-demo',{exact:true}).waitFor();
 await page.getByText('Change staffing',{exact:true}).click();
 await page.getByLabel('Minutes available').fill('30');
 await page.getByLabel('Admission limit').fill('50');
 await page.getByLabel('Reason',{exact:true}).fill('Ten reviews in a staffed pilot');
 await page.getByRole('button',{name:'Apply staffing'}).click();
 await page.getByText('1 admitted · 9 places available',{exact:true}).waitFor();
 await page.getByLabel('Score (0–10)').fill('8');
 await page.getByLabel('Decision reason').fill('Specific original contribution');
 await page.getByRole('button',{name:'Publish final score'}).click();
 await page.getByText('Final decision recorded.',{exact:true}).waitFor();
 await page.getByLabel('Queue',{exact:true}).selectOption('reviewed');
 await page.getByText('Final score 8 · Specific original contribution',{exact:true}).waitFor();
 for(const width of [360,390,768,1440]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Operator overflow '+width);
 }
 await page.reload();
 await page.getByRole('heading',{name:'Review capacity'}).waitFor();
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.getByLabel('Startup code').waitFor();
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('operator-session')),null);
 assert.deepEqual(errors,[]);
 assert.equal(db.prepare('SELECT content_score FROM earn_reviews').get().content_score,8);
 console.log('Operator browser passed staffing, final review, session reload, logout and four responsive widths.');
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
}
