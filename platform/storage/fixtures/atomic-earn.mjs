// Synthetic SQL inputs shared by Node and local workerd conformance tests.
import { createNodeCrypto } from '../../security/node-crypto.mjs';
import { admissionRequestBytes,reviewRequestBytes,ADMIT_SUBMISSION,FINAL_REVIEW } from '../../application/commands.mjs';
import { sql } from '../atomic-driver.mjs';
export const start=20001*86400000;
const crypto=createNodeCrypto();
export async function command(wallet='w1',key='key') {
  const value={principal:{kind:'wallet',wallet},operationKind:ADMIT_SUBMISSION,businessIdentity:wallet+'/A',requestKey:key,
    expectedRevisions:{},nowMs:start,input:{tokenId:'A',url:'https://example.test/'+wallet}};
  return {...value,requestDigest:await crypto.sha256(admissionRequestBytes(value))};
}
export async function reviewCommand(submissionId) {
  const value={principal:{kind:'operator',id:'synthetic-operator'},operationKind:FINAL_REVIEW,businessIdentity:submissionId,
    requestKey:submissionId,expectedRevisions:{},nowMs:start,input:{submissionId,score:7,reason:'synthetic',sourceRef:'synthetic-review'}};
  return {...value,requestDigest:await crypto.sha256(reviewRequestBytes(value))};
}
export async function seed(driver,{staffed=true,limit=1}={}) {
  const statements=[sql("INSERT INTO earn_fixture_campaigns VALUES('A',?,'1000000')",start),
    sql("INSERT INTO price_sources VALUES('A','{}','synthetic-policy')"),
    sql("INSERT INTO app_operator_scopes VALUES('synthetic-operator','earn-review',0,1)")];
  if(staffed)statements.push(sql("INSERT INTO earn_workload_policies VALUES('synthetic-policy',?, ?,60,60,?,'synthetic','synthetic')",20001,start,limit));
  for(const wallet of ['w1','w2']) {
    statements.push(sql('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)','read-'+wallet,wallet,'A',start,start+1000,'10000000','synthetic'));
    statements.push(sql('INSERT INTO price_observations VALUES(?,?,?,?,?,?,?,?,?,?)','receipt-'+wallet,'A',wallet,start,0,null,'synthetic-policy','{}',JSON.stringify({status:'verified',expiresMs:start+1000,microUsd:'10000000'}),'read-'+wallet));
  }
  await driver.batch(statements);
}
