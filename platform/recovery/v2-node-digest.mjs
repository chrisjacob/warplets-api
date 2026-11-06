import {createHash} from 'node:crypto';
import {checkedBytes} from '../security/canonical.mjs';
/** Private recovery: fresh native state per bounded invocation, never persisted. */
export function createNodeRecoveryDigest(){const hash=createHash('sha256');let closed=false;return Object.freeze({async write(bytes){if(closed)throw new TypeError('Recovery digest is closed.');hash.update(checkedBytes(bytes));},async finish(){if(closed)throw new TypeError('Recovery digest is closed.');closed=true;return hash.digest('hex');},async abort(){closed=true;hash.destroy();}});}
