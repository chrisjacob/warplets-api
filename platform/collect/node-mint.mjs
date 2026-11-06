import {randomUUID} from 'node:crypto';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {createMintReservationService} from './mint-service.mjs';
export function createNodeMintServices(db,{clock={nowMs:Date.now},ids={next:randomUUID}}={}){
 const driver=createNodeAtomicDriver(db),ports={crypto:createNodeCrypto(),clock,ids};
 return {reservations:createMintReservationService({...ports,repository:createMintReservationRepository(driver,ports)})};
}
