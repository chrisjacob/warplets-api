// Node test-only composition. This cache is neither serializable nor accepted by
// the production pinned hash-state validator. Actual runtime proof uses the
// injected pinned adapter in the separate workerd acceptance fixture.
import {createHash} from 'node:crypto';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {encode58} from '../server/base58.mjs';
export const legacyStateTestCrypto=createNodeCrypto();
export function nativeTranscriptFixture({trace=false}={}){
 const states=new Map();
 function save(native,bytes,text){const token=native.copy().digest('hex');states.set(token,{native,text});return {format:'synthetic-native-copy-cache-v1',bytes,token};}
 return {initial:()=>save(createHash('sha256'),0,trace?'':null),advance(state,bytes){if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>65536||state.bytes+bytes.length>33554432)throw Error('Synthetic chunk bound');const prior=states.get(state.token);if(!prior||state.format!=='synthetic-native-copy-cache-v1')throw Error('Synthetic cache missing');return save(prior.native.copy().update(bytes),state.bytes+bytes.length,trace?prior.text+new TextDecoder().decode(bytes):null);},finish(state){const prior=states.get(state.token);if(!prior)throw Error('Synthetic cache missing');return prior.native.copy().digest('hex');},text:state=>states.get(state.token)?.text};
}
export function canonicalStateFixture({stages=3,members=201,admissions=2,shared=false,explicitNull=false}={}){
 const wallet=(group,index)=>{const bytes=Buffer.alloc(32,91);bytes.writeUInt32BE(group,24);bytes.writeUInt32BE(index,28);return encode58(bytes);},lists=Array.from({length:shared?1:stages},(_,group)=>Array.from({length:members},(_,index)=>wallet(group,index)).sort());
 const all=Array.from({length:stages},(_,index)=>({id:'synthetic-stage-'+index,type:'whitelist',publishedAt:1700000000000,opensAt:1700000000000+index*86400000,closesAt:1700000000000+(index+1)*86400000,priceLamports:100000000n,costLamports:5000n,allocation:1000,walletLimit:1,wallets:lists[shared?0:index],termsDigest:'a'.repeat(64),ballotId:null,inventoryOverrideReason:index===0?'Synthetic retained Unicode 雪 🎨':null}));
 return {id:'synthetic-legacy-canonical',kind:'season',...(explicitNull?{tranche:null}:{}),version:stages+admissions,slots:1000,stages:all,admissions:Array.from({length:admissions},(_,index)=>({operationId:'synthetic-admission-'+index,wallet:wallet(0,index),stageId:'synthetic-stage-'+(index%Math.max(1,stages)),drawCommitment:'synthetic-commitment-'+index,admittedAt:1700000000000+index,costLamports:5000n,level:null,proofId:null,ticket:null})),remaining:LEVEL_QUOTAS,fulfilled:0};
}
export async function stateBundle(state){const bundle=await createCollectionStateCodec({crypto:legacyStateTestCrypto}).encodeReferenceInventory(state);return {bundle,records:new Map([bundle.root,...bundle.listManifests,...bundle.pages].map(r=>[r.id,r]))};}
export async function changedRecord(record,change){const body=JSON.parse(new TextDecoder().decode(record.bytes));change(body);const bytes=utf8(canonicalJson(body));return {id:await legacyStateTestCrypto.sha256(bytes),size:bytes.length,bytes};}
export async function runStateAudit(service,rootId,{onStep=()=>{},limit=4000}={}){let checkpoint=null,steps=0,maxWorkingBytes=0,maxRecords=0,maxCheckpointBytes=0;for(;steps<limit;){const result=await service.step({rootId,checkpoint});steps++;maxWorkingBytes=Math.max(maxWorkingBytes,result.metrics.maxWorkingBytes);maxRecords=Math.max(maxRecords,result.metrics.records);await onStep(result,checkpoint);if(result.kind!=='continue')return {result,steps,maxWorkingBytes,maxRecords,maxCheckpointBytes};checkpoint=JSON.parse(JSON.stringify(result.checkpoint));maxCheckpointBytes=Math.max(maxCheckpointBytes,utf8(canonicalJson(checkpoint)).length);}throw Error('Synthetic continuation limit exceeded');}
