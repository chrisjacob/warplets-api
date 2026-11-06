import type {CanonicalCrypto,Principal} from './ports';
import type {ProgressionReservationCommand,ImmutableProgressionQuote} from './collections';
export interface QuoteParticipant {id:string;inventoryId:string;owner:string;revealStatus:'revealed'|'unrevealed';level:number;traits:{model:string;backdrop:string;symbol:string};version:number;rerolls:number;eligibleAt:number;pending:string|null;expiresAt:number;ownerObservedAtMs:number|null}
export interface ProgressionQuoteContext {kind:'season';seasonId:string;start:number;assets:readonly QuoteParticipant[]}
export interface DeriveProgressionQuote {quoteId:string;principal:Principal;inventoryId:string;request:{kind:'upgrade'|'visual';targetId:string;materialId?:string|null;expectedTargetVersion:number;expectedMaterialVersion?:number|null};context:ProgressionQuoteContext;policyVersion:string;nowMs:number;expiresMs:number;maxTotalLamports?:string}
export interface ProgressionAcceptancePlan {status:'ready';quoteId:string;bindingDigest:string;inventoryId:string;sourceDigest:string;operation:{kind:'upgrade'|'visual';operationId:string;commitment:string;signer:string;targetId:string;expectedTargetVersion:number;materialId:string|null;expectedMaterialVersion:number|null;preparedAt:number;feeLamports:string;result:null};assetWrites:readonly Omit<QuoteParticipant,'inventoryId'|'revealStatus'|'ownerObservedAtMs'>[];requiredVersions:{target:number;material:number|null};executable:false}
export interface CollectionQuotePlanning {
 derive(input:DeriveProgressionQuote):Promise<ImmutableProgressionQuote>;
 accept(command:ProgressionReservationCommand,storedQuote:ImmutableProgressionQuote,currentContext:ProgressionQuoteContext,options:{operationId:string;commitment:string;policyVersion:string}):Promise<ProgressionAcceptancePlan>;
}
export function createCollectionQuotePlanning(ports:{crypto:CanonicalCrypto}):CollectionQuotePlanning;
