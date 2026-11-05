import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {ArtifactStore} from '../artifacts/store';
import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
export function createSettlementReconciler(ports:{driver:AtomicDriver;artifacts:Pick<ArtifactStore,'getVerified'>;crypto:CanonicalCrypto;clock:{nowMs():number};principal:OperatorPrincipal;ids:{next():string}}):{
 inspectBoard(query:{epoch:number}):Promise<{kind:'consistent';epoch:number;snapshotId:string;evidenceDigest:string}|{kind:'incident';id:string;epoch:number;snapshotId:string;changedRequirements:number;awardsPreserved:true}|{kind:'pending';reason:string}|{kind:'conflict';code:string}>;
};
