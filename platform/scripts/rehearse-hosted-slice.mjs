import {createRequire} from 'node:module';
import {createHostedRuntime} from './hosted-runtime.mjs';
import {createHostedSlice} from '../application/fixtures/hosted-slice.mjs';
import {checkHostedRuntime} from '../site/tests/hosted-runtime-qa.mjs';

const args=process.argv.slice(2),verify=args.includes('--verify');
if(args.some(arg=>arg!=='--verify'))throw Error('Usage: node platform/scripts/rehearse-hosted-slice.mjs [--verify]');
if(verify&&(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE))throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to installed local browser dependencies.');
const runtime=await createHostedRuntime({port:process.env.PORT===undefined?0:Number(process.env.PORT)});let browser;
try{
 const fixture=await createHostedSlice(runtime);
 console.log('Synthetic transcript rehearsal only; no real-chain evidence or financial execution.');
 console.log('Frozen synthetic fixture clock: '+new Date(fixture.nowMs).toISOString());
 console.log('Local React + workerd preview: '+runtime.origin+'/earn');
 if(verify){
  const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  const browserEvidence=await checkHostedRuntime({browser,runtime,fixture});
  const coreEvidence=await fixture.verify();
  console.log(JSON.stringify({profile:'B20-core',synthetic:true,origin:runtime.origin,browser:browserEvidence,core:coreEvidence},null,2));
 }else{
  console.log('Disposable fixture is ready. Ctrl+C closes the preview and its local D1/R2 runtime.');
  console.log('Restart this disposable rehearsal after five minutes to refresh wallet challenges/entry evidence.');
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }
}finally{await browser?.close();await runtime.close();}
