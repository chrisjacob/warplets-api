import {quoteFixture} from '../../quotes/fixtures.mjs';
import {importMarket} from '../../markets/catalog.mjs';
import {recordVaultManifest} from '../../vault/ledger.mjs';
import {decodePoolAccount,decodeMintAccount} from '../../quotes/accounts.mjs';
import {QUOTE_PROGRAM} from '../../quotes/math.mjs';
import {createRecordedReader} from '../../evidence/recorded.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
/** Raw accounts and oracle observations are synthetic pinned-SDK fixtures. */
export async function quoteProvenanceFixture({crypto,now=Date.UTC(2026,10,5,12),marketId='bound-quote',captures}){
 const old=quoteFixture(now,marketId),pool=decodePoolAccount(old.pool),mint=decodeMintAccount(old.attMint);
 const sourceId='quotes:'+marketId,subject={kind:'quote-market',id:marketId};
 const capture={version:1,mode:'synthetic-fixture',marketId,observedMs:now,contextSlot:String(old.slot),blockTimeMs:now,retrievedAtMs:now,
  finality:'finalized',investigationOpen:false,program:{address:QUOTE_PROGRAM,binaryDigest:null},
  accounts:Object.fromEntries(['pool','attMint','ogMint','attVault','ogVault'].map(key=>[key,{address:old[key].address,owner:old[key].owner,data:old[key].data,contextSlot:String(old.slot),blockTimeMs:now,retrievedAtMs:now}])),
  oracle:{feed:old.og.feed,mint:old.og.mint,decimals:old.og.decimals,priceMicros:old.og.priceMicros,confidenceMicros:'0',publicationMs:now,publicationSlot:String(old.slot),retrievedAtMs:now,investigationOpen:false}};
 const inputs=captures?captures(structuredClone(capture)):[{id:'good',capture}];
 const records=inputs.map(({id,capture:c})=>({id,subject,contextSlot:c.contextSlot,blockTimeMs:c.blockTimeMs,retrievedAtMs:c.retrievedAtMs,finality:c.finality,bytes:utf8(canonicalJson(c))}));
 const reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:null,records,crypto});
 const source={version:1,sourceId,sourceRevision:'fixture-v1',mode:'synthetic-fixture',chainGenesis:null,decoderVersion:'synthetic-quote-capture-v1',subject,
  policy:{version:1,marketId,poolProgram:QUOTE_PROGRAM,programBinaryDigest:null,approvedOgFeed:old.og.feed,attDecimals:mint.decimals,ogDecimals:old.og.decimals,
   accountMaxAgeMs:30000,oracleMaxAgeMs:30000,maxConfidenceBps:100,maxOracleSlotSkew:4},recordingDigest:reader.recordingDigest,maxBytes:32768,maxAgeMs:30000};
 return {now,marketId,capture,source,reader,readers:new Map([[canonicalJson([sourceId,source.sourceRevision]),reader]]),
  request:(recordId='good',supersedes=null)=>({sourceId,sourceRevision:source.sourceRevision,recordId,requestedCutoffMs:null,supersedes}),
  bind:{marketId,sourceId,sourceRevision:source.sourceRevision},
  seed(db){importMarket(db,{id:marketId,symbol:'QUOTEATT',ogSymbol:'QUOTEOG',attMint:old.attMint.address,ogMint:old.ogMint.address,poolAddress:old.pool.address,activatedAt:new Date(pool.activationMs).toISOString()});recordVaultManifest(db,{marketId,originalUnits:mint.supplyUnits});},
 };
}
