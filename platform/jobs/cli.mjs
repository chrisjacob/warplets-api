import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createJobRepository} from './repository.mjs';
import {createJobCommand} from './model.mjs';
import {runTick} from './runner.mjs';
import {createHandlerRegistry} from './handlers.mjs';
import {reconcileJobOutbox} from './outbox.mjs';
if(process.argv.slice(2).join(' ')!=='--fixture-rehearsal')throw new Error('Only --fixture-rehearsal is supported. No live scheduler is installed.');
const directory=mkdtempSync(join(tmpdir(),'10x-job-rehearsal-')),db=openDatabase(join(directory,'fixture.sqlite'));
try{
 const principal={kind:'operator',id:'synthetic-rehearsal'},crypto=createNodeCrypto(),clock={nowMs:()=>Date.now()};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'jobs-runner');
 const driver=createNodeAtomicDriver(db),repository=createJobRepository(driver,{crypto,ids:{next:randomUUID},clock,principal});
 for(const [key,type] of [['complete','retention-maintenance'],['missing','complete-cutoff']])await repository.enqueue(await createJobCommand({principal,requestKey:key,nowMs:clock.nowMs(),
  input:{businessKey:key,sourceKey:'fixture:'+key,type,payload:{mode:'synthetic-fixture'},maxAttempts:3,readyMs:clock.nowMs()}},crypto));
 const handlers=createHandlerRegistry({'retention-maintenance':async context=>{
  const saved=await context.checkpoint({mode:'synthetic-fixture',phase:'no-op-rehearsal'});
  if(saved.kind!=='checkpointed')return {state:'held',reason:'checkpoint-unknown',dependency:'reconciliation',readyMs:null};
  return {state:'completed',result:{mode:'synthetic-fixture',deletedObjects:0}};
 }});
 const result=await runTick({repository,clock,handlers,outbox:bounds=>reconcileJobOutbox(driver,repository,bounds)});
 console.log(JSON.stringify({mode:'synthetic-fixture',processed:result.processed,states:result.items.map(r=>r.job?.state??r.kind),externalCalls:0,financialExecution:false},null,2));
}finally{db.close();rmSync(directory,{recursive:true,force:true});}
