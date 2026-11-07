// Node-only unsigned fixtures. No key generation, signatures or transactions.
import {createHash} from 'node:crypto';
import {packetRecording} from '../storage/recorded-attempt-preparations.fixtures.mjs';
import {RECOVERY_READ_NOW,recoveryReadOwner} from '../transactions/recovery-read.fixtures.mjs';
import {encode58} from '../server/base58.mjs';
import {canonical} from '../transactions/canonical.mjs';
export const COMPATIBILITY_PACKET_SOURCES=Object.freeze([
 Object.freeze({path:'platform/storage/recorded-attempt-preparations.fixtures.mjs',commit:'d16a1540dbaf22eb3f82d2209eb863167e037357',digest:'44770dce50fe14df6fc3ce62a2edbd56a2a709dd5819b81f8bcf80ab09dc356d'}),
 Object.freeze({path:'platform/transactions/packets.mjs',commit:'d7b2d301500c48f2cb9f46d124c249f27b0e61a7',digest:'ceffbe84cead16c0a3b2b9896a3c5c323ccda32a3f9377eae21884258e7b9159'}),
 Object.freeze({path:'platform/transactions/recovery-read.fixtures.mjs',commit:'28d5ea91d1878e011630097fc0b0584fc6d29287',digest:'ec59b6a3ba3e30be06254853b54802adc515efe08eb5a0fd3afe60c2843a89b4'}),
]);
export function unsignedCompatibilityFixture({version='legacy'}={}){
 const nowMs=RECOVERY_READ_NOW,plan={network:'solana-local',action:'claim',subject:'synthetic-legacy-claim',expiresMs:nowMs+3600000,maximumFeeUnits:'5000',minimumOutputUnits:'100',signers:[recoveryReadOwner],instructions:[{program:encode58(Buffer.alloc(32,2)),accounts:[],data:'01'}]},intent={id:'synthetic-compatibility-intent',planHash:createHash('sha256').update(canonical(plan)).digest('hex'),plan};
 const packet=packetRecording({now:nowMs,intent});
 // A pure decoder-format variation of the same B15 unsigned vector, not a
 // retained physical-wallet result or new protocol execution experiment.
 if(version===0){const wire=Buffer.concat([Buffer.from([128]),Buffer.from(packet.messageBase64,'base64'),Buffer.from([0])]);packet.messageBase64=wire.toString('base64');packet.messageHash=createHash('sha256').update(wire).digest('hex');}
 else if(version!=='legacy')throw new TypeError('Unsupported synthetic version');
 return {intent,expectedIntentId:intent.id,attemptId:packet.attemptId,packet,nowMs,capabilities:{configurationId:'synthetic-recorded-wallet',transactionVersions:['legacy',0],maxSerializedBytes:1232,maxAccounts:256,displayedSigners:[recoveryReadOwner]}};
}
export function marketplaceCompatibilityFixture(nowMs=RECOVERY_READ_NOW){return {venue:'Unselected synthetic venue',version:'fixture-v1',assetStandard:'Core candidate; plugin policy unselected',assetId:'synthetic-asset',ownerObservation:{owner:recoveryReadOwner,observedMs:nowMs,evidenceDigest:'a'.repeat(64)},listing:{state:'unknown',priceUnits:null,currency:null,observedMs:null},royalty:{targetBps:null,recipient:null,enforcement:'unknown'},remainingVaultUnits:null,metadataVisibility:'unknown'};}
