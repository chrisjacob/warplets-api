// Node-only fixture loader. Reads already pinned local evidence, never providers.
import {readFile} from 'node:fs/promises';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {QUOTE_COMPARISON_FORMAT} from '../quote-comparison.mjs';
const root=new URL('../../',import.meta.url);
export async function loadQuoteComparisonFixture(crypto){
 const inventory=JSON.parse(await readFile(new URL('./quote-comparison-sources.json',import.meta.url),'utf8')),sources=new Map();
 for(const source of inventory.sources){const bytes=new Uint8Array(await readFile(new URL(source.path,root)));
  if(await crypto.sha256(bytes)!==source.sha256)throw Error('Pinned quote comparison source changed: '+source.path);sources.set(source.id,bytes);}
 const vector=JSON.parse(new TextDecoder().decode(sources.get('synthetic-sdk-1.5.1'))),pin=inventory.sources[0];
 if(vector.source!==pin.label)throw Error('Synthetic SDK source label changed.');
 const observation=JSON.parse(new TextDecoder().decode(sources.get('dated-program-observation')));
 if(observation.allocatedElfSha256!==inventory.capturedProgram.datedBinaryDigest||observation.program!==inventory.capturedProgram.program)throw Error('Dated binary observation changed.');
 const rawPool={...vector.pool,byteDigest:await crypto.sha256(Uint8Array.from(atob(vector.pool.data),c=>c.charCodeAt(0)))};
 const records=[],requirements=[];
 for(const [index,v] of vector.results.entries()){
  const id='synthetic-sdk-1.5.1:'+index,buy=v.direction==='buy-att';
  // SDK zero output is an explicit unsupported dust quote in this application.
  // Error selection uses the recorded input/fee/output, never quoteAmounts().
  const error=v.error??(v.outputUnits==='0'?(buy&&v.inputUnits===v.feeUnits?'dust_input':'dust_output'):null);
  const observed=error?{kind:'rejected',errorCode:error}:{kind:'amounts',outputUnits:v.outputUnits,
   grossOutputUnits:String(BigInt(v.outputUnits)+(buy?0n:BigInt(v.feeUnits))),inputFeeUnits:buy?v.feeUnits:'0',outputFeeUnits:buy?'0':v.feeUnits,totalFeeUnits:v.feeUnits,nextSqrtPriceX64:v.nextSqrtPriceX64};
  const record={format:QUOTE_COMPARISON_FORMAT,id,evidenceKind:'synthetic-sdk',source:{fileDigest:pin.sha256,sourceCommit:pin.sourceCommit,recordingId:id,label:pin.label},
   program:{address:vector.pool.owner,binaryDigest:null,decoderVersion:'damm-pool-v1'},rawPool:{...rawPool},
   identities:Object.fromEntries(['attMint','ogMint','attVault','ogVault'].map(k=>[k,vector[k].address])),activationMs:vector.activationMs,currentPointMs:vector.activationMs+v.elapsedSeconds*1000,
   direction:v.direction,inputUnits:v.inputUnits,slippageBps:50,observed};
  const expected={evidenceKind:record.evidenceKind,sourceFileDigest:pin.sha256,sourceCommit:pin.sourceCommit,recordingId:id,recordDigest:await crypto.sha256(utf8(canonicalJson(record))),
   program:{...record.program},rawPool:{address:record.rawPool.address,byteDigest:record.rawPool.byteDigest},identities:{...record.identities},activationMs:record.activationMs,currentPointMs:record.currentPointMs,direction:record.direction,inputUnits:record.inputUnits,slippageBps:record.slippageBps};
  records.push(record);requirements.push({id,expected,recordIds:[id],missingReason:null});
 }
 for(const direction of inventory.capturedProgram.directions)for(const seconds of inventory.capturedProgram.requiredElapsedSeconds)
  requirements.push({id:'captured-program:'+direction+':second-'+seconds,expected:null,recordIds:[],missingReason:inventory.capturedProgram.reason});
 return {inventory,records,requirements};
}
