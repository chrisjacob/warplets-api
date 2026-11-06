import {randomUUID} from 'node:crypto';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCollectionQuoteRepository} from './quote-repository.mjs';
import {createCollectionQuoteService} from './quote-service.mjs';
import {createProgressionReservationRepository} from './reservation-repository.mjs';
import {createProgressionReservationService} from './reservation-service.mjs';
export function createNodeProgressionServices(db,{clock={nowMs:Date.now},ids={next:randomUUID}}={}){
 const driver=createNodeAtomicDriver(db),ports={crypto:createNodeCrypto(),clock,ids};
 return {quotes:createCollectionQuoteService({...ports,repository:createCollectionQuoteRepository(driver,ports)}),
  reservations:createProgressionReservationService({...ports,repository:createProgressionReservationRepository(driver,ports)})};
}
