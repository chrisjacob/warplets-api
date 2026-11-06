import type {CanonicalCrypto,AppTelemetry,RepositoryOutcome} from '../application/ports';
import type {CastGenesisVoteCommand} from '../application/collections';
import type {AtomicDriver} from '../storage/atomic-earn.mjs';
export interface VoteResult {choice:'ASAP'|'7'|'14'|'30';replayed:boolean}
export interface GovernanceRepository {castVote(command:CastGenesisVoteCommand):Promise<RepositoryOutcome<VoteResult>>}
export function createGovernanceRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):GovernanceRepository;
