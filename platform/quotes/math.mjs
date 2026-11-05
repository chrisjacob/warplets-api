const U64_MAX=(1n<<64n)-1n, U128_MAX=(1n<<128n)-1n;
const Q128=1n<<128n, BPS=10000n;
export const QUOTE_PROGRAM='cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
export const MIN_SQRT=4295048016n,MAX_SQRT=79226673521066979257578248091n;
export class QuoteError extends Error{
  constructor(code,message,status=422){super(message);this.code=code;this.status=status;}
}
export const requireQuote=(ok,code,message,status)=>{if(!ok)throw new QuoteError(code,message,status);};
export function units(value,name,maximum=U64_MAX){
  requireQuote(typeof value==='string' && /^(0|[1-9]\d{0,77})$/.test(value),'invalid_units','Use whole base units for '+name+'.',400);
  const n=BigInt(value);
  requireQuote(n<=maximum,'overflow',name+' exceeds its supported representation.',400);return n;
}
const ceil=(n,d)=>(n+d-1n)/d;
export function feeAt({activationMs,nowMs}){
  requireQuote(Number.isSafeInteger(activationMs)&&Number.isSafeInteger(nowMs)&&activationMs>=0,
    'invalid_time','Invalid quote time.',400);
  requireQuote(nowMs>=activationMs,'preactivation','The market has not activated.');
  return Math.max(100,9000-100*Math.floor((nowMs-activationMs)/1000));
}

/** Concentrated DAMM v2 exact-input math for the PRD's verified OnlyB, zero
 * compounding/dynamic fee configuration. The independent pinned SDK vector test
 * checks all round directions. No floating-point token arithmetic occurs here.
 */
export function validateQuotePool(pool){
  const sqrt=units(pool.sqrtPriceX64,'sqrt price',U128_MAX),min=units(pool.sqrtMinPriceX64,'minimum sqrt',U128_MAX),
    max=units(pool.sqrtMaxPriceX64,'maximum sqrt',U128_MAX),liquidity=units(pool.liquidity,'liquidity',U128_MAX);
  requireQuote(min>=MIN_SQRT && max<=MAX_SQRT && min<max && sqrt>=min&&sqrt<=max&&liquidity>0n,
    'unsupported_pool','The pool range or liquidity is invalid.');
  requireQuote(pool.collectFeeMode===1 && pool.dynamicFeeInitialized===0 && pool.compoundingFeeBps===0
    && pool.activationType===1 && pool.poolStatus===0 && pool.feeVersion===1,
    'unsupported_pool','This pool does not match the validated launch configuration.');
  return {sqrt,min,max,liquidity};
}
export function quoteAmounts({direction,inputUnits,slippageBps,pool,nowMs}){
  requireQuote(direction==='buy-att'||direction==='sell-att','invalid_direction','Choose buy-att or sell-att.',400);
  requireQuote(Number.isInteger(slippageBps)&&slippageBps>=0&&slippageBps<=500,
    'slippage_limit','The local quote limit is 0–500 basis points.',400);
  const input=units(inputUnits,'input');
  requireQuote(input>0n,'zero_input','Input must be positive.',400);
  const {sqrt,min,max,liquidity}=validateQuotePool(pool);
  const feeBps=feeAt({activationMs:pool.activationMs,nowMs}),buy=direction==='buy-att';
  const inputFee=buy?ceil(input*BigInt(feeBps),BPS):0n,actualIn=input-inputFee;
  requireQuote(actualIn>0n,'dust_input','Input is too small after the trading fee.');
  const next=buy?sqrt+actualIn*Q128/liquidity:ceil(liquidity*sqrt,liquidity+actualIn*sqrt);
  requireQuote(next>=min && next<=max,'price_range','Input exceeds the pool price range.');
  const grossOutput=buy?liquidity*(next-sqrt)/(sqrt*next):liquidity*(sqrt-next)/Q128;
  const outputFee=buy?0n:ceil(grossOutput*BigInt(feeBps),BPS);
  const output=grossOutput-outputFee;
  requireQuote(output>0n && output<=U64_MAX,'dust_output','Input produces no representable output.');
  const idealNumerator=buy?actualIn*Q128:actualIn*sqrt*sqrt,idealDenominator=buy?sqrt*sqrt:Q128;
  const actualNumerator=grossOutput*idealDenominator;
  const deviation=idealNumerator>actualNumerator?idealNumerator-actualNumerator:actualNumerator-idealNumerator;
  const impact=ceil(deviation*BPS,idealNumerator);
  return {inputUnits:input.toString(),expectedOutputUnits:output.toString(),
    minimumOutputUnits:ceil(output*BigInt(10000-slippageBps),BPS).toString(),grossOutputUnits:grossOutput.toString(),
    inputFeeUnits:inputFee.toString(),outputFeeUnits:outputFee.toString(),feeBps,priceImpactBps:impact.toString(),
    nextSqrtPriceX64:next.toString()};
}

export function quoteValuation({pool,ogUsdMicros,supplyUnits,inputUnits,expectedOutputUnits,direction}){
  const usd=units(ogUsdMicros,'OG price',U128_MAX),supply=units(supplyUnits,'ATT supply'),
    input=units(inputUnits,'input'),output=units(expectedOutputUnits,'output'),sqrt=units(pool.sqrtPriceX64,'sqrt',U128_MAX);
  requireQuote(Number.isInteger(pool.ogDecimals)&&pool.ogDecimals>=0&&pool.ogDecimals<=18,
    'invalid_decimals','Invalid original token decimals.');
  const ogScale=10n**BigInt(pool.ogDecimals);
  return {spotFdvUsdMicros:(supply*sqrt*sqrt*usd/(Q128*ogScale)).toString(),
    effectiveBuyFdvUsdMicros:direction==='buy-att'?ceil(supply*input*usd,ogScale*output).toString():null};
}
