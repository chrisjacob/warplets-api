import {currentSession} from '../server/auth.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createActionRecoveryReadRepository} from './recovery-reads.mjs';
import {handleActionRecovery} from './recovery-http.mjs';
export function handleTransactions(db,request,now){
 return handleActionRecovery(request,{repository:createActionRecoveryReadRepository(createNodeAtomicDriver(db),{crypto:createNodeCrypto(),clock:{nowMs:()=>now}}),
  authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;}});
}
export const txPaths={'/transactions/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],
 get:{operationId:'getTransaction',responses:{200:{description:'Owner-scoped rehearsal state and current attempt'},401:{description:'Session required'},404:{description:'Unknown transaction'},503:{description:'Retained history is incomplete or changed'}}}}};
