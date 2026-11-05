import type {AppTelemetry,CanonicalCrypto,Principal,RepositoryOutcome,Revisions} from '../application/ports';
import type {ActionProof} from '../earn/action-proof.mjs';
import type {AtomicDriver} from './atomic-earn.mjs';
export const ACCEPT_ACTION:'earn.accept-action.v1';
export type ActionCompletionInput=Readonly<{actionId:string;proof:ActionProof;signature:string}>;
export type AtomicActionCommand=Readonly<{operationKind:typeof ACCEPT_ACTION;principal:Principal;input:ActionCompletionInput;nowMs:number;expectedRevisions:Revisions;businessIdentity:string;requestKey:string;requestDigest:string}>;
export type AcceptedActionCompletion=Readonly<{actionId:string;verifiedAtMs:number;proofDigest:string;replay:boolean}>;
export interface AtomicActionRepository {acceptCompletion(command:AtomicActionCommand):Promise<RepositoryOutcome<AcceptedActionCompletion>>}
export function createActionCommand(input:Readonly<{principal:Principal;input:ActionCompletionInput;nowMs:number;expectedRevisions?:Revisions}>,crypto:CanonicalCrypto):Promise<AtomicActionCommand>;
export function createAtomicActionRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):AtomicActionRepository;
