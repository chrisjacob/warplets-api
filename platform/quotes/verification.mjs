import {decodePoolAccount,decodeMintAccount,decodeVaultAccount,decodeAccountBytes} from './accounts.mjs';
import {QUOTE_PROGRAM,requireQuote,units,quoteAmounts,quoteValuation,validateQuotePool} from './math.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
export const MAX_QUOTE_AGE_MS=30_000;
const safeTime=n=>Number.isSafeInteger(n)&&n>=0;
export function inspectLegacyQuoteCapture(market,fixture,originalSupply,approvedFeed,now){
  const {pool,attMint,ogMint,attVault,ogVault,og}=fixture;
  requireQuote(fixture.network==='solana-local' && fixture.finalized===true && fixture.investigationOpen===false,
    'unverified_capture','A finalized local account capture and investigation status are required.');
  requireQuote(safeTime(fixture.observedMs)&&fixture.observedMs<=now && Number.isSafeInteger(fixture.slot)&&fixture.slot>0,
    'invalid_checkpoint','Invalid observation clock or slot.');
  requireQuote(pool?.address===market.poolAddress && attMint?.address===market.attMint && ogMint?.address===market.ogMint,
    'identity_mismatch','Account identities differ from the registered market.');
  for(const account of [pool,attMint,ogMint,attVault,ogVault,og]){
    requireQuote(account?.slot===fixture.slot && account.observedMs===fixture.observedMs && account.finalized===true
      && typeof account.sourceRef==='string' && account.sourceRef.length>0 && account.sourceRef.length<=256,
      'mixed_checkpoint','All observations must match the finalized slot and timestamp.');
  }
  const decoded=decodePoolAccount(pool),att=decodeMintAccount(attMint),original=decodeMintAccount(ogMint);
  validateQuotePool(decoded);
  const aVault=decodeVaultAccount(attVault),bVault=decodeVaultAccount(ogVault);
  requireQuote(decoded.attMint===market.attMint && decoded.ogMint===market.ogMint && decoded.attVault===attVault.address
    && decoded.ogVault===ogVault.address && aVault.mint===market.attMint && bVault.mint===market.ogMint,
    'vault_mismatch','Vault or mint wiring differs from the pool bytes.');
  requireQuote(decoded.activationMs===Date.parse(market.activatedAt),'activation_mismatch','Pool and registered activation differ.');
  requireQuote(units(att.supplyUnits,'current supply')<=units(originalSupply,'original supply') && units(originalSupply,'original supply')>0n,
    'supply_mismatch','Current ATT supply exceeds the immutable original supply.');
  requireQuote(og.mint===market.ogMint && og.decimals===original.decimals && typeof og.feed==='string'
    && og.feed===approvedFeed && og.investigationOpen===false,
    'oracle_mismatch','OG observation differs from the approved local feed.');
  const price=units(og.priceMicros,'OG price',(1n<<128n)-1n),confidence=units(og.confidenceMicros,'confidence',(1n<<128n)-1n);
  requireQuote(price>0n&&confidence*10_000n<=price*100n,'oracle_confidence','OG price confidence exceeds the 1% quote-pilot limit.');
  return {pool:{...decoded,attDecimals:att.decimals,ogDecimals:original.decimals},
    attVaultUnits:aVault.amountUnits,ogVaultUnits:bVault.amountUnits,ogUsdMicros:price.toString(),originalSupplyUnits:originalSupply,
    expiresMs:fixture.observedMs+MAX_QUOTE_AGE_MS};
}

/** Shared arithmetic and legacy response projection, deliberately without I/O
 * or hashing. The strict service adds its actual receipt-bound provenance. */
export function evaluateQuoteData({data,request,nowMs,source}){
 const {marketId,direction,inputUnits,slippageBps}=request,pool=data.pool,now=nowMs;
 requireQuote(now<data.expiresMs,'stale_quote_source','The pool and OG price capture has expired.',503);
 const result=quoteAmounts({direction,inputUnits,slippageBps,pool,nowMs:now});
 const buy=direction==='buy-att',available=units(buy?data.attVaultUnits:data.ogVaultUnits,'vault balance');
 requireQuote(BigInt(result.grossOutputUnits)<=available,'insufficient_vault','The output vault cannot cover this quote.');
 const decayEnd=pool.activationMs+89_000;
 const feeBoundary=now<decayEnd?pool.activationMs+(Math.floor((now-pool.activationMs)/1000)+1)*1000:Number.MAX_SAFE_INTEGER;
 const expiresMs=Math.min(data.expiresMs,now+15_000,feeBoundary);
 requireQuote(expiresMs>now,'quote_expired','The quote expired. Refresh its evidence.',503);
 return {version:1,marketId,direction,inputMint:buy?pool.ogMint:pool.attMint,outputMint:buy?pool.attMint:pool.ogMint,
  inputDecimals:buy?pool.ogDecimals:pool.attDecimals,outputDecimals:buy?pool.attDecimals:pool.ogDecimals,
  ...result,slippageBps,quotedAt:new Date(now).toISOString(),expiresAt:new Date(expiresMs).toISOString(),
  contextSlot:source.contextSlot,observedAt:new Date(source.observedMs).toISOString(),sourceHash:source.sourceHash,
  ...quoteValuation({pool,ogUsdMicros:data.ogUsdMicros,supplyUnits:data.originalSupplyUnits,inputUnits,expectedOutputUnits:result.expectedOutputUnits,direction}),
  fees:{asset:pool.ogMint,side:buy?'input':'output',networkLamports:null,accountRentLamports:null},source:'local-fixture',route:'meteora-damm-v2',executable:false};
}

const copy=value=>JSON.parse(canonicalJson(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value;
const clock=value=>safeTime(value)&&value<=8640000000000000;
const check=(condition,code,message)=>requireQuote(condition,code,message,422);
const exact=(value,keys)=>check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'invalid_capture','Unexpected quote capture fields.');
const accountNames=['pool','attMint','ogMint','attVault','ogVault'];
const lengths={pool:1112,attMint:82,ogMint:82,attVault:165,ogVault:165};
const slot=value=>typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER);
function address(value){try{check(typeof value==='string','identity_mismatch','Invalid address.');decode58(value,32);}catch{check(false,'identity_mismatch','Invalid canonical account address.');}}

/** Synchronous structural verification, suitable for B04's composite decoder.
 * No receipt is created here. Only the repository may supply a real binding. */
export function inspectQuoteCapture(value){
 const input=copy(value);exact(input,['market','supply','source','capture','ingestedAtMs']);
 const {market:m,supply:s,source,capture:c,ingestedAtMs}=input,p=source?.policy;
 exact(m,['id','attMint','ogMint','poolAddress','activationMs']);check(text(m.id)&&clock(m.activationMs),'identity_mismatch','Invalid registered market.');
 for(const key of ['attMint','ogMint','poolAddress'])address(m[key]);check(m.attMint!==m.ogMint,'identity_mismatch','ATT and OG must differ.');
 exact(s,['originalUnits','manifestDigest']);const supply=units(s.originalUnits,'original supply');
 check(supply>0n&&supply%200n===0n&&digest(s.manifestDigest),'supply_mismatch','Original supply must match the immutable exact-allocation policy.');
 exact(source,['version','sourceId','sourceRevision','mode','chainGenesis','decoderVersion','subject','policy','recordingDigest','maxBytes','maxAgeMs']);
 check(source.version===1&&source.mode==='synthetic-fixture'&&source.chainGenesis===null&&source.decoderVersion==='synthetic-quote-capture-v1'&&text(source.sourceId)&&text(source.sourceRevision)&&digest(source.recordingDigest),'unverified_capture','A registered synthetic quote decoder source is required.');
 exact(source.subject,['kind','id']);
 check(source.subject?.kind==='quote-market'&&source.subject.id===m.id,'identity_mismatch','Source must name this quote market.');
 check(Number.isSafeInteger(source.maxBytes)&&source.maxBytes>0&&source.maxBytes<=262144&&Number.isSafeInteger(source.maxAgeMs)&&source.maxAgeMs>0&&source.maxAgeMs<=86400000,'invalid_source','Invalid source bounds.');
 exact(p,['version','marketId','poolProgram','programBinaryDigest','approvedOgFeed','attDecimals','ogDecimals','accountMaxAgeMs','oracleMaxAgeMs','maxConfidenceBps','maxOracleSlotSkew']);
 check(p.version===1&&p.marketId===m.id&&p.poolProgram===QUOTE_PROGRAM&&p.programBinaryDigest===null&&text(p.approvedOgFeed),'invalid_source','Unsupported quote source policy.');
 check(['attDecimals','ogDecimals'].every(k=>Number.isInteger(p[k])&&p[k]>=0&&p[k]<=18),'invalid_decimals','Invalid registered decimals.');
 check(['accountMaxAgeMs','oracleMaxAgeMs'].every(k=>Number.isSafeInteger(p[k])&&p[k]>0&&p[k]<=MAX_QUOTE_AGE_MS)&&Number.isInteger(p.maxConfidenceBps)&&p.maxConfidenceBps>=0&&p.maxConfidenceBps<=100&&Number.isSafeInteger(p.maxOracleSlotSkew)&&p.maxOracleSlotSkew>=0,'invalid_source','Quote source bounds exceed the validated pilot scope.');
 exact(c,['version','mode','marketId','observedMs','contextSlot','blockTimeMs','retrievedAtMs','finality','investigationOpen','program','accounts','oracle']);
 exact(c.program,['address','binaryDigest']);
 check(c.version===1&&c.mode==='synthetic-fixture'&&c.marketId===m.id&&c.finality==='finalized'&&c.investigationOpen===false&&c.program.address===p.poolProgram&&c.program.binaryDigest===p.programBinaryDigest,'unverified_capture','Capture provenance or investigation status is unsupported.');
 check(slot(c.contextSlot)&&clock(c.blockTimeMs)&&clock(c.observedMs)&&clock(c.retrievedAtMs)&&clock(ingestedAtMs)&&c.blockTimeMs<=c.observedMs&&c.observedMs<=c.retrievedAtMs&&c.retrievedAtMs<=ingestedAtMs,'invalid_checkpoint','Account observation clocks are inconsistent.');
 check(utf8(canonicalJson(c)).length<=Math.min(source.maxBytes,32768),'capture_size','Capture exceeds the registered or32KiB quote byte bound.');
 exact(c.accounts,accountNames);
 const decoded={};for(const key of accountNames){const a=c.accounts[key];exact(a,['address','owner','data','contextSlot','blockTimeMs','retrievedAtMs']);address(a.address);address(a.owner);
  check(a.contextSlot===c.contextSlot&&a.blockTimeMs===c.blockTimeMs&&clock(a.retrievedAtMs)&&a.retrievedAtMs>=c.observedMs&&a.retrievedAtMs<=c.retrievedAtMs,'mixed_checkpoint','Raw accounts do not share the recorded finalized context.');
  decoded[key]=(key==='pool'?decodePoolAccount:key.endsWith('Mint')?decodeMintAccount:decodeVaultAccount)(a);
 }
 const {pool,attMint:att,ogMint:og,attVault:av,ogVault:ov}=decoded;
 validateQuotePool(pool);
 check(c.accounts.pool.address===m.poolAddress&&c.accounts.attMint.address===m.attMint&&c.accounts.ogMint.address===m.ogMint&&pool.attMint===m.attMint&&pool.ogMint===m.ogMint,'identity_mismatch','Raw accounts differ from the registered market.');
 check(pool.attVault===c.accounts.attVault.address&&pool.ogVault===c.accounts.ogVault.address&&av.mint===m.attMint&&ov.mint===m.ogMint,'vault_mismatch','Vault wiring differs from decoded pool state.');
 check(pool.activationMs===m.activationMs,'activation_mismatch','Activation differs from the registered market.');
 check(att.decimals===p.attDecimals&&og.decimals===p.ogDecimals,'invalid_decimals','Mint decimals differ from source policy.');
 check(units(att.supplyUnits,'current supply')<=supply,'supply_mismatch','Current supply exceeds original supply.');
 const o=c.oracle;exact(o,['feed','mint','decimals','priceMicros','confidenceMicros','publicationMs','publicationSlot','retrievedAtMs','investigationOpen']);
 check(o.feed===p.approvedOgFeed&&o.mint===m.ogMint&&o.decimals===og.decimals&&o.investigationOpen===false,'oracle_mismatch','Oracle identity or investigation differs from source policy.');
 check(clock(o.publicationMs)&&clock(o.retrievedAtMs)&&o.publicationMs<=o.retrievedAtMs&&o.retrievedAtMs<=c.retrievedAtMs&&o.publicationMs<=c.observedMs&&slot(o.publicationSlot),'oracle_checkpoint','Oracle publication/retrieval clocks are inconsistent.');
 check(BigInt(o.publicationSlot)<=BigInt(c.contextSlot)&&BigInt(c.contextSlot)-BigInt(o.publicationSlot)<=BigInt(p.maxOracleSlotSkew),'oracle_slot_skew','Oracle publication is outside the registered account slot bound.');
 const price=units(o.priceMicros,'OG price',(1n<<128n)-1n),confidence=units(o.confidenceMicros,'OG confidence',(1n<<128n)-1n);
 check(price>0n&&confidence*10000n<=price*BigInt(p.maxConfidenceBps),'oracle_confidence','Oracle confidence exceeds source policy.');
 const expiresMs=Math.min(c.blockTimeMs+p.accountMaxAgeMs,c.blockTimeMs+source.maxAgeMs,o.publicationMs+p.oracleMaxAgeMs);
 check(clock(expiresMs)&&ingestedAtMs<expiresMs,'stale_quote_source','Original account or oracle publication has expired.');
 return freeze({input,data:{pool:{...pool,attDecimals:att.decimals,ogDecimals:og.decimals},attVaultUnits:av.amountUnits,ogVaultUnits:ov.amountUnits,ogUsdMicros:String(price),originalSupplyUnits:s.originalUnits,expiresMs}});
}

export async function verifyQuoteCapture(value,crypto){
 // Capture binding and payload together before any asynchronous digest.
 const captured=copy(value);exact(captured,['market','supply','source','capture','binding']);
 const {binding,...context}=captured;
 exact(binding,['receiptDigest','selectedHeadDigest','sourceId','sourceRevision','sourceConfigDigest','streamKey','envelopeByteDigest','objectRef','contextSlot','blockTimeMs','retrievedAtMs','ingestedAtMs']);
 const {input,data}=inspectQuoteCapture({...context,ingestedAtMs:binding.ingestedAtMs}),{market,supply,source,capture}=input;
 check(['receiptDigest','selectedHeadDigest','sourceConfigDigest','envelopeByteDigest'].every(k=>digest(binding[k]))&&binding.receiptDigest===binding.selectedHeadDigest,'evidence_pending','Selected quote receipt is not the current evidence head.');
 check(binding.sourceId===source.sourceId&&binding.sourceRevision===source.sourceRevision&&binding.streamKey===canonicalJson([source.sourceId,'quote-market',market.id,null])&&binding.objectRef==='private/'+binding.envelopeByteDigest+'.json','evidence_binding','Quote receipt differs from its source or private object.');
 check(binding.contextSlot===capture.contextSlot&&binding.blockTimeMs===capture.blockTimeMs&&binding.retrievedAtMs===capture.retrievedAtMs,'evidence_binding','Capture differs from recorded B04 clocks.');
 check(await crypto.sha256(utf8(canonicalJson(source)))===binding.sourceConfigDigest,'evidence_binding','Registered source digest differs from receipt binding.');
 check(await crypto.sha256(utf8(canonicalJson(capture)))===binding.envelopeByteDigest,'evidence_binding','Capture bytes differ from the B04 private object.');
 const accountByteDigests={};for(const key of accountNames)accountByteDigests[key]=await crypto.sha256(decodeAccountBytes(capture.accounts[key],lengths[key]));
 const policyDigest=await crypto.sha256(utf8(canonicalJson(source.policy)));
 const verified={version:1,marketId:market.id,data,binding,accountByteDigests,policyDigest,manifestDigest:supply.manifestDigest,observedMs:capture.observedMs,
  oraclePublicationMs:capture.oracle.publicationMs,oraclePublicationSlot:capture.oracle.publicationSlot,oracleRetrievedAtMs:capture.oracle.retrievedAtMs,verifiedAtMs:binding.ingestedAtMs,mode:'synthetic-fixture'};
 const sourceDigest=await crypto.sha256(utf8(canonicalJson(['10x.quote-input.v1',market,supply,verified])));
 return freeze({...verified,sourceDigest});
}

export async function evaluateVerifiedQuote({input,request,evaluatedAtMs},crypto){
 input=copy(input);request=copy(request);exact(request,['marketId','direction','inputUnits','slippageBps']);
 check(input.version===1&&input.mode==='synthetic-fixture'&&request.marketId===input.marketId&&input.binding.receiptDigest===input.binding.selectedHeadDigest,'evidence_binding','Quote request differs from the verified input.');
 check(clock(evaluatedAtMs)&&evaluatedAtMs>=input.verifiedAtMs,'invalid_time','Evaluation precedes recorded ingestion.');
 const quoted=evaluateQuoteData({data:input.data,request,nowMs:evaluatedAtMs,source:{contextSlot:Number(input.binding.contextSlot),observedMs:input.observedMs,sourceHash:input.sourceDigest}});
 quoted.evidence={mode:'synthetic-fixture',scope:'synthetic-transcript',receiptDigest:input.binding.receiptDigest,sourceId:input.binding.sourceId,sourceRevision:input.binding.sourceRevision,
  sourceConfigDigest:input.binding.sourceConfigDigest,policyDigest:input.policyDigest,manifestDigest:input.manifestDigest,captureByteDigest:input.binding.envelopeByteDigest,accountByteDigests:input.accountByteDigests,
  blockTimeMs:input.binding.blockTimeMs,retrievedAtMs:input.binding.retrievedAtMs,ingestedAtMs:input.binding.ingestedAtMs,oraclePublicationMs:input.oraclePublicationMs,
  oraclePublicationSlot:input.oraclePublicationSlot,oracleRetrievedAtMs:input.oracleRetrievedAtMs,evaluatedAtMs,programBinaryDigest:null,capturedProgramParity:'missing'};
 return freeze({id:await crypto.sha256(utf8(canonicalJson(quoted))),...quoted});
}
