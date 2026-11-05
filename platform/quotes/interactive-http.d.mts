import type {QuoteService} from './service.mjs';
export function handleInteractiveQuotes(request:Request,ports:{service:QuoteService;consumeQuota:(bucket:string,limit:number)=>Promise<Response|null>;peer:string}):Promise<Response|null>;
