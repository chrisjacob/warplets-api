import { EarnError, name, nat, requireValue, canonicalContentUrl } from './validation.mjs';
import { ADMIT_SUBMISSION, admissionRequestBytes } from '../application/commands.mjs';
function walletPrincipal(principal) {
  if(principal?.kind!=='wallet')throw new EarnError(401,'authentication_required','Connect your wallet.');
  return Object.freeze({kind:'wallet',wallet:name(principal.wallet,'wallet')});
}
export function createEarnService(context) {
  if(context.executionPolicy?.mode!=='local-validation'||context.executionPolicy.financialExecution!==false)
    throw new TypeError('Financial execution is unavailable.');
  const repository=context.repositories.earn;
  return Object.freeze({
    async submitContent(principal,{tokenId,url,requestKey}) {
      principal=walletPrincipal(principal);name(tokenId,'token');
      requireValue(typeof requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey),'Supply an Idempotency-Key of 1–128 characters.');
      const input=Object.freeze({tokenId,url:canonicalContentUrl(url)}),nowMs=nat(context.clock.nowMs(),'now');
      const requestDigest=await context.crypto.sha256(admissionRequestBytes({principal,input}));
      return await repository.admitSubmission(Object.freeze({principal,operationKind:ADMIT_SUBMISSION,
        businessIdentity:principal.wallet+'/'+tokenId,requestKey,requestDigest,expectedRevisions:Object.freeze({}),input,nowMs}));
    },
    async readLeaderboard(epoch) {return await repository.readLeaderboard({epoch:nat(epoch,'epoch')});},
    async readWalletClaims(principal,{after=0}={}) {
      return await repository.readWalletClaims({principal:walletPrincipal(principal),nowMs:nat(context.clock.nowMs(),'now'),after:nat(after,'cursor')});
    },
    async readWalletSubmissions(principal,{after=0}={}) {
      return await repository.readWalletSubmissions({principal:walletPrincipal(principal),after:nat(after,'cursor')});
    },
  });
}
