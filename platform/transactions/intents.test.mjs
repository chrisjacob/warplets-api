import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {bytesHash} from './packets.mjs';
import {createIntent,prepareAttempt,observeSignedAttempt,recordReceipt,expireAttempt,readIntent,localGenesis} from './intents.mjs';
async function build(db){
 const now=1700000000000;
 const pair=generateKeyPairSync('ed25519'),ownerBytes=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32);
 const owner=encode58(ownerBytes),program=Buffer.alloc(32,2),blockhash=Buffer.alloc(32,3);
 const plan={network:'solana-local',action:'claim',subject:'fixture-asset-1',expiresMs:now+10000,maximumFeeUnits:'5000',
  minimumOutputUnits:'100',signers:[owner],instructions:[{program:encode58(program),accounts:[],data:'01'}]};
 const intent=createIntent(db,{owner,requestKey:'test',plan},now);
 const wire=Buffer.concat([Buffer.from([1,0,1,2]),ownerBytes,program,blockhash,Buffer.from([1,1,0,1,1])]);
 const packet={version:1,network:'solana-local',attemptId:'packet-1',planHash:intent.planHash,genesisHash:localGenesis,
  messageBase64:wire.toString('base64'),messageHash:await bytesHash(wire),lookupTables:[],
  lifetime:{kind:'recent-blockhash',blockhash:encode58(blockhash),lastValidBlockHeight:110,contextSlot:50,observedAt:now}};
 const observation={genesisHash:localGenesis,ok:true,messageHash:packet.messageHash,blockhash:packet.lifetime.blockhash,
  height:100,contextSlot:50,observedAt:now,lookupTables:[],feeUnits:'5000',outputUnits:'100',ref:'sim-1'};
 const signature=encode58(sign(null,wire,pair.privateKey));
 return {intent,packet,observation,plan,owner,now,signature};
}
test('exact packet replays, signature binds bytes, ambiguous outcomes cannot resubmit',async t=>{
 const db=openDatabase();t.after(()=>db.close());
 const f=await build(db),args={intentId:f.intent.id,packet:f.packet,observation:f.observation};
 assert.equal(createIntent(db,{owner:f.owner,requestKey:'other-key',plan:f.plan},f.now).id,f.intent.id);
 assert.throws(()=>createIntent(db,{owner:f.owner,requestKey:'test',plan:{...f.plan,minimumOutputUnits:'101'}},f.now),/conflict/);
 await prepareAttempt(db,args,f.now);assert.equal((await prepareAttempt(db,args,f.now)).replayed,true);
 const signed={attemptId:'packet-1',signatures:[f.signature],currentBlockHeight:105};
 assert.throws(()=>observeSignedAttempt(db,{...signed,signatures:[encode58(Buffer.alloc(64))]},f.now),/signature/);
 observeSignedAttempt(db,signed,f.now);assert.equal(observeSignedAttempt(db,signed,f.now).replayed,true);
 const receipt={attemptId:'packet-1',signature:f.signature,genesisHash:localGenesis,messageHash:f.packet.messageHash};
 recordReceipt(db,{...receipt,eventId:'network-unknown',state:'unknown'});
 await assert.rejects(prepareAttempt(db,args,f.now),/unavailable/);assert.throws(()=>expireAttempt(db,{intentId:f.intent.id,currentBlockHeight:120}));
 recordReceipt(db,{...receipt,eventId:'confirm',state:'confirmed'});recordReceipt(db,{...receipt,eventId:'final',state:'finalized'});
 assert.equal(readIntent(db,f.intent.id,f.owner).state,'finalized');assert.equal(readIntent(db,f.intent.id,'another-wallet'),null);
 assert.equal(recordReceipt(db,{...receipt,eventId:'final',state:'finalized'}).replayed,true);
 assert.throws(()=>recordReceipt(db,{...receipt,eventId:'final',state:'failed'}),/conflict/);
});
test('wrong chain, fee, lookup state, instruction substitution or expiry fails closed',async t=>{
 const db=openDatabase();t.after(()=>db.close());const f=await build(db),args={intentId:f.intent.id,packet:f.packet,observation:f.observation};
 for(const patch of [{genesisHash:encode58(Buffer.alloc(32,5))},{messageHash:'0'.repeat(64)},{lookupTables:[{}]}])
  await assert.rejects(prepareAttempt(db,{...args,packet:{...f.packet,...patch}},f.now));
 for(const patch of [{height:111},{outputUnits:'99'},{feeUnits:'5001'},{ok:false}])
  await assert.rejects(prepareAttempt(db,{...args,observation:{...f.observation,...patch}},f.now));
 const altered=Buffer.from(f.packet.messageBase64,'base64');altered[altered.length-1]=2;
 const messageHash=await bytesHash(altered);
 await assert.rejects(prepareAttempt(db,{...args,packet:{...f.packet,messageHash,messageBase64:altered.toString('base64')},
  observation:{...f.observation,messageHash}},f.now),/instruction differs/i);
 await prepareAttempt(db,args,f.now);
 assert.throws(()=>expireAttempt(db,{intentId:f.intent.id,currentBlockHeight:110}));
 expireAttempt(db,{intentId:f.intent.id,currentBlockHeight:111});
 assert.equal(readIntent(db,f.intent.id,f.owner).state,'attempt_expired');
 assert.throws(()=>observeSignedAttempt(db,{attemptId:'packet-1',signatures:[f.signature],currentBlockHeight:111},f.now));
});


test('caller mutation during packet hashing cannot change persisted preparation',async t=>{
 const db=openDatabase();t.after(()=>db.close());const f=await build(db);
 const original=structuredClone(f.packet),observation=structuredClone(f.observation);
 const pending=prepareAttempt(db,{intentId:f.intent.id,packet:f.packet,observation:f.observation},f.now);
 f.packet.attemptId='substituted-attempt';f.packet.messageHash='0'.repeat(64);
 f.packet.lifetime.lastValidBlockHeight=999999;f.packet.messageBase64='AAAA';
 f.observation.ref='substituted-observation';f.observation.feeUnits='999999';
 assert.deepEqual(await pending,{id:original.attemptId,replayed:false});
 const stored=db.prepare('SELECT * FROM tx_attempts WHERE intent_id=?').get(f.intent.id);
 assert.deepEqual(JSON.parse(stored.packet),original);assert.equal(stored.simulation_ref,observation.ref);
 assert.equal(stored.message_hash,original.messageHash);
});
