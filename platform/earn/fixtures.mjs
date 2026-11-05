// Synthetic-only compatibility seeds. No public ingress or portable service
// imports this adapter; its nominal USD number is never chain evidence.
import { decimal } from './validation.mjs';
import { recordSamplePrice } from '../pricing/fixtures.mjs';
export function recordStakeRead(db,{wallet,tokenId,observedMs,expiresMs,microUsd,sourceRef}) {
  decimal(microUsd,'synthetic holding');
  const result=recordSamplePrice(db,{wallet,tokenId,asOfMs:observedMs,stakedUnits:microUsd,
    validUntilMs:expiresMs,sourceRef});
  return {id:result.receipt};
}
