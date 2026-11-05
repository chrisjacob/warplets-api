import type {CanonicalCrypto,OperatorPrincipal,Revisions} from '../application/ports';
import type {JobType,JobInput,JobCommand} from './repository.mjs';
export const JOB_TYPES:readonly JobType[];
export function createJobCommand(args:{principal:OperatorPrincipal;requestKey:string;input:JobInput;nowMs:number;expectedRevisions?:Revisions},crypto:CanonicalCrypto):Promise<JobCommand>;
