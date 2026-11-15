import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,Principal} from '../application/ports';
export function createPostContentService(options:{driver:AtomicDriver;crypto:CanonicalCrypto;clock?:{nowMs():number};fetcher?:typeof fetch}):{walletContent(principal:Principal|null,submissionId:string):Promise<unknown>};
