import type {CanonicalCrypto,Principal} from './ports';
import type {GovernanceRepository,VoteResult} from '../governance/repository.mjs';
import type {GovernanceReadModel,BallotRead,BallotList,BallotChoice} from '../governance/read-model.mjs';
export class GovernanceError extends Error {readonly status:number;readonly code:string;constructor(status:number,code:string,message:string)}
export interface GovernanceService {listBallots():Promise<BallotList>;readBallot(id:string):Promise<BallotRead>;castVote(principal:Principal,input:{ballotId:string;choice:BallotChoice}):Promise<VoteResult>}
export function createGovernanceService(ports:{repository:GovernanceRepository;reads:GovernanceReadModel;crypto:CanonicalCrypto;clock:{nowMs():number}}):GovernanceService;
