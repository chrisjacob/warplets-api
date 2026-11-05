import type {CanonicalCrypto} from '../application/ports';
import type {Recording,RecordedReader} from './types';
export function createRecordedReader(input:{mode:'synthetic-fixture'|'recorded-public';chainGenesis:string|null;records:readonly Recording[];crypto:CanonicalCrypto}):Promise<RecordedReader>;
