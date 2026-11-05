import type {EvidenceSource} from '../evidence/types';

export type QuoteMarket=Readonly<{id:string;attMint:string;ogMint:string;poolAddress:string;activationMs:number}>;
export type QuoteSupply=Readonly<{originalUnits:string;manifestDigest:string}>;
export type QuoteSourcePolicy=Readonly<{version:1;marketId:string;poolProgram:string;programBinaryDigest:string|null;approvedOgFeed:string;
 attDecimals:number;ogDecimals:number;accountMaxAgeMs:number;oracleMaxAgeMs:number;maxConfidenceBps:number;maxOracleSlotSkew:number}>;
export type QuoteRawAccount=Readonly<{address:string;owner:string;data:string;contextSlot:string;blockTimeMs:number;retrievedAtMs:number}>;
export type QuoteAccountName='pool'|'attMint'|'ogMint'|'attVault'|'ogVault';
export type QuoteOracle=Readonly<{feed:string;mint:string;decimals:number;priceMicros:string;confidenceMicros:string;
 publicationMs:number;publicationSlot:string;retrievedAtMs:number;investigationOpen:false}>;
/** Synthetic provenance is explicit. Recorded/public authenticity is not
 * implemented by the composite fixture decoder or this application contract. */
export type QuoteCapture=Readonly<{version:1;mode:'synthetic-fixture';marketId:string;observedMs:number;contextSlot:string;blockTimeMs:number;retrievedAtMs:number;
 finality:'finalized';investigationOpen:false;program:Readonly<{address:string;binaryDigest:null}>;
 accounts:Readonly<Record<QuoteAccountName,QuoteRawAccount>>;oracle:QuoteOracle}>;
export type QuoteBinding=Readonly<{receiptDigest:string;selectedHeadDigest:string;sourceId:string;sourceRevision:string;sourceConfigDigest:string;streamKey:string;
 envelopeByteDigest:string;objectRef:string;contextSlot:string;blockTimeMs:number;retrievedAtMs:number;ingestedAtMs:number}>;
export type QuoteCaptureInput=Readonly<{market:QuoteMarket;supply:QuoteSupply;source:EvidenceSource;capture:QuoteCapture;binding:QuoteBinding}>;
export type QuoteCaptureInspectionInput=Omit<QuoteCaptureInput,'binding'>&Readonly<{ingestedAtMs:number}>;
export type QuoteRequest=Readonly<{marketId:string;direction:'buy-att'|'sell-att';inputUnits:string;slippageBps:number}>;
export type QuoteDecodedPool=Readonly<{attMint:string;ogMint:string;attVault:string;ogVault:string;liquidity:string;sqrtMinPriceX64:string;sqrtMaxPriceX64:string;
 sqrtPriceX64:string;activationMs:number;activationType:number;poolStatus:number;collectFeeMode:number;feeVersion:number;dynamicFeeInitialized:number;
 compoundingFeeBps:number;protocolFeePercent:number;permanentlyLockedLiquidity:string;attDecimals:number;ogDecimals:number}>;
export type QuoteVerifiedData=Readonly<{pool:QuoteDecodedPool;attVaultUnits:string;ogVaultUnits:string;ogUsdMicros:string;originalSupplyUnits:string;expiresMs:number}>;
export type VerifiedQuoteInput=Readonly<{version:1;marketId:string;data:QuoteVerifiedData;binding:QuoteBinding;accountByteDigests:Readonly<Record<QuoteAccountName,string>>;
 policyDigest:string;sourceDigest:string;manifestDigest:string;observedMs:number;oraclePublicationMs:number;oraclePublicationSlot:string;oracleRetrievedAtMs:number;
 verifiedAtMs:number;mode:'synthetic-fixture'}>;
export type QuoteDto=Readonly<{id:string;version:1;marketId:string;direction:'buy-att'|'sell-att';inputMint:string;outputMint:string;inputDecimals:number;outputDecimals:number;
 inputUnits:string;expectedOutputUnits:string;minimumOutputUnits:string;grossOutputUnits:string;inputFeeUnits:string;outputFeeUnits:string;feeBps:number;priceImpactBps:string;nextSqrtPriceX64:string;
 slippageBps:number;quotedAt:string;expiresAt:string;contextSlot:number;observedAt:string;sourceHash:string;spotFdvUsdMicros:string;effectiveBuyFdvUsdMicros:string|null;
 fees:Readonly<{asset:string;side:'input'|'output';networkLamports:null;accountRentLamports:null}>;source:'local-fixture';route:'meteora-damm-v2';executable:false;
 evidence?:Readonly<{mode:'synthetic-fixture';scope:'synthetic-transcript';receiptDigest:string;sourceId:string;sourceRevision:string;sourceConfigDigest:string;policyDigest:string;
 manifestDigest:string;captureByteDigest:string;accountByteDigests:Readonly<Record<QuoteAccountName,string>>;blockTimeMs:number;retrievedAtMs:number;ingestedAtMs:number;
 oraclePublicationMs:number;oraclePublicationSlot:string;oracleRetrievedAtMs:number;evaluatedAtMs:number;programBinaryDigest:null;capturedProgramParity:'missing'}>}>;
