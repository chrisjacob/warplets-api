import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../storage/database.mjs';
import {seedSyntheticReviewQueueFixture} from './queue-fixture.mjs';
import {runQueueCli} from './queue-cli.mjs';

test('local queue CLI resumes persisted capture/run/status and never grants itself authority',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'tenx-review-queue-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const path=join(folder,'review.sqlite'),input=join(folder,'capture.json');const db=openDatabase(path),f=await seedSyntheticReviewQueueFixture(db);db.close();writeFileSync(input,JSON.stringify(f.job));
 const base=['--database',path,'--operator-id',f.operator.id],outputs=[],options={write:value=>outputs.push(value)};
 const capture=await runQueueCli(['capture',...base,'--job-id',f.jobId,'--input',input,'--evidence-ref',f.evidenceRef],options);assert.equal(capture.outcome,'created');
 assert.equal((await runQueueCli(['run',...base,'--job-id',f.jobId],options)).outcome,'completed');
 assert.equal((await runQueueCli(['run',...base,'--job-id',f.jobId],options)).outcome,'idle');
 const view=await runQueueCli(['status','--database',path,'--wallet',f.principal.wallet,'--submission-id',f.submissionId],options);assert.equal(view.status,'completed');assert.equal(view.feedback.simulation,true);
 await assert.rejects(runQueueCli(['run','--database',path,'--operator-id','ungranted'],options),e=>e.code==='operator_scope_required');
 assert.equal(outputs.length,4);assert.equal(JSON.stringify(outputs).includes(f.job.content),false);
});

test('CLI refuses paid switches, new database paths and oversized captures before opening database',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'tenx-review-options-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));const missing=join(folder,'new.sqlite');
 await assert.rejects(runQueueCli(['run','--database',missing,'--operator-id','x','--allow-paid-provider','true']),/Invalid/);
 await assert.rejects(runQueueCli(['run','--database',missing,'--operator-id','x']),/existing/);assert.equal(existsSync(missing),false);
 const path=join(folder,'existing.sqlite'),db=openDatabase(path);db.close();const input=join(folder,'oversized.json');writeFileSync(input,'x'.repeat(131073));
 await assert.rejects(runQueueCli(['capture','--database',path,'--operator-id','x','--job-id','submission:x','--input',input,'--evidence-ref','ref']),/128 KiB/);
});
