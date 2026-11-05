import type {CanonicalCrypto} from '../application/ports';
export const QUOTE_COMPARISON_FORMAT:'10x.local.quote-comparison.v1';
export type QuoteComparisonKind='synthetic-sdk'|'captured-program';
export type QuoteComparisonProgram=Readonly<{address:string;binaryDigest:string|null;decoderVersion:string}>;
export type QuoteComparisonIdentities=Readonly<{attMint:string;ogMint:string;attVault:string;ogVault:string}>;
export type QuoteComparisonContext=Readonly<{evidenceKind:QuoteComparisonKind;program:QuoteComparisonProgram;identities:QuoteComparisonIdentities;
 activationMs:number;currentPointMs:number;direction:'buy-att'|'sell-att';inputUnits:string;slippageBps:number}>;
export type QuoteObservedAmounts=Readonly<{kind:'amounts';outputUnits:string;grossOutputUnits:string;inputFeeUnits:string;outputFeeUnits:string;totalFeeUnits:string;nextSqrtPriceX64:string}>;
export type QuoteObservedRejection=Readonly<{kind:'rejected';errorCode:string}>;
/** A raw-pool-only record. It does not verify oracle, vault funding or authority. */
export type QuoteComparisonRecord=QuoteComparisonContext&Readonly<{format:typeof QUOTE_COMPARISON_FORMAT;id:string;
 source:Readonly<{fileDigest:string;sourceCommit:string;recordingId:string;label:string}>;
 rawPool:Readonly<{address:string;owner:string;data:string;byteDigest:string}>;observed:QuoteObservedAmounts|QuoteObservedRejection}>;
/** Independently retained pins, supplied separately from the compared record. */
export type QuoteComparisonExpected=QuoteComparisonContext&Readonly<{sourceFileDigest:string;sourceCommit:string;recordingId:string;recordDigest:string;
 rawPool:Readonly<{address:string;byteDigest:string}>}>;
export type QuoteComparisonRequirement=Readonly<{id:string;expected:QuoteComparisonExpected;recordIds:readonly string[];missingReason:null}>|
 Readonly<{id:string;expected:null;recordIds:readonly [];missingReason:string}>;
export type QuoteComparisonResult=Readonly<{recordId:string;evidenceKind:QuoteComparisonKind;scope:'synthetic-arithmetic'|'recorded-program-comparison';coverage:'raw-pool-only';
 status:'matched'|'incompatible'|'failed';reason:string;hashes:Readonly<{recordDigest:string;sourceFileDigest:string;poolByteDigest:string;programBinaryDigest:string|null}>;
 expectedErrorCode?:string|null;actualErrorCode?:string|null;differences?:readonly string[];actual?:Omit<QuoteObservedAmounts,'kind'>;executable:false;financialExecution:false}>;
export type QuoteComparisonMatrix=Readonly<{format:typeof QUOTE_COMPARISON_FORMAT;items:readonly Readonly<{id:string;status:'matched'|'missing'|'failed';reason:string;missingRecordIds:readonly string[];comparisons:readonly QuoteComparisonResult[]}>[];
 counts:Readonly<{matched:number;missing:number;failed:number}>;executable:false;financialExecution:false}>;
export function createQuoteComparison(ports:{crypto:CanonicalCrypto}):Readonly<{
 compare(record:QuoteComparisonRecord,expected:QuoteComparisonExpected):Promise<QuoteComparisonResult>;
 matrix(input:{records:readonly QuoteComparisonRecord[];requirements:readonly QuoteComparisonRequirement[]}):Promise<QuoteComparisonMatrix>;
}>;
