import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
import type {RecordedPacketInput,RecordedPacketCommand,RecordedPacketRepository,RecordedPacketService} from '../application/recorded-packets';
export const PREPARE_RECORDED_ATTEMPT:'transactions.prepare-recorded-attempt.v1';
export function recordedPacketRequestBytes(command:Pick<RecordedPacketCommand,'principal'|'input'>):Uint8Array;
export function buildRecordedPacketCommand(principal:OperatorPrincipal,value:RecordedPacketInput&{requestKey:string},crypto:CanonicalCrypto):Promise<RecordedPacketCommand>;
export function createRecordedPacketService(ports:{repository:RecordedPacketRepository;crypto:CanonicalCrypto}):RecordedPacketService;
