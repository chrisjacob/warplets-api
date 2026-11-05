export interface EligibilityPreviewPacket {
 inventoryId:string;stageId:string;sourceRef:string;at:number;finalized:boolean;
 holdings:Array<{id:string;owner:string;collection:string;level:number|null;revealedAt:number|null}>;
 source:{id:string;chain:'solana';collection:'solana-genesis';slot:string;blockTimeMs:number;ownerRef:string;revealRef:string};
 coverage:{status:'complete'|'incomplete'|'unknown';expectedCount:number|null;pages:Array<{cursor:string|null;nextCursor:string|null;ids:string[]}>};
}
export interface EligibilityPreview {
 mode:'local-fixture';readOnly:true;executable:false;chainCompleteness:'unverified';inventoryId:string;stageId:string;inventoryRevision:number;
 termsDigest:string;cutoffAt:string;asOf:string;source:EligibilityPreviewPacket['source']|null;sourceDigest:string;inputDigest:string;snapshotDigest:string;
 publication:{status:'already-published'|'conflict'|'ready-local-fixture'|'held';snapshotId:string|null};
 counts:{inputHoldings:number;eligibleCandidates:number;eligibleWallets:number;unknownWallets:number;lateRevealHoldings:number;conflicts:number;duplicates:number;normalizationIssues:number};
 coverage:{status:'complete-local-transcript'|'incomplete';expectedCount:number|null;observedCount:number;pages:number};
 ready:boolean;issues:Array<{code:string;assetId:string|null}>;normalizationIssues:Array<{index:number;assetId:string;reason:string}>;
 wallets:Array<{wallet:string;status:'unknown'|'eligible'|'ineligible';reasons:string[]}>;holdings:Array<{assetId:string;wallet:string;reason:string}>;
}
/** Read-only local SQLite snapshot, no provider calls or publication authority. */
export function previewSeasonEligibility(db:unknown,input:EligibilityPreviewPacket,now?:number):EligibilityPreview;
