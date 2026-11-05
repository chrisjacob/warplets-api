import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { openDatabase } from '../storage/database.mjs';
import { createApp } from '../server/application.mjs';
import { encode58 } from '../server/base58.mjs';
import { createClient, PlatformApiError } from './client.mjs';
import { openapi } from '../server/api.mjs';
import { TERMS } from '../notifications/notices.mjs';
import { finalizeBoard, addCampaign, recordAllocation } from '../earn/workflow.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import {configureWorkload} from '../earn/operations.mjs';
import { readFileSync } from 'node:fs';

// Assertions for the schema keywords emitted by this contract generator, not a
// general-purpose JSON Schema validator. Each branch fails on wire drift.
function check(schema,value,spec,path='$') {
  if(schema.$ref)return check(spec.components.schemas[schema.$ref.split('/').at(-1)],value,spec,path);
  if(schema.anyOf) {
    assert.ok(schema.anyOf.some(s=>{try{check(s,value,spec,path);return true;}catch{return false;}}),path+' matches no union member');
    return;
  }
  if(schema.allOf) {for(const s of schema.allOf)check(s,value,spec,path);return;}
  if(Object.hasOwn(schema,'const'))assert.deepEqual(value,schema.const,path);
  if(schema.enum)assert.ok(schema.enum.includes(value),path);
  if(schema.type==='null')assert.equal(value,null,path);
  if(schema.type==='string') {
    assert.equal(typeof value,'string',path);
    if(schema.pattern)assert.match(value,new RegExp(schema.pattern),path);
  }
  if(schema.type==='integer')assert.ok(Number.isSafeInteger(value),path+' is integer');
  if(schema.type==='boolean')assert.equal(typeof value,'boolean',path);
  if(schema.type==='object') {
    assert.ok(value&&typeof value==='object'&&!Array.isArray(value),path+' is object');
    for(const key of schema.required??[])assert.ok(Object.hasOwn(value,key),path+'.'+key+' is required');
    for(const [key,child] of Object.entries(schema.properties??{}))if(Object.hasOwn(value,key))check(child,value[key],spec,path+'.'+key);
  }
  if(schema.type==='array') {
    assert.ok(Array.isArray(value),path+' is array');
    for(const child of value)check(schema.items,child,spec,path+'[]');
  }
}
function schemasFor(spec,operationId) {
  for(const item of Object.values(spec.paths))for(const op of Object.values(item))if(op.operationId===operationId)return op;
  throw Error('Missing contract '+operationId);
}
test('generated client authenticates and exercises exact feature schemas through the application router',async t=>{
  const db=openDatabase();t.after(()=>db.close());
  const now=20_001*DAY_MS+5000,epoch=Math.floor(now/DAY_MS),origin='http://localhost';
  configureWorkload(db,{effectiveEpoch:epoch,atMs:now-1,staffedMinutes:10,secondsPerReview:6,admissionLimit:100,operator:'synthetic-reviewer',reason:'Explicit HTTP fixture staffing'});
  const app=createApp(db,{clock:()=>now}),spec=openapi();let cookie='';
  const client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{
    const headers=new Headers(init.headers);headers.set('origin',origin);if(cookie)headers.set('cookie',cookie);
    const response=await app(new Request(url,{...init,headers}));
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return response;
  }});
  const examined=[];
  async function invoke(id,options) {
    const result=await client[id](options);
    const response=Object.entries(schemasFor(spec,id).responses).find(([status])=>status.startsWith('2'))[1];
    check(response.content['application/vnd.10x.v1+json'].schema,result,spec,id);examined.push(id);return result;
  }
  for(const id of ['getCapabilities','getPolicy','listCollections','getHealth','listGenesisBallots','listActiveEarnActions','getEarnAdmissionCapacity',
    'getLocalOperationStatus','getNoticeCapabilities','listLaunchPlans'])await invoke(id);
  const keys=generateKeyPairSync('ed25519'),wallet=encode58(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));
  const challenge=await invoke('createWalletChallenge',{body:{wallet}});
  await invoke('verifyWalletSignature',{body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),keys.privateKey))}});
  for(const id of ['getProfile','getWallets','getMyVault','getMyEarnSubmissions','getMyEarnClaims','getStakePositions','getMyNoticePreferences','getMyLocalNotices'])await invoke(id);
  const member=await invoke('getMyEarnSubmissions');assert.equal(member.memberStatus.asOf,new Date(now).toISOString());assert.equal(member.memberStatus.currentCutoff.status,'pending');
  const vault=await invoke('getMyVault');assert.equal(vault.summary.status,'complete');assert.equal(vault.summary.assetCount,0);
  await invoke('setMyNoticePreferences',{idempotencyKey:'consent',body:{channel:'local-inbox',enabled:true,topics:['launch'],terms:TERMS,expectedRevision:0}});
  const date=new Date(epoch*DAY_MS).toISOString().slice(0,10);
  await invoke('getEarnLeaderboard',{path:{epoch:date}});
  finalizeBoard(db,{epoch:epoch-1,nowMs:now,sourceComplete:true,sourceRef:'empty bootstrap'});
  addCampaign(db,{tokenId:'A',activationMs:now,originalUnits:'10000'});
  recordAllocation(db,{tokenId:'A',day:1,nowMs:now});
  const priorDate=new Date((epoch-1)*DAY_MS).toISOString().slice(0,10);
  await invoke('getEarnLeaderboard',{path:{epoch:priorDate}});
  await invoke('exportEarnManifest',{path:{epoch:priorDate}});
  await invoke('revokeSession');
  await assert.rejects(client.getProfile(),e=>e instanceof PlatformApiError&&e.status===401&&typeof e.requestId==='string');
  assert.ok(new Set(examined).size>=20);
});

test('new operations have typed payloads and numeric claim cursor in generated declarations',()=>{
  const spec=openapi();
  for(const [path,item] of Object.entries(spec.paths))for(const op of Object.values(item)){
    if(!op.operationId)continue;
    const response=Object.entries(op.responses).find(([status])=>status.startsWith('2'))?.[1];
    const schema=response?.content?.['application/vnd.10x.v1+json']?.schema;
    assert.ok(schema?.properties||schema?.allOf||schema?.$ref,path+' needs a concrete success schema');
  }
  const declarations=readFileSync(new URL('./client.d.mts',import.meta.url),'utf8');
  assert.match(declarations,/getMyEarnClaims.*"cursor"\?: number/);
  assert.match(declarations,/setMyNoticePreferences\(options: \{.*idempotencyKey: string/);
  const proof=schemasFor(spec,'submitSignedActionCompletion').requestBody.content['application/json'].schema;
  assert.equal(proof.properties.proof.$ref,'#/components/schemas/ActionCompletionProof');
});

test('non-JSON error responses preserve status, retryability and request correlation',async()=>{
  const client=createClient({fetchImpl:async()=>new Response('provider unavailable',{status:503,headers:{'x-request-id':'trace-1'}})});
  await assert.rejects(client.getHealth(),e=>e instanceof PlatformApiError&&e.status===503&&e.retryable&&e.requestId==='trace-1');
});
