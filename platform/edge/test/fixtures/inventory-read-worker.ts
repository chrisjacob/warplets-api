import worker from '../../src/worker';
import {createInventoryReadRepository} from '../../../collect/inventory-read-model.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture/inventory-read')return worker.fetch(request,env,ctx);
 const input=await request.json() as {method:'readInventory'|'listInventories';query:any},reads=createInventoryReadRepository(createD1AtomicDriver(env.DB));
 return Response.json(await reads[input.method](input.query));
}};
