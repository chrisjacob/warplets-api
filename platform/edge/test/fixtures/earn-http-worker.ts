import worker from '../../src/worker';
import {createWorkerEarnService} from '../../src/earn';
import {EarnError} from '../../../earn/validation.mjs';
// Only this private fixture fixes the clock. The production router never
// accepts a request clock or an operator-review endpoint.
const now=20001*86400000+5000;
Date.now=()=>now;
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).hostname==='localhost'&&new URL(request.url).pathname==='/__fixture/review'){
  const input=await request.json() as {submissionId:string;score:number;reason:string;sourceRef:string};
  try{return Response.json(await createWorkerEarnService(env.DB,now).recordFinalReview({kind:'operator',id:'synthetic-reviewer'},input));}
  catch(error){return Response.json({error:{message:String(error),code:error instanceof EarnError?error.code:'internal_error'}},{status:error instanceof EarnError?error.status:500});}
 }
 return worker.fetch(request,env,ctx);
}};
