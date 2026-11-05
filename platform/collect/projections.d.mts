export interface StageEligibility {status:'eligible'|'ineligible'|'unknown';reason:string;cutoffAt:string|null}
export function stageEligibility(stage:{type:string;opensAt:number;wallets:readonly string[]|null},wallet:string|null):StageEligibility;
export interface SeasonExpiry {level:number;expiresAt:string;remainingMs:number}
export function expirySchedule(start:number,now:number):SeasonExpiry[];
export interface InventoryCounts {paid:number;free:number;founder:number;pending:number;unsold:number;unmintedReserve:number}
export function inventoryDisclosure(db:unknown,id:string,counts:InventoryCounts,start:number|null,now:number):{
 asOf:string;counts:InventoryCounts&{paidStageAllocations:number;freeStageAllocations:number;founderStageAllocations:number};
 revealedLevelCounts:number[];concealedCount:number;seasonExpiries:SeasonExpiry[]|null;
};
