import {createHash} from 'node:crypto';
import {bls12_381} from '@noble/curves/bls12-381.js';
import {CHAIN,roundTime,materializeDraw} from '../randomness/selection.mjs';
import {transaction} from '../storage/database.mjs';
import {canonical} from '../transactions/canonical.mjs';
import {fulfillMint,fulfillProgression} from '../collect/store.mjs';

const publicKey='83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a';
export function verifyBeacon(proof,expectedRound){
 if(!Number.isSafeInteger(expectedRound)||expectedRound<1||proof?.round!==expectedRound||proof.chain!==CHAIN||
   !/^[0-9a-f]{96}$/.test(proof.signature)||!/^[0-9a-f]{64}$/.test(proof.randomness))throw Error('Wrong pinned beacon or round.');
 const signature=Buffer.from(proof.signature,'hex');
 const entropy=createHash('sha256').update(signature).digest('hex');
 if(entropy!==proof.randomness)throw Error('Beacon entropy does not match its signature.');
 const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(expectedRound));
 const message=createHash('sha256').update(bytes).digest();
 const suite=bls12_381.shortSignatures;
 const point=suite.hash(message,'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_');
 if(!suite.verify(signature,point,Buffer.from(publicKey,'hex')))throw Error('Beacon signature verification failed.');
 return entropy;
}
export function settleBeaconDraw(db,operationId,proof,now=Date.now()){
 const request=db.prepare('SELECT * FROM fair_requests WHERE operation_id=?').get(operationId);
 if(!request||roundTime(request.target_round)>now)throw Error('Committed round unavailable.');
 const entropy=verifyBeacon(proof,request.target_round);
 return transaction(db,()=>{
  const existing=db.prepare('SELECT * FROM fair_results WHERE operation_id=?').get(operationId);
  if(existing){
   if(existing.signed_round!==canonical(proof))throw Error('Conflicting proof on retry.');
   return {operationId,proofId:existing.proof_id,replayed:true};
  }
  const op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(operationId);
  const fixture=materializeDraw(db,op,request,entropy,roundTime(request.target_round));
  db.prepare('INSERT INTO fair_results VALUES(?,?,?,?,?)').run(operationId,fixture.proofId,canonical(proof),canonical(fixture),now);
  const fulfill=op.kind==='mint'?fulfillMint:fulfillProgression;
  const result=fulfill(db,fixture,now);
  return {operationId,proofId:fixture.proofId,replayed:false,result};
 });
}
