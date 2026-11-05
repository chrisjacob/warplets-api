import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePoolAccount, TOKEN_PROGRAM, POOL_AUTHORITY } from './accounts.mjs';
import { QUOTE_PROGRAM, quoteAmounts } from './math.mjs';
import { decode58, encode58 } from '../server/base58.mjs';

const dir=resolve(process.argv[2]??'');
const local=createRequire(resolve(dir,'package.json'));
assert.equal(JSON.parse(readFileSync(resolve(dir,'node_modules/@meteora-ag/cp-amm-sdk/package.json'))).version,'1.5.1');
const sdk=local('@meteora-ag/cp-amm-sdk'),BN=local('bn.js'),{PublicKey}=local('@solana/web3.js');
const raw=Buffer.alloc(1112),key=n=>encode58(Buffer.alloc(32,n));
const poolKey=key(7),attMint=key(2),ogMint=key(3);
const attVault=sdk.deriveTokenVaultAddress(new PublicKey(attMint),new PublicKey(poolKey)).toBase58();
const ogVault=sdk.deriveTokenVaultAddress(new PublicKey(ogMint),new PublicKey(poolKey)).toBase58();
const u128=(offset,n)=>{raw.writeBigUInt64LE(BigInt(n)&((1n<<64n)-1n),offset);raw.writeBigUInt64LE(BigInt(n)>>64n,offset+8);};
Buffer.from([241,154,109,4,17,177,109,188]).copy(raw);
raw.writeBigUInt64LE(900_000_000n,8);raw[16]=0;raw.writeUInt16LE(89,22);
raw.writeBigUInt64LE(1n,24);raw.writeBigUInt64LE(10_000_000n,32);raw[48]=20;
for(const [offset,address] of [[168,attMint],[200,ogMint],[232,attVault],[264,ogVault]]) Buffer.from(decode58(address,32)).copy(raw,offset);
const min=sdk.getSqrtPriceFromPrice('0.000001',9,6);
const max=sdk.getSqrtPriceFromPrice('0.001',9,6);
const current=sdk.getSqrtPriceFromPrice('0.00004',9,6);
const supply='1000000000000000000',liquidity=new BN('900000000000000000000000000000000');
u128(152,min.toString());u128(360,liquidity.toString());
u128(424,min.toString());u128(440,max.toString());u128(456,current.toString());
u128(552,liquidity.toString());
const activation=1_800_000_000;
raw.writeBigUInt64LE(BigInt(activation),472);raw[480]=1;raw[481]=0;raw[484]=1;raw[486]=1;
const account={address:poolKey,owner:QUOTE_PROGRAM,data:raw.toString('base64')};
const pool=decodePoolAccount(account);
const decoded=sdk.cpAmmCoder.accounts.decode('Pool',raw);
const camel=value=>{
  if(Array.isArray(value))return value.map(camel);
  if(value && value.constructor===Object)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),camel(v)]));
  return value;
};
const state=camel(decoded);
assert.equal(state.sqrtPrice.toString(),pool.sqrtPriceX64);
assert.equal(state.liquidity.toString(),pool.liquidity);
const results=[];
for(const elapsedSeconds of [0,1,30,60,88,89,90,300]){
  for(const direction of ['buy-att','sell-att']){
    for(const inputUnits of ['1','1000','1000000','1000000000','1000000000000']){
      const trade=direction==='buy-att'?sdk.TradeDirection.BtoA:sdk.TradeDirection.AtoB;
      let result;
      try{result=sdk.getSwapResultFromExactInput(state,new BN(inputUnits),sdk.getFeeMode(sdk.CollectFeeMode.OnlyB,trade,false),
        trade,new BN(activation+elapsedSeconds));}
      catch(error){
        assert.equal(error.name,'PriceRangeViolationError');
        assert.throws(()=>quoteAmounts({direction,inputUnits,slippageBps:50,pool,nowMs:pool.activationMs+elapsedSeconds*1000}),
          e=>e.code==='price_range');
        results.push({elapsedSeconds,direction,inputUnits,error:'price_range'});continue;
      }
      const sdkFee=BigInt(result.claimingFee.toString())+BigInt(result.protocolFee.toString());
      const expected={outputUnits:result.outputAmount.toString(),nextSqrtPriceX64:result.nextSqrtPrice.toString(),
        feeUnits:sdkFee.toString()};
      const vector={elapsedSeconds,direction,inputUnits,...expected};
      if(BigInt(expected.outputUnits)>0n){
        const actual=quoteAmounts({direction,inputUnits,slippageBps:50,pool,nowMs:pool.activationMs+elapsedSeconds*1000});
        assert.equal(actual.expectedOutputUnits,expected.outputUnits);
        assert.equal(actual.nextSqrtPriceX64,expected.nextSqrtPriceX64);
        assert.equal(BigInt(actual.inputFeeUnits)+BigInt(actual.outputFeeUnits),sdkFee);
      }
      results.push(vector);
    }
  }
}
function mint(address,decimals,units){
  const bytes=Buffer.alloc(82);bytes.writeBigUInt64LE(BigInt(units),36);bytes[44]=decimals;bytes[45]=1;
  return {address,owner:TOKEN_PROGRAM,data:bytes.toString('base64')};
}
function vault(address,mint,units){
  const bytes=Buffer.alloc(165);Buffer.from(decode58(mint,32)).copy(bytes);Buffer.from(decode58(POOL_AUTHORITY,32)).copy(bytes,32);
  bytes.writeBigUInt64LE(BigInt(units),64);bytes[108]=1;
  return {address,owner:TOKEN_PROGRAM,data:bytes.toString('base64')};
}
const fixture={source:'cp-amm-sdk 1.5.1 / synthetic raw pool bytes / no RPC',activationMs:pool.activationMs,originalSupplyUnits:supply,
  pool:account,attMint:mint(attMint,9,supply),ogMint:mint(ogMint,6,'1000000000000000000'),
  attVault:vault(attVault,attMint,'800000000000000000'),ogVault:vault(ogVault,ogMint,'800000000000000000'),
  ogPriceMicros:'2000000',results};
const output=new URL('./fixtures/sdk-vectors.json',import.meta.url);
if(process.argv.includes('--check'))assert.deepEqual(JSON.parse(readFileSync(output)),fixture);
else{mkdirSync(new URL('./fixtures/',import.meta.url),{recursive:true});writeFileSync(output,JSON.stringify(fixture,null,2)+'\n');}
console.log(results.length+' pinned SDK quote cases matched exact integer math.');
