import type {CanonicalCrypto,OperatorPrincipal,Principal,Revisions} from './ports';
import type {PublishGenesisBallotCommand,CastGenesisVoteCommand,RecordGenesisDecisionCommand} from './collections';
import type {CollectionSourceRecord} from '../collect/state-codec.mjs';
type Args<C extends {principal:Principal|OperatorPrincipal;input:unknown}>=Readonly<{principal:C['principal'];input:C['input'];requestKey:string;expectedRevisions:Revisions;nowMs:number}>;
export interface FrozenBallotHeader {id:string;opensAt:number;closesAt:number;currentTrancheOpenedAt:number;snapshotHash:string}
export interface ElectorateSource {sourceId:string;cutoffMs:number;holders:readonly string[];nextWhitelist:readonly string[]}
export interface PlannedVote {ballotId:string;wallet:string;choice:'ASAP'|'7'|'14'|'30';votedMs:number}
export interface PlannedDecision {ballotId:string;choice:'ASAP'|'7'|'14'|'30';decidedMs:number;noticeMs:number;earliestMs:number;rationale:string}
export interface GovernancePlanning {
 publishBallot(args:Args<PublishGenesisBallotCommand>):Promise<PublishGenesisBallotCommand>;
 castVote(args:Args<CastGenesisVoteCommand>):Promise<CastGenesisVoteCommand>;
 recordDecision(args:Args<RecordGenesisDecisionCommand>):Promise<RecordGenesisDecisionCommand>;
 electorateDigest(source:ElectorateSource):Promise<string>;
 planPublication(command:PublishGenesisBallotCommand,source:ElectorateSource):Promise<{status:'ready';result:{ballotId:string;snapshotHash:string;eligibleCount:number;opensAt:number;closesAt:number;currentTrancheOpenedAt:number;electorateManifestId:string;sourceId:string;sourceDigest:string;executable:false};electorate:{manifest:CollectionSourceRecord;pages:readonly CollectionSourceRecord[]}}>;
 planVote(command:CastGenesisVoteCommand,facts:{ballot:FrozenBallotHeader;membership:{wallet:string;snapshotHash:string;eligible:boolean};priorVote:PlannedVote|null}):{status:'ready';replayed:boolean;vote:PlannedVote;voteCountDelta:0|1};
 planDecision(command:RecordGenesisDecisionCommand,facts:{ballot:FrozenBallotHeader;priorDecision:PlannedDecision|null}):{status:'ready';replayed:boolean;decision:PlannedDecision};
}
export function createGovernancePlanning(ports:{crypto:CanonicalCrypto}):GovernancePlanning;
