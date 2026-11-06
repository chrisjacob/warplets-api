import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {createOperatorApp} from './console.mjs';
import {createLocalServer} from '../server/start.mjs';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {addCampaign,recordStakeRead,submitContent} from '../earn/workflow.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';

if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to local installations.');
const db=openDatabase(),token=randomBytes(32).toString('base64url');let now=Date.parse(new Date().toISOString().slice(0,10)+'T12:00:00Z');
const kinds=['ops.configure-workload.v1','ops.change-scope.v1','earn.final-review.v1'],wallet=encode58(Buffer.alloc(32,7));
db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-browser-operator','operations');
db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-browser-operator','earn-review');
addCampaign(db,{tokenId:'operator-demo',activationMs:now-86400000,originalUnits:'200000'});
recordStakeRead(db,{wallet,tokenId:'operator-demo',observedMs:now-1000,expiresMs:now+1000,microUsd:'10000000',sourceRef:'operator_browser_fixture'});
submitContent(db,{wallet,tokenId:'operator-demo',url:'https://example.org/original',requestKey:'browser-post',nowMs:now});
const baselineAuditEvents=db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n;
let handler=createOperatorApp(db,{bootToken:token,clock:()=>now,operatorId:'synthetic-browser-operator',allowedKinds:kinds});
const server=createLocalServer(request=>handler(request));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,{chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),screens=process.env.OPERATOR_SCREENSHOTS??'work/b12-operator';
await mkdir(screens,{recursive:true});let browser,readServer;
try{
 browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
 const page=await browser.newPage({viewport:{width:360,height:900}}),errors=[],executions=[];let drop=true,dropReview=false,corruptPreview=false,capturedJournal;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
  if(url.pathname==='/ops/commands/preview'&&corruptPreview){corruptPreview=false;const response=await route.fetch();assert.equal(response.status(),200);const body=await response.json();body.summary.score=9;return route.fulfill({response,body:JSON.stringify(body)});}
  if(url.pathname==='/ops/commands/execute'){
   executions.push({body:request.postData(),digest:request.headers()['x-operator-preview']});
   if(drop||dropReview&&JSON.parse(request.postData()).operationKind==='earn.final-review.v1'){drop=false;dropReview=false;const response=await route.fetch();assert.equal(response.status(),200);return route.abort('failed');}
  }
  return route.continue();
 });
 await page.goto(origin);await page.getByLabel('Startup code').fill(token);await page.getByLabel('Startup code').press('Enter');
 await page.getByText('operator-demo',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Publish final score'}).count(),0);
 await page.getByRole('button',{name:'Preview final review',exact:true}).waitFor();await page.getByText('Held pricing observations: 0. Held evidence is separate from content rejection.',{exact:true}).waitFor();
 for(const [index,width] of [360,390,768,1440].entries()){
  await page.setViewportSize({width,height:900});now+=1000;
  if(!await page.locator('details').evaluate(n=>n.open))await page.getByText('Change staffing',{exact:true}).click();
  await page.getByLabel('Minutes available').fill(String(30+index*3));await page.getByLabel('Admission limit').fill('50');await page.getByLabel('Staffing reason').fill('Synthetic staffed pilot '+width);
  const before=db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n;
  await page.getByRole('button',{name:'Preview staffing',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Review local change'}).waitFor();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,before,'preview must not write');assert.equal(await page.locator('#preview-title').evaluate(n=>n===document.activeElement),true);
  await page.getByRole('button',{name:'Confirm local change',exact:true}).click();
  if(index===0){
   await page.getByText(/^Outcome not confirmed:/).waitFor();assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,before+1,'negative-only response loss occurs after real commit');
   assert.equal(await page.getByLabel('Minutes available').isDisabled(),true);capturedJournal=await page.evaluate(()=>sessionStorage.getItem('operator-command'));now+=7200000;await page.reload();await page.getByLabel('Startup code').waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('operator-command')),capturedJournal);assert.equal(await page.locator('#preview-details').textContent(),'');const freshCode=randomBytes(32).toString('base64url');handler=createOperatorApp(db,{bootToken:freshCode,clock:()=>now,operatorId:'synthetic-browser-operator',allowedKinds:kinds});await page.getByLabel('Startup code').fill(freshCode);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Retry exact command',exact:true}).waitFor();
   await page.getByRole('button',{name:'Retry exact command',exact:true}).click();await page.getByText('Local change confirmed from its existing receipt.',{exact:true}).waitFor();assert.deepEqual(executions[1],executions[0]);
  }else await page.getByText('Local change committed with an audit receipt.',{exact:true}).waitFor();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,before+1,'exact retry has one audit child');
  await page.getByText('1 admitted · '+(9+index)+' places available',{exact:true}).waitFor();
  now+=1000;await page.getByLabel('Scope',{exact:true}).selectOption('optional-refresh');await page.getByLabel('Action',{exact:true}).selectOption(index%2===0?'true':'false');await page.getByLabel('Scope reason').fill('Synthetic scoped pause '+width);await page.getByLabel('Evidence reference',{exact:true}).fill('fixture/operator-browser/'+width);
  await page.getByRole('button',{name:'Preview scope change',exact:true}).click();await page.getByRole('heading',{name:'Review local change'}).waitFor();
  await page.screenshot({path:screens+'/preview-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:'Confirm local change',exact:true}).click();await page.getByText('Local change committed with an audit receipt.',{exact:true}).waitFor();
  assert.equal(db.prepare('SELECT paused FROM ops_scope_log WHERE scope=? ORDER BY at_ms DESC LIMIT 1').get('optional-refresh').paused,index%2===0?1:0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Operator overflow '+width);
  await page.reload();await page.getByRole('heading',{name:'Review capacity'}).waitFor();
 }
 // Negative-only concurrent configuration correction makes an old preview stale.
 now+=1000;await page.getByText('Change staffing',{exact:true}).click();await page.getByLabel('Minutes available').fill('33');await page.getByLabel('Staffing reason').fill('Synthetic stale preview');await page.getByRole('button',{name:'Preview staffing',exact:true}).click();await page.getByRole('heading',{name:'Review local change'}).waitFor();
 db.prepare('UPDATE app_operator_scopes SET revision=revision+1 WHERE operator=?').run('synthetic-browser-operator');
 await page.getByRole('button',{name:'Confirm local change',exact:true}).click();await page.getByRole('button',{name:'Discard rejected command',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Retry exact command'}).isDisabled(),true);await page.getByRole('button',{name:'Discard rejected command'}).click();
 // Real final moderation uses the same preview and retained exact-request flow.
 now+=1000;await page.getByLabel('Score (0–10)').fill('8');await page.getByLabel('Review reason',{exact:true}).fill('Specific original contribution');await page.getByLabel('Review evidence reference',{exact:true}).fill('fixture/operator-review/original');corruptPreview=true;await page.getByRole('button',{name:'Preview final review',exact:true}).click();await page.getByText('Preview identity mismatch.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('operator-command')),null);await page.getByRole('button',{name:'Preview final review',exact:true}).click();await page.getByRole('heading',{name:'Review local change'}).waitFor();
 const reviewJournal=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('operator-command')));assert.equal(reviewJournal.request.requestKey,reviewJournal.request.input.submissionId);assert.equal(reviewJournal.preview.summary.final,true);assert.notEqual(reviewJournal.preview.confirmationDigest,reviewJournal.preview.requestDigest);assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);
 const localPost=async(path,body,digest)=>page.evaluate(async({path,body,digest})=>{const response=await fetch('/ops/commands/'+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+sessionStorage.getItem('operator-session'),...(digest?{'x-operator-preview':digest}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},{path,body,digest});
 const changedRevision=structuredClone(reviewJournal.request);changedRevision.expectedRevisions.control=String(Number(changedRevision.expectedRevisions.control)+1);assert.equal((await localPost('execute',changedRevision,reviewJournal.preview.confirmationDigest)).status,409,'confirmation binds reviewed revisions independently of receipt identity');
 for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:screens+'/review-preview-'+width+'.png',fullPage:true});}
 dropReview=true;await page.getByRole('button',{name:'Confirm local change',exact:true}).click();await page.getByText(/^Outcome not confirmed:/).waitFor();assert.equal(db.prepare('SELECT content_score FROM earn_reviews').get().content_score,8);await page.reload();await page.getByRole('button',{name:'Retry exact command',exact:true}).click();await page.getByText('Local change confirmed from its existing receipt.',{exact:true}).waitFor();assert.deepEqual(executions.at(-1),executions.at(-2),'review replay retains exact body/key/confirmation');
 await page.getByLabel('Queue',{exact:true}).selectOption('reviewed');await page.getByText('Final score 8 · Specific original contribution',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Preview final review'}).count(),0);
 const current=await page.evaluate(async()=>await(await fetch('/ops/status',{headers:{authorization:'Bearer '+sessionStorage.getItem('operator-session')}})).json()),conflicting={...reviewJournal.request,expectedRevisions:current.expectedRevisions,input:{...reviewJournal.request.input,score:9}};const conflictPreview=await localPost('preview',conflicting);assert.equal(conflictPreview.status,200);assert.equal((await localPost('execute',conflicting,conflictPreview.body.confirmationDigest)).status,409);assert.equal(db.prepare('SELECT content_score FROM earn_reviews').get().content_score,8);assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,baselineAuditEvents+9);
 // Simulated pre-upgrade journal resolves only through the real read-only receipt route.
 const legacyJournal=JSON.parse(capturedJournal);delete legacyJournal.preview.confirmationDigest;await page.evaluate(value=>sessionStorage.setItem('operator-command',JSON.stringify(value)),legacyJournal);await page.reload();await page.getByRole('button',{name:'Check original receipt',exact:true}).waitFor();const beforeReceiptCheck=executions.length;await page.getByRole('button',{name:'Check original receipt',exact:true}).click();await page.getByText('Local change confirmed from its existing receipt.',{exact:true}).waitFor();assert.equal(executions.length,beforeReceiptCheck,'legacy receipt lookup never executes');
 legacyJournal.request.requestKey+='-missing';await page.evaluate(value=>sessionStorage.setItem('operator-command',JSON.stringify(value)),legacyJournal);await page.reload();await page.getByRole('button',{name:'Check original receipt',exact:true}).click();await page.getByText(/^Outcome not confirmed:/).waitFor();assert.notEqual(await page.evaluate(()=>sessionStorage.getItem('operator-command')),null);assert.equal(executions.length,beforeReceiptCheck,'missing legacy receipt stays held without writes');
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByLabel('Startup code').waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('operator-session')),null);assert.equal(await page.evaluate(()=>sessionStorage.getItem('operator-command')),null);assert.equal(await page.getByLabel('Startup code').evaluate(n=>n===document.activeElement),true);
 const readToken=randomBytes(32).toString('base64url');readServer=createLocalServer(createOperatorApp(db,{bootToken:readToken,clock:()=>now,operatorId:'synthetic-read-only'}));await new Promise(resolve=>readServer.listen(0,'127.0.0.1',resolve));const readOrigin='http://127.0.0.1:'+readServer.address().port,reader=await browser.newPage();await reader.route('**/*',route=>new URL(route.request().url()).origin===readOrigin?route.continue():route.abort());await reader.goto(readOrigin);await reader.getByLabel('Startup code').waitFor();await reader.evaluate(value=>sessionStorage.setItem('operator-command',value),capturedJournal);await reader.getByLabel('Startup code').fill(readToken);await reader.getByRole('button',{name:'Sign in',exact:true}).click();await reader.getByText('Staffing commands are unavailable for this session.',{exact:true}).waitFor();await reader.getByText('Change staffing',{exact:true}).click();assert.equal(await reader.getByRole('button',{name:'Preview staffing'}).isDisabled(),true);assert.equal(await reader.getByRole('button',{name:'Preview scope change'}).isDisabled(),true);
 assert.equal(await reader.evaluate(()=>sessionStorage.getItem('operator-command')),null,'different operator cannot restore prior private command');assert.equal(await reader.locator('#preview-details').textContent(),'');assert.deepEqual(errors,[]);assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,baselineAuditEvents+9);verifyConfigChain(db);
 console.log(JSON.stringify({passed:true,widths:[360,390,768,1440],realCommandExecutions:executions.length,auditEvents:baselineAuditEvents+9,newAuditEvents:9,baselineAuditEvents,previewReadOnly:true,negativeResponseLoss:true,exactRetryAfterReload:true,expiredSessionReauthentication:true,stablePrincipalRetry:true,differentPrincipalIsolation:true,negativeStalePreview:true,readOnlySession:true,auditedFinalReview:true,immutableReviewConflict:true,reviewExactReplay:true,confirmationRevisionBinding:true,negativePreviewMismatch:true,legacyReceiptReadOnly:true,missingLegacyReceiptHeld:true,keyboardFocus:true,logoutClearsPrivateState:true,financialExecution:false,screenshots:screens}));
}finally{
 await browser?.close();for(const current of [server,readServer])if(current){current.closeAllConnections();await new Promise(resolve=>current.close(resolve));}db.close();
}
