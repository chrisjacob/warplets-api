import {holderAcquisitionInputs} from "./holder-acquisition-store";
import {reviewHolderParticipation} from "./holder-participation";
import type {HolderHistoryInput} from "./holder-history-model";
export async function holderParticipation(db:D1Database,address:string,at=new Date(),history?:HolderHistoryInput){const inputs=await holderAcquisitionInputs(db,address,at,history);return {inputs,report:await reviewHolderParticipation(inputs)};}
