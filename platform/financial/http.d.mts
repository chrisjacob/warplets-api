import type {Principal as WalletPrincipal} from '../application/ports';
import type {FinancialReadService} from '../application/financial-reads';
export function handleFinancialReads(request:Request,ports:{service:FinancialReadService;authenticate:(request:Request)=>Promise<WalletPrincipal|null>}):Promise<Response|null>;
