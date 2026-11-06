import type {Receipt} from './models';
import {Signal,utc} from './common';
export function CollectionOperationHold({operation}:{operation:Receipt}){
 return operation.reconciliation?<Signal>Held after an observed transfer; no fulfillment recorded. Earliest observed transfer: {utc(operation.reconciliation.observedAt)}. The original request remains awaiting evidence.</Signal>:null;
}
