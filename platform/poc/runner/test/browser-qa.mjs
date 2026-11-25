import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Transaction} from '@solana/web3.js';
import {createRunner} from '../server.mjs';
import {fixture} from './fixture.mjs';

if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to local installations');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const f=fixture(),app=await createRunner({store:f.store,engine:f.engine,mode:'mock',port:0,identity:{commit:'mock-browser-qa',node:process.version},jobs:{start:poc=>({poc,status:'passed'})}});
let browser,signatures=0;
const report={evidenceClass:'local-browser-mock',mainnetTransactions:0,checks:[]};
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Browser and engine are both network-isolated from Solana.
  await page.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  await page.exposeFunction('signMockPacket',array=>{const tx=Transaction.from(Buffer.from(array));assert.equal(tx.feePayer.toBase58(),f.payer.publicKey.toBase58());tx.partialSign(f.payer);signatures++;return [...tx.serialize()];});
  await page.addInitScript(({address,publicKey})=>{
    const account={address,publicKey:new Uint8Array(publicKey),chains:['solana:mainnet'],features:['solana:signTransaction']};
    const wallet={name:'QA mock wallet',version:'1.0.0',icon:'data:image/svg+xml,<svg/>',chains:['solana:mainnet'],accounts:[account],features:{
      'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
      'standard:events':{version:'1.0.0',on:()=>()=>{}},
      'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy'],signTransaction:async({transaction})=>{
        if(window.rejectMock)throw Error('Mock user rejected signing');
        return [{signedTransaction:new Uint8Array(await window.signMockPacket([...transaction]))}];
      }},
    }};
    window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(wallet));
  },{address:f.payer.publicKey.toBase58(),publicKey:[...f.payer.publicKey.toBytes()]});
  await page.goto(app.origin);await page.getByRole('heading',{name:'Disposable POC lab',exact:true}).waitFor();
  assert.match(await page.locator('#network').textContent(),/MOCK QA/);
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByText('Wallet connected.',{exact:false}).waitFor();
  await page.getByRole('button',{name:/P01\s+Disposable original token/}).click();
  await page.getByRole('button',{name:'Prepare original',exact:true}).click();await page.getByRole('button',{name:'Approve in browser wallet',exact:true}).waitFor();
  assert.equal(signatures,0);assert.equal(f.control.sendCount,0);report.checks.push('Preparing never signs or broadcasts');
  await page.evaluate(()=>{window.rejectMock=true;});await page.getByRole('button',{name:'Approve in browser wallet',exact:true}).click();await page.getByText('Mock user rejected signing',{exact:true}).waitFor();assert.equal(f.control.sendCount,0);
  report.checks.push('Wallet rejection does not send');
  await page.evaluate(()=>{window.rejectMock=false;});f.control.finalized=true;
  await page.getByRole('button',{name:'Approve in browser wallet',exact:true}).click();await page.getByText('Transaction finalized. Use Recover to check finality.',{exact:true}).waitFor();assert.equal(signatures,1);assert.equal(f.control.sendCount,1);
  report.checks.push('Explicit wallet signature finalizes and stores evidence');
  await page.reload();await page.getByRole('button',{name:/P01\s+Disposable original token/}).click();assert.equal(await page.getByRole('button',{name:'Prepare original',exact:true}).isDisabled(),true);assert.equal(f.control.sendCount,1);
  report.checks.push('Reload preserves completed action and does not resend');
  await page.getByRole('button',{name:/P09\s+Wallet and marketplace/}).click();await page.getByRole('textbox',{name:'Observation'}).fill('QA mock only. No physical wallet tested.');await page.getByRole('button',{name:'Save observation'}).click();await page.getByText('Observation saved.',{exact:true}).waitFor();assert.equal(f.store.value.notes.length,1);
  report.checks.push('Manual evidence stays separately labelled');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow at '+width);
    if(process.env.SCREENSHOT_DIR){mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'poc-'+width+'.png'),fullPage:true});}
  }
  report.checks.push('1440px and 390px layouts have no overflow');assert.deepEqual(errors,[]);
  report.passed=true;console.log(JSON.stringify(report,null,2));
  if(process.env.SCREENSHOT_DIR)writeFileSync(join(process.env.SCREENSHOT_DIR,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
}finally{await browser?.close();await new Promise(resolve=>app.server.close(resolve));f.store.close();}
