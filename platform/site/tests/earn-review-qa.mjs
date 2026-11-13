// Real local HTTP/session, durable queue, capture and simulation; no paid provider or remote URL reads.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openDatabase} from '../../storage/database.mjs';
import {seedDemo} from '../../scripts/demo-data.mjs';
import {configureWorkload} from '../../earn/operations.mjs';
import {recordReview} from '../../earn/workflow.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {createNodeReviewQueueService} from '../../ai-review/queue-service.mjs';
import {exampleJob} from '../../ai-review/fixture.mjs';

const engine=process.env.BROWSER_ENGINE??'chromium',playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
const directory='work/earn-review-'+engine;mkdirSync(directory,{recursive:true});const results=[];
try{
 for(const width of [320,390,1280]){
  const db=openDatabase(),now=Date.now(),f=seedDemo(db,{now}),operator={kind:'operator',id:'synthetic-review-browser'};
  configureWorkload(db,{effectiveEpoch:Math.floor(now/86400000),atMs:now,staffedMinutes:30,secondsPerReview:60,admissionLimit:20,operator:operator.id,reason:'Synthetic browser review capacity'});
  db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(operator.id,'ai-review');
  const service=createNodeReviewQueueService(db,{clock:{nowMs:()=>now}}),app=createApp(db,{clock:()=>now}),reads=[],appeals=[];
  let capabilityOff=false,appealGate=null;
  const server=createLocalServer(async(request,peer)=>{
   const path=new URL(request.url).pathname;
   if(path.endsWith('/review'))reads.push(path);
   if(path.endsWith('/appeals')){appeals.push({key:request.headers.get('idempotency-key'),body:await request.clone().json()});if(appealGate)await appealGate;if(appeals.length===1)return Response.json({error:{code:'synthetic_review_unavailable',message:'Synthetic transport retry — appeal not yet saved.'}},{status:503});}
   const response=await app(request,peer);
   if(capabilityOff&&path==='/api/v1/capabilities'){const value=await response.json(),data=value.data??value;data.features=data.features.filter(feature=>feature.id!=='earn-review-feedback');const headers=new Headers(response.headers);headers.delete('content-length');return Response.json(value,{status:response.status,headers});}
   return response;
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,token='synthetic-review-session-'+width;
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),f.wallet,origin,now+1800000);
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(15000);
  await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(origin+'/earn');await page.locator('#submission-form').waitFor();assert.equal(reads.length,0);
   const contentUrl='https://qa.invalid/submissions/synthetic-browser-'+width;
   await page.getByLabel('Content URL',{exact:true}).fill(contentUrl);await page.getByRole('button',{name:'Submit contribution',exact:true}).click();
   const row=page.locator('.submission-records > li').filter({hasText:contentUrl});await row.waitFor();assert.equal(reads.length,0,'Review must load lazily, not once per history row.');
   const submission=db.prepare('SELECT * FROM earn_submissions WHERE wallet=?').get(f.wallet),jobId='submission:'+submission.id;
   assert.equal(service.walletStatus({kind:'wallet',wallet:f.wallet},submission.id).status,'awaiting-capture');
   const open=row.getByRole('button',{name:'Review & feedback',exact:true});await open.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Review & feedback',exact:true});
   await dialog.getByRole('heading',{name:'Waiting for source review',exact:true}).waitFor();assert.equal(reads.length,1);assert.equal(await dialog.getByRole('heading',{name:/Suggested score/}).count(),0);
   assert.equal(await dialog.getByRole('button',{name:'Send appeal',exact:true}).count(),0);
   const job={...exampleJob,submissionId:submission.id,tokenId:f.marketId,url:contentUrl,capturedAt:new Date(now).toISOString()};
   assert.equal(service.capture(operator,{jobId,job,evidenceRef:'synthetic:browser-source'}).state,'ready');
   await dialog.getByRole('button',{name:'Refresh review',exact:true}).click();await dialog.getByRole('heading',{name:'Ready for review',exact:true}).waitFor();
   assert.equal((await service.runOne(operator,{jobId})).outcome,'completed');
   await dialog.getByRole('button',{name:'Refresh review',exact:true}).click();await dialog.getByRole('heading',{name:'Feedback ready',exact:true}).waitFor();
   await dialog.getByText('SIMULATION — not an AI judgment',{exact:true}).waitFor();await dialog.getByRole('heading',{name:/Suggested score:/}).waitFor();assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_reviews').get().n,0);
   const initialFeedback=service.walletStatus({kind:'wallet',wallet:f.wallet},submission.id).feedback;
   await dialog.locator('summary').click();assert.equal(await dialog.locator('.review-criteria > li').count(),4);assert.match(await dialog.innerText(),/Paid AI calls are disabled/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await dialog.locator('summary').click();await dialog.evaluate(node=>node.scrollTop=0);await page.screenshot({path:directory+'/feedback-'+width+'.png'});
   const send=dialog.getByRole('button',{name:'Send appeal',exact:true});assert.equal(await send.isDisabled(),true);
   const privateReason='SYNTHETIC PRIVATE APPEAL: reconsider the supplied project explanation and example.';await dialog.getByLabel('What should the reviewer reconsider?',{exact:true}).fill(privateReason);
   let releaseAppeal;appealGate=new Promise(r=>releaseAppeal=r);await send.focus();await page.keyboard.press('Enter');await dialog.getByRole('button',{name:'Sending appeal…',exact:true}).waitFor();await page.keyboard.press('Enter');
   assert.ok(!(await page.evaluate(()=>JSON.stringify(Object.entries(sessionStorage)))).includes(privateReason),'Pending intent storage must not contain private appeal text');releaseAppeal();await dialog.getByText('Synthetic transport retry — appeal not yet saved.',{exact:true}).waitFor();assert.equal(appeals.length,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_review_appeals').get().n,0);assert.ok(!(await page.evaluate(()=>JSON.stringify(Object.entries(sessionStorage)))).includes(privateReason),'Failed intent storage must not contain private appeal text');await send.click();await dialog.getByText('Your appeal is saved.',{exact:true}).waitFor();assert.equal(appeals.length,2);assert.equal(appeals[0].key,appeals[1].key,'Retry must retain its original key');assert.equal(appeals[1].body.reportId,initialFeedback.reportId);assert.ok(appeals[1].key);
   await dialog.getByText(/Appeal received — awaiting another review/).waitFor();assert.equal(await dialog.getByRole('button',{name:'Send appeal',exact:true}).count(),0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_review_appeals').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_reviews').get().n,0);
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await open.evaluate(node=>node===document.activeElement),true);
   await page.reload();await page.locator('.submission-review-action button').click();await dialog.getByText(/Appeal received — awaiting another review/).waitFor();
   const appealJob=db.prepare("SELECT id FROM ai_review_jobs WHERE submission_id=? AND kind='appeal'").get(submission.id);
   service.capture(operator,{jobId:appealJob.id,job,evidenceRef:'synthetic:independent-browser-source'});assert.equal((await service.runOne(operator,{jobId:appealJob.id})).outcome,'completed');
   await dialog.getByRole('button',{name:'Refresh review',exact:true}).click();await dialog.getByText(/Your appeal has been reviewed/).waitFor();
   const after=service.walletStatus({kind:'wallet',wallet:f.wallet},submission.id);assert.equal(after.feedback.previousReportId,initialFeedback.reportId);assert.notEqual(after.feedback.reportId,initialFeedback.reportId);
   const finalScore=after.feedback.suggestedScore===2?3:2;
   recordReview(db,{submissionId:submission.id,score:finalScore,reason:'Synthetic authorized review fixture',moderator:operator.id,sourceRef:'synthetic:browser-final',reviewedMs:now});
   await dialog.getByRole('button',{name:'Refresh review',exact:true}).click();await dialog.getByRole('heading',{name:'Final reviewed score: '+finalScore+' / 10',exact:true}).waitFor();await dialog.getByRole('heading',{name:'Suggested score: '+after.feedback.suggestedScore+' / 10',exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Send appeal',exact:true}).count(),0);await dialog.getByText('Appeals are closed because this submission has a final reviewed score.',{exact:true}).waitFor();
   await row.getByText('Awaiting daily results',{exact:true}).waitFor();await dialog.evaluate(node=>node.scrollTop=0);await page.screenshot({path:directory+'/final-'+width+'.png'});
   // Real session expiry while the dialog is open must remove feedback and all appeal controls.
   db.prepare('DELETE FROM sessions WHERE token_hash=?').run(createHash('sha256').update(token).digest('hex'));
   await dialog.getByRole('button',{name:'Refresh review',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('.submission-review').count(),0);await page.locator('#view').getByRole('button',{name:'Connect wallet',exact:true}).waitFor();
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),f.wallet,origin,now+1800000);await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);
   capabilityOff=true;const before=reads.length;await page.reload();await page.locator('.submission-records > li').waitFor();assert.equal(await page.getByRole('button',{name:'Review & feedback',exact:true}).count(),0);assert.equal(reads.length,before,'Unsupported runtimes must not call review endpoints.');
   assert.deepEqual(errors,[]);results.push({width,realSubmissionEnqueued:true,lazyRead:true,sourceCaptureAndSimulation:true,separateReviewLineage:true,duplicateClickGuard:true,privateIdempotencyStorage:true,retryKeepsKey:true,finalScoreSeparate:true,noAutomaticFinalScore:true,sessionExpiryClearsFeedback:true,capabilityFailClosed:true,keyboardReturn:true,noOverflow:true});
  }catch(error){await page.screenshot({path:directory+'/failure-'+width+'.png'});throw error;}
  finally{await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
 }
 writeFileSync(directory+'/results.json',JSON.stringify({engine,version:browser.version(),results},null,2));console.log(JSON.stringify({engine,version:browser.version(),results}));
}finally{await browser.close();}
