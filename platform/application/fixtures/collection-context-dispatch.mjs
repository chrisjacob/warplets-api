// Portable isolated acceptance control; no production route imports this module.
import {createCollectionContextRepository,createCollectionContextService} from '../../storage/collection-context.mjs';
import {createCollectionQuotePlanning} from '../collection-quotes.mjs';
export async function dispatchCollectionContext({driver,crypto,input}){
 let statements=0,batches=0;const measured={...driver,async batch(values){statements+=values.length;batches++;return driver.batch(values);}},repository=createCollectionContextRepository(measured),service=createCollectionContextService({repository,clock:{nowMs:()=>input.nowMs}});
 const result=input.method==='raw'?await repository.readProgressionContext(input.query):await service.read(input.principal,input.input);
 let quote=null;if(input.method==='quote'&&result.kind==='ready')quote=await createCollectionQuotePlanning({crypto}).derive({quoteId:'synthetic-context-quote',principal:input.principal,inventoryId:input.input.inventoryId,request:input.input.request,context:result.context,policyVersion:'synthetic-context-policy',nowMs:input.nowMs,expiresMs:input.nowMs+15000});
 return {result,quote,measurements:{statements,batches}};
}
