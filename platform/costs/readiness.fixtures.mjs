import {randomUUID} from 'node:crypto';
import {economicPlanFixture,economicPlanRequest} from '../storage/economic-plans.fixtures.mjs';
import {createEconomicPlanRepository} from '../storage/economic-plans.mjs';
import {createQuoteRepository} from '../quotes/repository.mjs';
import {createOperationalMetrics} from '../observability/metrics.mjs';
import {createCostReadinessRepository} from './readiness-repository.mjs';
import {createCostReadinessService} from './readiness-service.mjs';
import {costPacketFixtures} from './packet.fixtures.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
export function readinessPlanning(now){const {asOfMs,context,...input}=costPacketFixtures().complete;for(const q of [...Object.values(input.quotes),...Object.values(input.fx)]){q.observedMs=now-1;q.expiresMs=now+1000;}return input;}
/** Genuine B04 source and guarded065 receipt; local planning prices are synthetic. */
export async function costReadinessFixture(t){const f=await economicPlanFixture(t),accepted=await f.repo.prepare(economicPlanRequest());if(accepted.kind!=='committed')throw Error(JSON.stringify(accepted));let fault=null,hit=0;const measures=[];
 const driver={...f.driver,async batch(statements){const m=measureBatch(statements),r=await f.driver.batch(statements);measures.push({...m,resultBytes:utf8(canonicalJson(r.map(v=>v.rows))).length});return r;}},crypto={...f.crypto,async sha256(bytes){if(fault&&new TextDecoder().decode(bytes).includes('"format":"10x.cost-readiness.v1"')){hit++;const action=fault;fault=null;await action();}return f.crypto.sha256(bytes);}},ports={crypto,clock:f.clock,ids:{next:randomUUID}},economicPlans=createEconomicPlanRepository(driver,ports),quoteRepository=createQuoteRepository(driver,ports),metrics=createOperationalMetrics({driver,clock:f.clock}),repository=createCostReadinessRepository({driver,economicPlans,quoteRepository,metrics,crypto,clock:f.clock}),service=createCostReadinessService({repository,crypto,clock:f.clock}),query={principal:f.principal,intentId:accepted.value.intentId,preparationId:accepted.value.preparationId};
 return {...f,driver,crypto,repository,service,query,measures,planning:readinessPlanning(f.clock.nowMs()),setReportFault:fn=>fault=fn,get hit(){return hit;}};
}
