import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
import type {RecordedHeightInput,RecordedHeightCommand,RecordedHeightRepository,RecordedHeightService} from '../application/recorded-heights';
export const EXPIRE_RECORDED_ATTEMPT:'transactions.expire-recorded-attempt.v1';
export function recordedHeightRequestBytes(command:Pick<RecordedHeightCommand,'principal'|'input'>):Uint8Array;
export function buildRecordedHeightCommand(principal:OperatorPrincipal,value:RecordedHeightInput&{requestKey:string},crypto:CanonicalCrypto):Promise<RecordedHeightCommand>;
export function createRecordedHeightService(ports:{repository:RecordedHeightRepository;crypto:CanonicalCrypto}):RecordedHeightService;
