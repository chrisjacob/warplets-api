import {stat} from 'node:fs/promises';
import {localRuntime} from '../edge/test/local-runtime.mjs';
import {createLocalServer} from '../server/start.mjs';
import {serveSite} from '../site/serve.mjs';
import {capabilityTransport} from '../site/src/capability-transport.mjs';

/** Disposable local D1/R2 and one browser origin. Fixture controls are available
 * only through call(), never through the HTTP dispatcher. No proxy headers or
 * origin rewriting participate in authentication. The caller owns seeding. */
export async function createHostedRuntime({port=0}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw TypeError('Invalid loopback port.');
 await stat(new URL('../site/dist/index.html',import.meta.url));
 const cleanups=[],measurementLog=[],measurements={calls:0,sqlStatements:0,batches:0,objectReads:0,objectWrites:0};let server,closed=false,lastMeasurements=null;
 const close=async()=>{
  if(closed)return;closed=true;
  if(server?.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  for(const cleanup of cleanups.reverse())await cleanup();
 };
 try{
  const {mf,db}=await localRuntime({after:cleanup=>cleanups.push(cleanup)},new URL('../edge/test/fixtures/vertical-slice-worker.ts',import.meta.url),{nodeCompat:true});
  const dispatch=async(input,init)=>{
   const request=new Request(input,init);
   return mf.dispatchFetch(request.url,{method:request.method,headers:request.headers,
    ...(!['GET','HEAD'].includes(request.method)?{body:await request.arrayBuffer()}:{}),redirect:'manual'});
  };
  const publicReads=capabilityTransport({fetchImpl:dispatch,baseUrl:'http://localhost/api/v1'});
  server=createLocalServer(async request=>{
   const path=new URL(request.url).pathname;
   if(path.startsWith('/api/v1/'))return dispatch(request);
   if(path.startsWith('/__fixture'))return new Response('Not found',{status:404});
   return await serveSite(request,undefined,path=>publicReads.fetch(new URL(path,request.url)))??new Response('Not found',{status:404});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port,bucket=await mf.getR2Bucket('MANIFESTS');
  return Object.freeze({mf,db,bucket,origin,fetch:dispatch,close,
   get measurements(){return {...measurements};},get lastMeasurements(){return lastMeasurements&&{...lastMeasurements};},
   get measurementLog(){return measurementLog.map(row=>({...row}));},async call(body){
   const response=await dispatch('http://localhost/__fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   lastMeasurements=JSON.parse(response.headers.get('x-fixture-measurements')??'null');measurements.calls++;
   measurementLog.push({method:body.method,...lastMeasurements});
   for(const key of ['sqlStatements','batches','objectReads','objectWrites'])if(Number.isSafeInteger(lastMeasurements?.[key]))measurements[key]+=lastMeasurements[key];
   const value=await response.json();
   if(!response.ok)throw Error('Local fixture '+response.status+': '+JSON.stringify(value));
   return value;
  }});
 }catch(error){await close();throw error;}
}
