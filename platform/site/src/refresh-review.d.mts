export interface RefreshReviewJournal {format:'10x.local.refresh-review.v1';wallet:string;requestId:string;requestKey:string;token:string;commandDigest:string;body:{action:'approve'|'request-fulfillment';expectedRevision:number;expectedStateDigest:string;previewDigest:string;quoteDigest:string};attempted:boolean;expiresAtMs:number}
export function clearRefreshReview():void;
export function saveRefreshReview(value:RefreshReviewJournal):void;
export function loadRefreshReview(wallet:string):RefreshReviewJournal|null;
