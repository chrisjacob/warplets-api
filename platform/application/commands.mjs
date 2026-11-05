import { canonicalJson, utf8 } from '../security/canonical.mjs';
export const ADMIT_SUBMISSION='earn.admit-submission.v1';
// Request identity excludes the current clock and generated ID: an accepted
// retry in a later board must still resolve its original receipt.
export const admissionRequestBytes=({principal,input})=>utf8(canonicalJson([
  ADMIT_SUBMISSION,principal.wallet,{tokenId:input.tokenId,url:input.url},
]));

export const FINAL_REVIEW='earn.final-review.v1';
export const reviewRequestBytes=({principal,input})=>utf8(canonicalJson([
  FINAL_REVIEW,principal.id,input,
]));
