import type {AtomicDriver} from '../storage/atomic-earn.mjs';
export type BallotChoice='ASAP'|'7'|'14'|'30';
export interface BallotRead {id:string;source:'local-fixture';status:'open'|'closed'|'scheduled';opensAt:string;closesAt:string;choices:readonly BallotChoice[];eligibleWallets:number;votesCast:number;counts:Record<BallotChoice,number>|null;decision:{choice:BallotChoice;rationale:string;earliestOpening:string}|null}
export interface BallotList {items:BallotRead[];nextCursor:null;asOf:string}
export type GovernanceReadOutcome<T>={kind:'ready';value:T}|{kind:'conflict';code:string}|{kind:'pending';reason:string;dependencyIds:string[]};
export interface GovernanceReadModel {listBallots(query:{nowMs:number}):Promise<GovernanceReadOutcome<BallotList>>;readBallot(query:{id:string;nowMs:number}):Promise<GovernanceReadOutcome<BallotRead>>}
export function createGovernanceReadModel(driver:AtomicDriver):GovernanceReadModel;
