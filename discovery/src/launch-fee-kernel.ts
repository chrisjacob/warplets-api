// Meteora SDK 1.5.1 feeMath.ts / swapQuote.ts at 79ebbfe59a225e641a2f37cd03404f26de1b0c8e.
// BigInt adaptation, MIT copyright (c) 2026 Meteora; ../protocol/meteora-MIT-LICENSE.txt.
// Scope: non-compounding OnlyB, static fee v1, exact input, no transfer extensions.
import {ceilDiv,curveSwap,LaunchError} from "./launch-curve";
export const FEE_DENOMINATOR=1000000000n;
export function quoteOnlySwap(lower:bigint,upper:bigint,current:bigint,liquidity:bigint,gross:bigint,aForB:boolean,feeNumerator:bigint,protocolPercent:number,referralPercent:number,hasReferral:boolean){
  if(gross<=0n||feeNumerator<100000n||feeNumerator>990000000n||!Number.isInteger(protocolPercent)||protocolPercent<0||protocolPercent>100||!Number.isInteger(referralPercent)||referralPercent<0||referralPercent>100)throw new LaunchError("launch_fee_parameters_invalid");
  const feesOnInput=!aForB,inputFee=feesOnInput?ceilDiv(gross*feeNumerator,FEE_DENOMINATOR):0n,netInput=gross-inputFee;
  if(netInput===0n)return {status:"fee_consumes_input" as const};
  const curve=curveSwap(lower,upper,current,liquidity,netInput,aForB);
  if(!curve)return {status:"range_exhausted" as const};
  const totalFee=feesOnInput?inputFee:ceilDiv(curve.output*feeNumerator,FEE_DENOMINATOR);
  const protocolBeforeReferral=totalFee*BigInt(protocolPercent)/100n,referral=hasReferral?protocolBeforeReferral*BigInt(referralPercent)/100n:0n;
  return {status:"quoted" as const,next:curve.next,netInput,curveOutput:curve.output,traderOutput:feesOnInput?curve.output:curve.output-totalFee,
    totalFee,lpClaiming:totalFee-protocolBeforeReferral,protocol:protocolBeforeReferral-referral,referral,feesOnInput};
}
