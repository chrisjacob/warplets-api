// Private synthetic setup commands; public GETs use the production Worker.
import worker from '../../src/worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {dispatchCollectionObservation} from '../../../collect/observation-test-harness.mjs';
import {dispatchProgressionReservation} from '../../../collect/reservation-test-harness.mjs';
import {createCollectionReadRepository} from '../../../collect/read-model.mjs';
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture')return worker.fetch(request,env,ctx);
 const body=await request.json() as any,driver=createD1AtomicDriver(env.DB);
 if(body.lane==='read'){const reads=createCollectionReadRepository(driver);return Response.json(await (reads[body.method as keyof typeof reads] as (value:any)=>Promise<unknown>)(body.query));}
 const ports={driver,crypto:createWebCrypto(),request:body};
 return Response.json(body.lane==='reservation'?await dispatchProgressionReservation(ports):await dispatchCollectionObservation({...ports,store:r2ArtifactStore(env.MANIFESTS)}));
}};
