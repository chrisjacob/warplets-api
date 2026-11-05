export type PositionEvent={type:'verified-buy-and-stake'|'withdrawal'|'deposit'|'reward'|'restake'|'exit'|'position-transfer';signature:string;instructionIndex:number;
 wallet:string;tokenId:string;sequence:number;atMs:number;confirmed:true;swapIndex?:number;netBoughtUnits?:string;depositedUnits?:string;
 withdrawnUnits?:string;remainingStakeUnits?:string};
export type PositionCheckpoint={epoch:number;sequence:number;credited:string;stake:string;numerator:string;denominator:string;flags:number[];tokenDays:number;sourceRef:string};
export type PositionValuation={epoch:number;asOfMs:number;status:string;microUsd?:string;stakedUnits?:string;priceNumerator?:string;priceDenominator?:string;
 expiresMs?:number;receipt?:string;readId?:string};
export type PositionChainInput={wallet:string;tokenId:string;enrolledMs:number;activationMs:number;throughEpoch:number;events:readonly PositionEvent[];
 checkpoints:readonly PositionCheckpoint[];valuations:readonly PositionValuation[]};
export type PositionChainResult={status:'pending';dependencies:{epoch:number;reason:string}[]}|{status:'ready';chain:PositionCheckpoint[];
 position:{wallet:string;tokenId:string;sequence:number;creditedUnits:string;flags:number[];lastEpoch:number;suspended:boolean};tokenDays:number};
/** Coordinator supplies a complete v2 journal and independently bound daily price receipts. */
export function verifyPositionChain(input:PositionChainInput):PositionChainResult;
