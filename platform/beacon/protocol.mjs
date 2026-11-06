import {CHAIN,roundTime} from '../randomness/request-plan.mjs';
export const QUICKNET_PUBLIC_KEY='83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a';
export const QUICKNET_DST='BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
export function hexBytes(hex){if(typeof hex!=='string'||!/^([a-f0-9]{2})+$/.test(hex))throw new TypeError('Invalid hex bytes.');return Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));}
export function captureBeaconProof(value,expectedRound){
 if(!value||Object.keys(value).length!==4||!['chain','round','signature','randomness'].every(k=>Object.hasOwn(value,k))||!Number.isSafeInteger(expectedRound)||expectedRound<1||!Number.isSafeInteger(roundTime(expectedRound))||roundTime(expectedRound)>8640000000000000||value.round!==expectedRound||value.chain!==CHAIN||!/^([0-9a-f]{96})$/.test(value.signature)||!/^([0-9a-f]{64})$/.test(value.randomness))throw Error('Wrong pinned beacon or round.');
 return Object.freeze({chain:value.chain,round:value.round,signature:value.signature,randomness:value.randomness});
}
export function beaconRoundBytes(round){const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(round),false);return bytes;}
