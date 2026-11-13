import {randomUUID} from 'node:crypto';
import {transaction} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicEarnRepository} from '../storage/atomic-earn.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {ADMIT_SUBMISSION,admissionRequestBytes} from '../application/commands.mjs';
import {exampleJob} from './fixture.mjs';

/** Explicit test fixture only: adds a synthetic campaign, funded evidence, staffing and reviewer grant.
 * Call only against a disposable local test DB. Admission itself uses the real atomic repository.
 */
export async function seedSyntheticReviewQueueFixture(db,{wallet='synthetic-review-wallet',nowMs=Date.now(),operatorId='synthetic-ai-review-operator',suffix=randomUUID()}={}){
 const tokenId='synthetic-ai-'+suffix,readId='synthetic-read-'+suffix,policyId='synthetic-policy-'+suffix;
 const time=Math.max(nowMs,Number(db.prepare('SELECT COALESCE(MAX(recorded_ms),0) n FROM earn_workload_policies').get().n)+1),epoch=Math.floor(time/86400000);
 transaction(db,()=>{
  db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run(tokenId,time,'1000000');
  db.prepare('INSERT INTO price_sources VALUES(?,?,?)').run(tokenId,'{}',policyId);
  db.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)').run(readId,wallet,tokenId,time,time+86400000,'10000000','SYNTHETIC trusted capture fixture');
  db.prepare('INSERT INTO price_observations VALUES(?,?,?,?,?,?,?,?,?,?)').run('synthetic-price-'+suffix,tokenId,wallet,time,0,null,policyId,'{}',JSON.stringify({status:'verified',expiresMs:time+86400000,microUsd:'10000000'}),readId);
  db.prepare('INSERT INTO earn_workload_policies VALUES(?,?,?,?,?,?,?,?)').run(policyId,epoch,time,10000,1,10000,operatorId,'SYNTHETIC review queue fixture');
  db.prepare("INSERT INTO app_operator_scopes VALUES(?,'ai-review',0,1) ON CONFLICT(operator,scope) DO UPDATE SET enabled=1,revision=revision+1").run(operatorId);
 });
 const crypto=createNodeCrypto(),command={principal:{kind:'wallet',wallet},operationKind:ADMIT_SUBMISSION,businessIdentity:wallet+'/'+tokenId,requestKey:'synthetic-submit-'+suffix,expectedRevisions:{},nowMs:time,input:{tokenId,url:'https://qa.invalid/review/'+suffix}};
 command.requestDigest=await crypto.sha256(admissionRequestBytes(command));
 const result=await createAtomicEarnRepository(createNodeAtomicDriver(db),{crypto,ids:{next:randomUUID}}).admitSubmission(command);
 if(result.kind!=='committed')throw new Error('Synthetic queue fixture admission was not committed: '+result.kind);
 const submission=db.prepare('SELECT * FROM earn_submissions WHERE wallet=? AND request_key=?').get(wallet,command.requestKey);
 return {submissionId:submission.id,jobId:'submission:'+submission.id,operator:{kind:'operator',id:operatorId},principal:{kind:'wallet',wallet},nowMs:time,
  job:{...exampleJob,submissionId:submission.id,tokenId,url:command.input.url,capturedAt:new Date(time).toISOString()},evidenceRef:'SYNTHETIC:trusted-source:'+suffix};
}
