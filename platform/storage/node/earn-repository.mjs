import { submitContent, readLeaderboard, readWalletClaims, readWalletSubmissions } from './earn-workflow.mjs';
import { ADMIT_SUBMISSION, admissionRequestBytes } from '../../application/commands.mjs';
import { sha256Sync } from '../../security/node-crypto.mjs';
// Synchronous reference transactions finish before each async command resolves.
// Revision-checked D1 settlement and durable command receipts belong to B02/B07;
// the existing wallet/request-key admission receipt remains authoritative here.
export function createNodeEarnRepository(db,{ids}={}) {
  return Object.freeze({
    async admitSubmission(command) {
      const {principal,input}=command;
      if(principal?.kind!=='wallet'||command.operationKind!==ADMIT_SUBMISSION
        ||command.businessIdentity!==principal.wallet+'/'+input.tokenId
        ||command.requestDigest!==sha256Sync(admissionRequestBytes(command))
        ||!command.expectedRevisions||Object.keys(command.expectedRevisions).length!==0)
        throw new TypeError('Invalid reference admission command.');
      return submitContent(db,{wallet:principal.wallet,tokenId:input.tokenId,url:input.url,
        requestKey:command.requestKey,nowMs:command.nowMs},ids?{ids}:undefined);
    },
    async readLeaderboard({epoch}) {return readLeaderboard(db,epoch);},
    async readWalletClaims({principal,nowMs,after}) {return readWalletClaims(db,{wallet:principal.wallet,nowMs,after});},
    async readWalletSubmissions({principal,after}) {return readWalletSubmissions(db,{wallet:principal.wallet,after});},
  });
}
