import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createJobRepository} from '../../jobs/repository.mjs';
import {runTick,type Registry} from '../../jobs/runner.mjs';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import type {OperatorPrincipal} from '../../application/ports';
import {reconcileJobOutbox} from '../../jobs/outbox.mjs';
// Test/manual local binding invocation only. Intentionally not mounted on fetch,
// scheduled, Queue or Workflow handlers, and creates no remote resources.
export function runLocalJobTick(env:Pick<Env,'DB'>,options:{mode:'local-validation';principal:OperatorPrincipal;handlers?:Registry;limit?:number;deadlineMs?:number}){
 if(options.mode!=='local-validation')throw new TypeError('Only local job validation is available.');
 // A single core job can spend many D1 queries loading a bounded cutoff. Keep
 // the binding invocation at one until B07 measures its complete query budget.
 if(options.limit!==undefined&&options.limit!==1)throw new TypeError('Local D1 invocation currently admits one job.');
 const clock={nowMs:()=>Date.now()},driver=createD1AtomicDriver(env.DB),repository=createJobRepository(driver,{
  crypto:createWebCrypto(),ids:{next:()=>crypto.randomUUID()},clock,principal:options.principal});
 return runTick({repository,clock,handlers:options.handlers,limit:1,deadlineMs:options.deadlineMs,outbox:bounds=>reconcileJobOutbox(driver,repository,bounds)});
}
