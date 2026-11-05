import { encode58 } from '../server/base58.mjs';
import { QUOTE_PROGRAM, requireQuote } from './math.mjs';

export const TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const POOL_AUTHORITY='HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';
const discriminator=[241,154,109,4,17,177,109,188];
const view=raw=>new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
const u16=(raw,offset)=>view(raw).getUint16(offset,true),u32=(raw,offset)=>view(raw).getUint32(offset,true),u64=(raw,offset)=>view(raw).getBigUint64(offset,true);
const uint128=(raw,offset)=>u64(raw,offset)+(u64(raw,offset+8)<<64n);
const pubkey=(raw,offset)=>encode58(raw.subarray(offset,offset+32));
export function decodeAccountBytes(account,expectedLength){
  requireQuote(account && typeof account.data==='string' && account.data.length<8192,'account_missing','Account data is missing.',422);
  let binary;try{binary=atob(account.data);}catch{requireQuote(false,'account_layout','Unsupported or malformed account bytes.');}
  requireQuote(binary.length===expectedLength && btoa(binary)===account.data,'account_layout','Unsupported or malformed account bytes.');
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
/** Offsets and discriminator are pinned to cp-amm-sdk 1.5.1 Pool layout.
 * Byte-for-byte layout and results are checked against its own account coder.
 */
export function decodePoolAccount(account){
  requireQuote(account?.owner===QUOTE_PROGRAM,'program_owner','Pool account has the wrong program owner.');
  const raw=decodeAccountBytes(account,1112);
  requireQuote(discriminator.every((value,i)=>raw[i]===value),'account_discriminator','Invalid pool discriminator.');
  requireQuote(u64(raw,8)===900_000_000n && raw[16]===0 && u16(raw,22)===89
    && u64(raw,24)===1n && u64(raw,32)===10_000_000n,'fee_schedule','The fee schedule differs from the approved 90-to-1 policy.');
  requireQuote(raw[482]===0 && raw[483]===0,'token_extensions','This quote path requires legacy SPL token accounts.');
  const activation=u64(raw,472);
  requireQuote(activation*1000n<=BigInt(Number.MAX_SAFE_INTEGER),
    'activation_overflow','Activation time is not representable.');
  const protocolPercent=raw[48];
  requireQuote(protocolPercent<=100,'protocol_fee','Invalid protocol fee split.');
  return {
    attMint:pubkey(raw,168),ogMint:pubkey(raw,200),attVault:pubkey(raw,232),ogVault:pubkey(raw,264),
    liquidity:uint128(raw,360).toString(),sqrtMinPriceX64:uint128(raw,424).toString(),
    sqrtMaxPriceX64:uint128(raw,440).toString(),sqrtPriceX64:uint128(raw,456).toString(),
    activationMs:Number(activation)*1000,activationType:raw[480],poolStatus:raw[481],
    collectFeeMode:raw[484],feeVersion:raw[486],dynamicFeeInitialized:raw[56],
    compoundingFeeBps:u16(raw,54),protocolFeePercent:protocolPercent,
    permanentlyLockedLiquidity:uint128(raw,552).toString(),
  };
}
export function decodeMintAccount(account){
  requireQuote(account?.owner===TOKEN_PROGRAM,'token_program','Unsupported token program.');
  const raw=decodeAccountBytes(account,82);
  requireQuote(raw[45]===1 && raw[44]<=18,'mint_state','Invalid initialized mint state.');
  requireQuote(u32(raw,0)===0 && u32(raw,46)===0,'mint_authority','Mint or freeze authority remains enabled.');
  return {decimals:raw[44],supplyUnits:u64(raw,36).toString()};
}
export function decodeVaultAccount(account){
  requireQuote(account?.owner===TOKEN_PROGRAM,'token_program','Unsupported vault token program.');
  const raw=decodeAccountBytes(account,165);
  requireQuote(raw[108]===1 && u32(raw,72)===0 && u32(raw,109)===0
    && u32(raw,129)===0 && pubkey(raw,32)===POOL_AUTHORITY,
    'vault_state','Vault must be initialized, undelegated and controlled by the pool authority.');
  return {mint:pubkey(raw,0),amountUnits:u64(raw,64).toString()};
}
