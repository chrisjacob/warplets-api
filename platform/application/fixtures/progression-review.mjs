import {randomUUID} from 'node:crypto';
import {createCollectionEdgeFixture} from './collection-edges.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {currentSession,consumeQuota} from '../../server/auth.mjs';
import {represent} from '../../contracts/transport.mjs';
import {handleProgression} from '../../collect/progression-http.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createCollectionQuoteService} from '../../collect/quote-service.mjs';
import {createCollectionQuoteRepository} from '../../collect/quote-repository.mjs';
import {createProgressionReservationService} from '../../collect/reservation-service.mjs';
import {createProgressionReservationRepository} from '../../collect/reservation-repository.mjs';
/** Real local HTTP/services/storage with an explicitly synthetic private clock.
 * The browser cannot set that clock through any request or production route. */
export async function createProgressionReviewFixture(){
 const f=await createCollectionEdgeFixture({assetCount:6,startServer:false});let now=f.nowMs,closed=false;
 f.db.function('progression_review_clock',()=>now);const driver={...createNodeAtomicDriver(f.db),leaseNowSql:'progression_review_clock()'},ports={crypto:createNodeCrypto(),clock:{nowMs:()=>now},ids:{next:randomUUID}};
 const quotes=createCollectionQuoteService({...ports,repository:createCollectionQuoteRepository(driver,ports)}),reservations=createProgressionReservationService({...ports,repository:createProgressionReservationRepository(driver,ports)}),app=createApp(f.db,{clock:()=>now});
 const server=createLocalServer(async(request,peer)=>{
  const progression=await handleProgression(request,{quotes,reservations,authenticate:async req=>{const session=currentSession(f.db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},consumeQuota:async(bucket,limit)=>consumeQuota(f.db,bucket,now,limit)});
  return progression?represent(request,progression,now):app(request,peer);
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
 catch(error){await f.close();throw error;}
 return {...f,origin:'http://127.0.0.1:'+server.address().port,now:()=>now,advanceTo(value){if(!Number.isSafeInteger(value)||value<now)throw Error('Synthetic clock must advance.');now=value;},async close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await f.close();}};
}
