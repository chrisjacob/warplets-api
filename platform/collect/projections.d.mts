export interface StageEligibility {status:'eligible'|'ineligible'|'unknown';reason:string;cutoffAt:string|null}
export function stageEligibility(stage:{type:string;opensAt:number;wallets:readonly string[]|null},wallet:string|null):StageEligibility;
export interface StageReservationStatus {
 status:'available'|'unavailable'|'unknown';
 reason:'eligible'|'not-signed-in'|'opening-hold'|'stage-scheduled'|'stage-closed'|'sold-out'|'snapshot-pending'|'not-on-list'|'wallet-limit'|'operator-only';
 /** Content identity of the accepted immutable cut; absent before acceptance. */
 snapshotId:string|null;used:number|null;remaining:number|null;stageStatus:string;asOf:string;source:'local-fixture';executable:false;
}
export function stageReservationStatus(stage:{type:string;opensAt:number;wallets:readonly string[]|null;walletLimit:number},wallet:string|null,context:{now:number;status:string;used:number|null;openingHold:string|null;snapshotId?:string|null}):StageReservationStatus;
export interface SeasonExpiry {level:number;expiresAt:string;remainingMs:number}
export function expirySchedule(start:number,now:number):SeasonExpiry[];
export interface InventoryCounts {paid:number;free:number;founder:number;pending:number;unsold:number;unmintedReserve:number}
export function inventoryDisclosure(db:unknown,id:string,counts:InventoryCounts,start:number|null,now:number):{
 asOf:string;counts:InventoryCounts&{paidStageAllocations:number;freeStageAllocations:number;founderStageAllocations:number};
 revealedLevelCounts:number[];concealedCount:number;seasonExpiries:SeasonExpiry[]|null;
};
