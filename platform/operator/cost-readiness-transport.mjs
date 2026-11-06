import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createEconomicPlanRepository} from '../storage/economic-plans.mjs';
import {createQuoteRepository} from '../quotes/repository.mjs';
import {createOperationalMetrics} from '../observability/metrics.mjs';
import {createCostReadinessRepository} from '../costs/readiness-repository.mjs';
import {createCostReadinessService} from '../costs/readiness-service.mjs';
import {referenceScenarioInput} from '../costs/reference.mjs';
import {decode58} from '../server/base58.mjs';
import {json,failure} from '../server/api.mjs';
/** Node composition exposes reads only. Mutation dependencies are deliberately
 * unavailable; this adapter neither prepares plans nor grants operator scopes. */
export function createNodeCostReadiness(db,{clock=Date.now,driver=createNodeAtomicDriver(db)}={}){
 const crypto=createNodeCrypto(),ports={crypto,clock:{nowMs:clock},ids:{next(){throw Error('Read-only cost adapter');}}};
 const quoteRepository=createQuoteRepository(driver,ports),economicPlans=createEconomicPlanRepository(driver,{...ports,quoteRepository,swapPlans:{prepare(){throw Error('Read-only cost adapter');}}});
 const repository=createCostReadinessRepository({driver,economicPlans,quoteRepository,metrics:createOperationalMetrics({driver,clock:ports.clock}),crypto,clock:ports.clock});
 return createCostReadinessService({repository,crypto,clock:ports.clock});
}
export function createOperatorCostReadiness(db,{clock=Date.now,service}={}){
 const scope=()=>db.prepare("SELECT enabled,revision FROM app_operator_scopes WHERE operator=? AND scope='cost-review'");
 return async function read(request,authorization){
  authorization.guard();const principal=authorization.principal;
  if(principal.kind!=='operator')return failure(403,'cost_review_scope_required','Cost review requires an operator scope.');
  const before=scope().get(principal.id);if(!before?.enabled)return failure(403,'cost_review_scope_required','The cost-review scope is required.');
  const params=new URL(request.url).searchParams,keys=[...params.keys()];
  if(keys.length!==3||new Set(keys).size!==3||keys.some(k=>!['owner','intentId','preparationId'].includes(k)))return failure(400,'invalid_cost_query','Select one owner, intent and preparation.');
  const owner=params.get('owner'),intentId=params.get('intentId'),preparationId=params.get('preparationId');
  try{decode58(owner,32);if(!/^[a-f0-9]{64}$/.test(intentId)||!/^[a-f0-9]{64}$/.test(preparationId))throw Error();}catch{return failure(400,'invalid_cost_query','Invalid owner or preparation identity.');}
  service??=createNodeCostReadiness(db,{clock});
  // The operator scope explicitly permits this selected owner read. It does not
  // create a wallet session or provide any wallet mutation authority.
  const {asOfMs,...planning}=referenceScenarioInput(clock());
  const result=await service.read({principal:{kind:'wallet',wallet:owner},intentId,preparationId},planning);
  authorization.guard();const after=scope().get(principal.id);
  if(!after?.enabled||after.revision!==before.revision)return failure(403,'cost_review_scope_changed','Cost review scope changed; refresh the session.');
  return json(result,200,{'cache-control':'no-store'});
 };
}
