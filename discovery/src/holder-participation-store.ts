import {holderAcquisitionInputs} from "./holder-acquisition-store";
import {reviewHolderParticipationContext} from "./holder-participation";
import {reviewHolderAcquisitionData} from "./holder-acquisition";
import {reviewTradeSampleContext} from "./trade-sample";
import type {HolderHistoryInput} from "./holder-history-model";
export async function holderParticipation(db:D1Database,address:string,at=new Date(),history?:HolderHistoryInput){
  const inputs=await holderAcquisitionInputs(db,address,at,history),context=await reviewHolderAcquisitionData(inputs);
  return {inputs,report:await reviewHolderParticipationContext(context),trades:await reviewTradeSampleContext(context)};
}
