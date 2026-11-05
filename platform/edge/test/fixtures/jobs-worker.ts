import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createJobRepository,type JobCommand,type JobOutcome} from '../../../jobs/repository.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {runLocalJobTick} from '../../src/jobs';
import type {JobLease,JsonValue} from '../../../application/ports';
export default {async fetch(request:Request,env:Env){
 const b=await request.json() as {method:'enqueue'|'acquire'|'checkpoint'|'finish'|'read'|'wake'|'tick';nowMs:number;command:JobCommand;lease:JobLease;
  sequence:number;value:JsonValue;outcome:JobOutcome;jobId:string;dependency:string;evidenceDigest:string;fault?:'lost-response'|'delay-checkpoint'};
 const principal={kind:'operator' as const,id:'synthetic-jobs'};
 if(b.method==='tick')return Response.json(await runLocalJobTick(env,{mode:'local-validation',principal,deadlineMs:5000}));
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS fixture_job_clock(now_ms INTEGER NOT NULL)').run();
 await env.DB.batch([env.DB.prepare('DELETE FROM fixture_job_clock'),env.DB.prepare('INSERT INTO fixture_job_clock VALUES(?)').bind(b.nowMs)]);
 const base=createD1AtomicDriver(env.DB);let fault=b.fault;
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM fixture_job_clock)',async batch(statements:Parameters<typeof base.batch>[0]){
  if(fault==='delay-checkpoint'&&statements.some(s=>s.sql.includes('SET checkpoint_json'))){fault=undefined;await env.DB.prepare('UPDATE fixture_job_clock SET now_ms=now_ms+60000').run();}
  const result=await base.batch(statements);
  if(fault==='lost-response'&&statements.some(s=>s.sql.startsWith('UPDATE app_jobs SET state='))){fault=undefined;throw Error('lost response after commit');}
  return result;
 }};
 const repo=createJobRepository(driver,{principal,crypto:createWebCrypto(),clock:{nowMs:()=>b.nowMs},ids:{next:()=>crypto.randomUUID()}});
 switch(b.method){
  case 'enqueue':return Response.json(await repo.enqueue(b.command));
  case 'acquire':return Response.json(await repo.acquireJob());
  case 'checkpoint':return Response.json(await repo.checkpoint(b.lease,{sequence:b.sequence,value:b.value}));
  case 'finish':return Response.json(await repo.finish(b.lease,b.outcome));
  case 'read':return Response.json(await repo.readJob(b.jobId));
  case 'wake':return Response.json(await repo.wake(b));
 }
}};
