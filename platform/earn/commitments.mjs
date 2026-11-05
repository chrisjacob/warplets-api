import {sha256Sync} from '../security/node-crypto.mjs';
import {commitmentBytes} from '../security/canonical.mjs';
import * as core from './commitment-core.mjs';
export const FORMAT=core.FORMAT;
export const allocationContext=core.allocationContext;
export function commitment(type,value){return sha256Sync(commitmentBytes(type,value));}
function run(iterator){
 let step=iterator.next();while(!step.done)step=iterator.next(commitment(...step.value));return step.value;
}
export function awardRoot(context,awards){return run(core.awardRoot(context,awards));}
export function makeAwardProof(allocation,wallet){return run(core.makeAwardProof(allocation,wallet));}
export function verifyAwardProof(proof,expectedRoot){return run(core.verifyAwardProof(proof,expectedRoot));}
export function verifyManifest(manifest,expectedDigest){return run(core.verifyManifest(manifest,expectedDigest));}
