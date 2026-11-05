import type {CanonicalCrypto} from '../application/ports';
import type {QuoteCaptureInput,QuoteCaptureInspectionInput,VerifiedQuoteInput,QuoteVerifiedData,QuoteRequest,QuoteDto} from '../application/quotes';
export const MAX_QUOTE_AGE_MS:30000;
export function inspectLegacyQuoteCapture(market:unknown,fixture:unknown,originalSupply:string,approvedFeed:string,now:number):QuoteVerifiedData;
export function evaluateQuoteData(input:{data:QuoteVerifiedData;request:QuoteRequest;nowMs:number;source:{contextSlot:number;observedMs:number;sourceHash:string}}):Omit<QuoteDto,'id'|'evidence'>;
export function inspectQuoteCapture(input:QuoteCaptureInspectionInput):Readonly<{input:QuoteCaptureInspectionInput;data:QuoteVerifiedData}>;
export function verifyQuoteCapture(input:QuoteCaptureInput,crypto:CanonicalCrypto):Promise<VerifiedQuoteInput>;
export function evaluateVerifiedQuote(input:{input:VerifiedQuoteInput;request:QuoteRequest;evaluatedAtMs:number},crypto:CanonicalCrypto):Promise<QuoteDto>;
