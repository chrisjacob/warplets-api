import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {collectionSourceTestDispatch} from '../../../collect/source-test-harness.mjs';
export default {async fetch(request:Request,env:Env){
 const result=await collectionSourceTestDispatch({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),ids:{next:()=>crypto.randomUUID()},request:await request.json()});
 return Response.json(result);
}};
