import {createHash,createPublicKey,randomUUID,verify as verifySignature} from 'node:crypto';
import {decode58,encode58} from '../server/base58.mjs';
import {signerKey,signatureBytes} from '../security/ed25519.mjs';
import {canonical} from './canonical.mjs';
import {validatePacket,messageBytes,SOLANA_MAINNET_GENESIS} from './packets.mjs';
import {transaction} from '../storage/database.mjs';

const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const identifier=s=>{if(typeof s!=='string'||!/^[a-zA-Z0-9:_./-]{1,128}$/.test(s))throw Error('Invalid identifier.');return s;};
const amount=s=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,19})$/.test(s)||BigInt(s)>(1n<<64n)-1n)throw Error('Invalid base-unit amount.');};
const get=(db,id)=>db.prepare('SELECT * FROM tx_intents WHERE id=?').get(id);
const latest=(db,id)=>db.prepare('SELECT * FROM tx_attempts WHERE intent_id=? ORDER BY attempt_index DESC LIMIT 1').get(id);
const change=(db,row,state)=>{
 const result=db.prepare('UPDATE tx_intents SET state=?,revision=revision+1 WHERE id=? AND revision=?').run(state,row.id,row.revision);
 if(result.changes!==1)throw Error('Intent changed since approval.');
};
export const localGenesis=encode58(createHash('sha256').update('10x-offline-rehearsal-1').digest());

// Operator-only offline adapter. The approved plan is the trust boundary; never accept an HTTP client supplied plan.
export function createIntent(db,{owner,requestKey,plan},now=Date.now()){
 decode58(owner,32);identifier(requestKey);
 if(plan.network!=='solana-local'||!['launch','fund','claim','stake','unstake','harvest','swap'].includes(plan.action))throw Error('Unsupported lab action or network.');
 identifier(plan.subject);amount(plan.maximumFeeUnits);amount(plan.minimumOutputUnits);
 if(!Number.isSafeInteger(plan.expiresMs)||plan.expiresMs<1)throw Error('Invalid plan expiry.');
 if(!Array.isArray(plan.signers)||plan.signers[0]!==owner||plan.signers.length>4||new Set(plan.signers).size!==plan.signers.length)
  throw Error('Invalid approved signers.');
 plan.signers.forEach(signerKey);
 if(!Array.isArray(plan.instructions)||!plan.instructions.length||plan.instructions.length>16)throw Error('Expected bounded approved instructions.');
 for(const ix of plan.instructions){
  decode58(ix.program,32);
  if(!Array.isArray(ix.accounts)||ix.accounts.length>64||typeof ix.data!=='string'||!/^(?:[\da-f]{2}){0,1232}$/.test(ix.data))throw Error('Invalid instruction.');
  for(const a of ix.accounts){decode58(a.address,32);if(typeof a.signer!=='boolean'||typeof a.writable!=='boolean')throw Error('Invalid account flags.');}
 }
 const json=canonical(plan),hash=digest(plan);
 return transaction(db,()=>{
  const keyed=db.prepare('SELECT i.* FROM tx_request_keys k JOIN tx_intents i ON i.id=k.intent_id WHERE k.owner=? AND k.action=? AND k.request_key=?')
    .get(owner,plan.action,requestKey);
  const old=keyed??db.prepare('SELECT * FROM tx_intents WHERE owner=? AND action=? AND subject=?').get(owner,plan.action,plan.subject);
  if(old&&old.plan_hash!==hash)throw Error('Idempotency conflict with immutable plan.');
  if(!old&&plan.expiresMs<=now)throw Error('Plan already expired.');
  const id=old?.id??randomUUID();
  if(!old)db.prepare('INSERT INTO tx_intents VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner,plan.action,plan.subject,hash,json,'validated',0,now);
  if(!keyed)db.prepare('INSERT INTO tx_request_keys VALUES(?,?,?,?)').run(owner,plan.action,requestKey,id);
  return {id,planHash:hash,state:old?.state??'validated'};
 });
}
export async function prepareAttempt(db,input,now=Date.now()){
 // Freeze the recorded preparation inputs before packet hashing yields. The
 // verified bytes and observation must be exactly those persisted afterwards.
 const {intentId,packet,observation}=structuredClone(input);
 const row=get(db,intentId);if(!row)throw Error('Unknown intent.');
 const plan=JSON.parse(row.plan);
 if(!['validated','attempt_expired','awaiting_signature'].includes(row.state)||plan.expiresMs<=now)throw Error('Intent unavailable for a new packet.');
 if(packet.genesisHash!==localGenesis||packet.genesisHash===SOLANA_MAINNET_GENESIS||observation.genesisHash!==localGenesis)
  throw Error('Local network identity mismatch.');
 if(observation.ok!==true||observation.messageHash!==packet.messageHash||observation.blockhash!==packet.lifetime.blockhash||
   !Number.isSafeInteger(observation.height)||observation.height<0||observation.height>packet.lifetime.lastValidBlockHeight||
   observation.contextSlot!==packet.lifetime.contextSlot||observation.observedAt!==packet.lifetime.observedAt)throw Error('Simulation and blockhash evidence mismatch.');
 amount(observation.feeUnits);amount(observation.outputUnits);
 if(BigInt(observation.feeUnits)>BigInt(plan.maximumFeeUnits)||BigInt(observation.outputUnits)<BigInt(plan.minimumOutputUnits))throw Error('Simulation exceeds approved bounds.');
 // Fixture adapters must resolve tables independently; an arbitrary packet cannot assert its own lookup evidence.
 if(canonical(observation.lookupTables)!==canonical(packet.lookupTables))throw Error('Lookup evidence disagrees.');
 identifier(packet.attemptId);identifier(observation.ref);
 await validatePacket(plan,packet.attemptId,row.plan_hash,packet,now);
 return transaction(db,()=>{
  const previous=latest(db,intentId);
  if(previous?.state==='awaiting_signature'&&previous.id===packet.attemptId&&previous.packet===canonical(packet)&&previous.simulation_ref===observation.ref)
    return {id:previous.id,replayed:true};
  if(row.state==='awaiting_signature')throw Error('Existing packet must expire before replacement.');
  if(previous&&previous.blockhash===packet.lifetime.blockhash)throw Error('Replacement requires a fresh blockhash.');
  change(db,row,'awaiting_signature');
  db.prepare('INSERT INTO tx_attempts VALUES(?,?,?,?,?,?,?,?,NULL)').run(packet.attemptId,intentId,(previous?.attempt_index??0)+1,
    packet.messageHash,packet.lifetime.blockhash,canonical(packet),observation.ref,'awaiting_signature');
  return {id:packet.attemptId,replayed:false};
 });
}
export function expireAttempt(db,{intentId,currentBlockHeight}){
 if(!Number.isSafeInteger(currentBlockHeight)||currentBlockHeight<0)throw Error('Invalid height.');
 return transaction(db,()=>{
  const row=get(db,intentId),a=latest(db,intentId);
  if(row?.state!=='awaiting_signature'||currentBlockHeight<=JSON.parse(a.packet).lifetime.lastValidBlockHeight)throw Error('Attempt cannot expire.');
  change(db,row,'attempt_expired');db.prepare('UPDATE tx_attempts SET state=? WHERE id=?').run('expired',a.id);
 });
}
export function observeSignedAttempt(db,{attemptId,signatures,currentBlockHeight},now=Date.now()){
 return transaction(db,()=>{
  const a=db.prepare('SELECT * FROM tx_attempts WHERE id=?').get(attemptId);if(!a)throw Error('Unknown attempt.');
  const row=get(db,a.intent_id),plan=JSON.parse(row.plan),packet=JSON.parse(a.packet);
  if(!Array.isArray(signatures)||signatures.length!==plan.signers.length)throw Error('Missing signatures.');
  const message=messageBytes(packet.messageBase64);
  for(const [i,signer] of plan.signers.entries()){
   const der=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),signerKey(signer)]);
   if(!verifySignature(null,message,createPublicKey({key:der,type:'spki',format:'der'}),signatureBytes(signatures[i])))throw Error('Invalid packet signature.');
  }
  if(a.signature===signatures[0])return {signature:a.signature,replayed:true};
  if(row.state!=='awaiting_signature'||a.state!==row.state||plan.expiresMs<=now||!Number.isSafeInteger(currentBlockHeight)||
    currentBlockHeight<0||currentBlockHeight>packet.lifetime.lastValidBlockHeight)throw Error('Packet no longer usable.');
  change(db,row,'submitted');
  db.prepare('UPDATE tx_attempts SET signature=?,state=? WHERE id=?').run(signatures[0],'submitted',attemptId);
  return {signature:signatures[0],replayed:false};
 });
}
const transitions={submitted:['unknown','confirmed','failed','finalized'],unknown:['confirmed','failed','finalized'],confirmed:['unknown','finalized','failed']};
export function recordReceipt(db,event){
 const {eventId,attemptId,signature,state,genesisHash,messageHash}=event;identifier(eventId);
 const obs=canonical({attemptId,signature,state,genesisHash,messageHash});
 return transaction(db,()=>{
  const replay=db.prepare('SELECT observation FROM tx_receipts WHERE event_id=?').get(eventId);
  if(replay){if(replay.observation!==obs)throw Error('Receipt identity conflict.');return {state,replayed:true};}
  const a=db.prepare('SELECT * FROM tx_attempts WHERE id=?').get(attemptId);
  if(!a?.signature||a.signature!==signature||a.message_hash!==messageHash||genesisHash!==localGenesis)throw Error('Receipt evidence mismatch.');
  const row=get(db,a.intent_id);
  if(!transitions[row.state]?.includes(state)||a.state!==row.state)throw Error('Invalid reconciliation transition.');
  change(db,row,state);db.prepare('UPDATE tx_attempts SET state=? WHERE id=?').run(state,attemptId);
  db.prepare('INSERT INTO tx_receipts VALUES(?,?,?,?)').run(eventId,attemptId,obs,state);
  return {state,replayed:false};
 });
}
export function readIntent(db,id,owner){
 const row=db.prepare('SELECT id,action,subject,state,revision,plan_hash FROM tx_intents WHERE id=? AND owner=?').get(id,owner);
 if(!row)return null;
 const a=latest(db,id);
 return {id:row.id,action:row.action,subject:row.subject,state:row.state,revision:row.revision,planHash:row.plan_hash,
  attemptId:a?.id??null,source:'local-rehearsal',executable:false};
}
