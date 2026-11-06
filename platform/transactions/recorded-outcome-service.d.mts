import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
import type {RecordedOutcomeInput,RecordedOutcomeCommand,RecordedOutcomeRepository,RecordedOutcomeService} from '../application/recorded-outcomes';
export type {RecordedOutcomeInput,RecordedOutcomeCommand,RecordedOutcomeRepository,RecordedOutcomeService} from '../application/recorded-outcomes';
export const RECORD_TRANSACTION_OUTCOME:'transactions.record-outcome.v1';
export function normalizeRecordedOutcomeInput(value:unknown):RecordedOutcomeInput;
export function recordedOutcomeRequestBytes(command:Pick<RecordedOutcomeCommand,'principal'|'input'>):Uint8Array;
export function buildRecordedOutcomeCommand(principal:OperatorPrincipal,value:RecordedOutcomeInput&{requestKey:string},crypto:CanonicalCrypto):Promise<RecordedOutcomeCommand>;
export function createRecordedOutcomeService(ports:{repository:RecordedOutcomeRepository;crypto:CanonicalCrypto}):RecordedOutcomeService;
