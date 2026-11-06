import type {CanonicalCrypto} from '../application/ports';
import type {StagePublicationInput,StagePublicationResult} from './stage-service.mjs';
export function normalizeStagePublication(input:StagePublicationInput):StagePublicationInput;
export function prepareStagePublication(input:StagePublicationInput,facts:unknown,crypto:CanonicalCrypto):Promise<Readonly<{inventoryId:string;expectedInventoryRevision:number;stageId:string;ordinal:number;stage:Readonly<Record<string,unknown>>;eligibility:StagePublicationResult['eligibility'];source:'local-fixture';executable:false}>>;
