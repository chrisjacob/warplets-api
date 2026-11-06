import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {callNotificationJobFixture} from './notification-job-fixture.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 return Response.json(await callNotificationJobFixture(createD1AtomicDriver(env.DB),createWebCrypto(),await request.json()));
}};
