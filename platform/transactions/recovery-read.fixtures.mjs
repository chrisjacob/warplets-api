import {createHash} from 'node:crypto';
import {canonical} from './canonical.mjs';
import {createIntent,prepareAttempt,expireAttempt,recordReceipt,localGenesis} from './intents.mjs';
import {encode58} from '../server/base58.mjs';
export const RECOVERY_READ_NOW=1700000000000;
export const recoveryReadOwner=encode58(Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'));
export const recoveryReadOther=encode58(Buffer.from('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c','hex'));
export const recoveryReadTables=['tx_intents','tx_request_keys','tx_attempts','tx_receipts'];
/** Unsigned wire fixture; later signed/submitted labels are synthetic retained
 * database observations. No transaction signing, simulation or dispatch occurs. */
export async function recoveryReadFixture(db,{state='validated',attemptCount=1,receiptCount=null}={}){
 const now=RECOVERY_READ_NOW,owner=recoveryReadOwner,program=Buffer.alloc(32,2),plan={network:'solana-local',action:'claim',subject:'synthetic-legacy-claim',expiresMs:now+3600000,maximumFeeUnits:'5000',minimumOutputUnits:'100',signers:[owner],instructions:[{program:encode58(program),accounts:[],data:'01'}]},intent=createIntent(db,{owner,requestKey:'synthetic-owner-request',plan},now),packets=[];
 for(let index=0;index<(state==='validated'?0:attemptCount);index++){
  const blockhash=Buffer.alloc(32,index+3),wire=Buffer.concat([Buffer.from([1,0,1,2]),Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'),program,blockhash,Buffer.from([1,1,0,1,1])]),messageHash=createHash('sha256').update(wire).digest('hex'),packet={version:1,network:'solana-local',attemptId:'synthetic-attempt-'+(index+1),planHash:intent.planHash,genesisHash:localGenesis,messageBase64:wire.toString('base64'),messageHash,lookupTables:[],lifetime:{kind:'recent-blockhash',blockhash:encode58(blockhash),lastValidBlockHeight:110+index,contextSlot:50+index,observedAt:now}};
  await prepareAttempt(db,{intentId:intent.id,packet,observation:{genesisHash:localGenesis,ok:true,messageHash,blockhash:packet.lifetime.blockhash,height:100,contextSlot:50+index,observedAt:now,lookupTables:[],feeUnits:'5000',outputUnits:'100',ref:'synthetic-unverified-simulation-'+index}},now);packets.push(packet);
  if(index<attemptCount-1||state==='attempt_expired')expireAttempt(db,{intentId:intent.id,currentBlockHeight:111+index});
 }
 const latest=packets.at(-1),signature=encode58(Buffer.alloc(64,7));
 if(['submitted','unknown','confirmed','failed','finalized'].includes(state)){
  db.prepare("UPDATE tx_attempts SET state='submitted',signature=? WHERE id=?").run(signature,latest.attemptId);db.prepare("UPDATE tx_intents SET state='submitted',revision=revision+1 WHERE id=?").run(intent.id);
  const recorded=receiptCount===null?(state==='submitted'?[]:[state]):Array.from({length:receiptCount},(_,i)=>i%2?'unknown':'confirmed');
  for(const [i,next] of recorded.entries())recordReceipt(db,{eventId:'synthetic-recorded-'+i,attemptId:latest.attemptId,signature,state:next,genesisHash:localGenesis,messageHash:latest.messageHash});
 }
 return {db,now,owner,other:recoveryReadOther,plan,intent,packets,signature,dump:()=>Object.fromEntries(recoveryReadTables.map(table=>[table,db.prepare('SELECT '+(table==='tx_request_keys'?'':'rowid,')+'* FROM '+table+' ORDER BY '+(table==='tx_request_keys'?'owner,action,request_key':'rowid')).all()])),canonical};
}
