// Private acceptance fixture only. No production module imports this entry point.
// SQL/clock/fault controls below are never routes of the application Worker.
import worker from '../../src/worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createReviewFeedbackService} from '../../../ai-review/portable-queue-service.mjs';
type Statement={sql:string;values:(string|number|null)[]};
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).hostname==='localhost'&&new URL(request.url).pathname==='/__fixture/appeal-race'){
  const body=await request.json() as {wallet:string;submissionId:string;reportId:string;reason:string;requestKey:string;raceStatements?:Statement[];lostResponse?:boolean};
  const base=createD1AtomicDriver(env.DB),baseCrypto=createWebCrypto();let loaded=false,injected=false,hashes=0,committed=false;
  const driver={...base,async batch(statements:Statement[]){
   const result=await base.batch(statements);
   if(statements.some(s=>/SELECT/i.test(s.sql)&&/ai_review_/i.test(s.sql)))loaded=true;
   if(body.lostResponse&&!committed&&statements.some(s=>/INSERT\s+INTO\s+ai_review_appeals/i.test(s.sql))){committed=true;throw Error('SYNTHETIC lost acknowledgement after durable D1 write');}
   return result;
  }};
  const cryptoPort={...baseCrypto,async sha256(bytes:Uint8Array){
   const value=await baseCrypto.sha256(bytes);hashes++;
   if(loaded&&!injected&&body.raceStatements?.length){injected=true;await base.batch(body.raceStatements);}
   return value;
  }};
  try{
   const result=await createReviewFeedbackService({driver,crypto:cryptoPort,clock:{nowMs:Date.now}}).appeal({kind:'wallet',wallet:body.wallet},{submissionId:body.submissionId,reportId:body.reportId,reason:body.reason,requestKey:body.requestKey});
   return Response.json({result,injected,hashes,committed});
  }catch(error){const e=error as Error&{status?:number;code?:string};return Response.json({error:{code:e.code??'fixture_fault',message:e.message},injected,hashes,committed},{status:e.status??500});}
 }
 return worker.fetch(request,env,ctx);
}};
