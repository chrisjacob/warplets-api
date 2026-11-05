import { Buffer } from 'node:buffer';
import { encode58 } from '../server/base58.mjs';
import { QUOTE_PROGRAM, requireQuote } from './math.mjs';

export const TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const POOL_AUTHORITY='HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';
const discriminator=Buffer.from([241,154,109,4,17,177,109,188]);
const uint128=(raw,offset)=>raw.readBigUInt64LE(offset)+(raw.readBigUInt64LE(offset+8)<<64n);
const pubkey=(raw,offset)=>encode58(raw.subarray(offset,offset+32));
function bytes(account,expectedLength){
  requireQuote(account && typeof account.data==='string' && account.data.length<8192,'account_missing','Account data is missing.',422);
  const raw=Buffer.from(account.data,'base64');
  requireQuote(raw.length===expectedLength && raw.toString('base64')===account.data,'account_layout','Unsupported or malformed account bytes.');
  return raw;
}
/** Offsets and discriminator are pinned to cp-amm-sdk 1.5.1 Pool layout.
 * Byte-for-byte layout and results are checked against its own account coder.
 */
export function decodePoolAccount(account){
  requireQuote(account?.owner===QUOTE_PROGRAM,'program_owner','Pool account has the wrong program owner.');
  const raw=bytes(account,1112);
  requireQuote(raw.subarray(0,8).equals(discriminator),'account_discriminator','Invalid pool discriminator.');
  requireQuote(raw.readBigUInt64LE(8)===900_000_000n && raw[16]===0 && raw.readUInt16LE(22)===89
    && raw.readBigUInt64LE(24)===1n && raw.readBigUInt64LE(32)===10_000_000n,'fee_schedule','The fee schedule differs from the approved 90-to-1 policy.');
  requireQuote(raw[482]===0 && raw[483]===0,'token_extensions','This quote path requires legacy SPL token accounts.');
  const activation=raw.readBigUInt64LE(472);
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
    compoundingFeeBps:raw.readUInt16LE(54),protocolFeePercent:protocolPercent,
    permanentlyLockedLiquidity:uint128(raw,552).toString(),
  };
}
export function decodeMintAccount(account){
  requireQuote(account?.owner===TOKEN_PROGRAM,'token_program','Unsupported token program.');
  const raw=bytes(account,82);
  requireQuote(raw[45]===1 && raw[44]<=18,'mint_state','Invalid initialized mint state.');
  requireQuote(raw.readUInt32LE(0)===0 && raw.readUInt32LE(46)===0,'mint_authority','Mint or freeze authority remains enabled.');
  return {decimals:raw[44],supplyUnits:raw.readBigUInt64LE(36).toString()};
}
export function decodeVaultAccount(account){
  requireQuote(account?.owner===TOKEN_PROGRAM,'token_program','Unsupported vault token program.');
  const raw=bytes(account,165);
  requireQuote(raw[108]===1 && raw.readUInt32LE(72)===0 && raw.readUInt32LE(109)===0
    && raw.readUInt32LE(129)===0 && pubkey(raw,32)===POOL_AUTHORITY,
    'vault_state','Vault must be initialized, undelegated and controlled by the pool authority.');
  return {mint:pubkey(raw,0),amountUnits:raw.readBigUInt64LE(64).toString()};
}
