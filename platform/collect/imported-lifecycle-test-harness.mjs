// Private synthetic acceptance only: production handlers do not expose this dispatcher.
import {createMintReservationRepository} from './mint-repository.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {createInventoryReadRepository} from './inventory-read-model.mjs';
import {createCollectionReadRepository} from './read-model.mjs';
import {dispatchMintFulfillment} from './mint-fulfillment-test-harness.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
export async function dispatchImportedLifecycle({driver:base,crypto,store,request}){
 if(request.method==='fulfillment')return dispatchMintFulfillment({driver:base,crypto,store,request:request.fulfillment});
 let sequence=0;const metrics={sql:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0},driver={...base,leaseNowSql:String(request.nowMs),async batch(statements){const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);const r=await base.batch(statements);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(r)).length);return r;}},ports={crypto,clock:{nowMs:()=>request.nowMs},ids:{next:()=>request.idPrefix+'-'+(++sequence)}};
 let result;if(request.method==='mint')result=await createMintReservationService({crypto,repository:createMintReservationRepository(driver,ports)}).reserveMint(request.principal,request.input);
 else if(request.method==='inventory')result=await createInventoryReadRepository(driver,{crypto,normalizedAdmissionAvailable:true}).readInventory(request.input);
 else result=await createCollectionReadRepository(driver)[request.method](request.input);
 return {status:200,result,metrics};
}
