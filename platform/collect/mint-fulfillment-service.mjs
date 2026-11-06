import {buildCollectionFulfillmentCommand} from './fulfillment-service.mjs';
/** Uses the existing frozen command identity; only the named repository selects
 * normalized mint authority. No fulfillment route is mounted by this adapter. */
export function createMintFulfillmentService({repository,crypto}){
 return Object.freeze({async fulfillMint(principal,input){return repository.fulfillMint(await buildCollectionFulfillmentCommand(principal,input,crypto));}});
}
