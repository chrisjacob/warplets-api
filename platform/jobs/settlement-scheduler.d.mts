import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
export function createSettlementScheduler(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;principal:OperatorPrincipal}):{
 scheduleCampaigns(options?:{after?:string;limit?:number}):Promise<{kind:'scheduled';count:number;next:string|null}|{kind:'pending';reason:string}|{kind:'conflict';code:string}>;
};
