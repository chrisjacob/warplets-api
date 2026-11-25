import {randomUUID,createHash} from 'node:crypto';
import {PublicKey,Transaction,ComputeBudgetProgram,Message} from '@solana/web3.js';
import {actions} from './catalogue.mjs';
import {buildAction,verifyEffects} from './protocols.mjs';
import {liveChain,GENESIS} from './chain.mjs';
import {base58} from '../create-wallets.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const pending=a=>['prepared','submitted','unknown','verification-failed'].includes(a.status);
export function validateSigned(attempt,encoded) {
  if(typeof encoded!=='string'||encoded.length>1800||!/^[A-Za-z0-9+/]+=*$/.test(encoded))throw Error('Invalid signed packet');
  const tx=Transaction.from(Buffer.from(encoded,'base64'));
  if(digest(tx.serializeMessage())!==attempt.messageHash)throw Error('Wallet changed the prepared message');
  if(!tx.feePayer.equals(new PublicKey(attempt.payer))||!tx.verifySignatures())throw Error('Missing or invalid wallet signature');
  return {tx,signature:base58(tx.signature),bytes:tx.serialize()};
}

export class Engine {
  constructor(store,chain=liveChain,builder=buildAction,verify=verifyEffects) {this.store=store;this.chain=chain;this.builder=builder;this.verify=verify;this.busy=false;}
  async exclusive(work) {if(this.busy)throw Error('Another transaction operation is running');this.busy=true;try{return await work();}finally{this.busy=false;}}
  async observe() {return this.exclusive(async()=>{
    const observation=await this.chain.observePrograms('preflight');
    if(observation.genesis!==GENESIS)throw Error('Wrong chain genesis');
    const price=await this.chain.quoteSolUsd(),chainTime=await this.chain.chainClock();
    const result={...observation,price,chainTime,evidenceClass:'read-only-mainnet',transactions:0};
    this.store.value.observation=result;this.store.save();return result;
  });}
  async prepare(input) {return this.exclusive(async()=>{
    const state=this.store.value,action=actions.find(a=>a.id===input.action);
    if(!action)throw Error('Unknown action');
    const payer=new PublicKey(input.payer).toBase58();
    if(!PublicKey.isOnCurve(new PublicKey(payer)))throw Error('Payer must be a signing wallet');
    if(state.wallet&&state.wallet!==payer)throw Error('Reconnect the wallet bound to this run');
    if(state.attempts.some(pending))throw Error('Recover or expire the pending attempt before preparing another');
    if(state.hold)throw Error('Run on hold: '+state.hold);
    if(!action.repeatable&&state.artifacts[action.id])throw Error('This action already finalized');
    for(const required of action.requires)if(!state.artifacts[required])throw Error('Complete '+required+' first');
    if(action.recipient) {
      const to=new PublicKey(input.recipient);
      if(!PublicKey.isOnCurve(to)||to.toBase58()===payer)throw Error('Recipient must be a different wallet you control');
    }
    const observation=await this.chain.observePrograms(action.id),price=await this.chain.quoteSolUsd();
    if(observation.genesis!==GENESIS)throw Error('Wrong chain genesis');
    if(!(price.usdPerSol>0)||!Number.isFinite(price.usdPerSol))throw Error('Invalid quote');
    const label='qa-'+state.id.slice(0,8)+'-'+action.id;
    const plan=await this.builder({action:action.id,payer,recipient:input.recipient,artifacts:state.artifacts,label,connection:this.chain.connection,chainTime:await this.chain.chainClock()});
    const block=await this.chain.connection.getLatestBlockhash('confirmed');
    const tx=new Transaction({feePayer:new PublicKey(payer),...block}).add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...plan.ixs);
    if(plan.signers.length)tx.partialSign(...plan.signers);
    const bytes=tx.serialize({requireAllSignatures:false,verifySignatures:true});
    if(bytes.length>1232)throw Error('Packet exceeds Solana size limit; adapter must split the action safely');
    const before=await this.chain.balance(payer);
    if(!before.value)throw Error('Fund the connected browser wallet first');
    const simulation=await this.chain.simulate(bytes.toString('base64'),payer,before.context.slot);
    if(simulation.value.err)throw Error('Simulation rejected: '+JSON.stringify(simulation.value.err)+' '+(simulation.value.logs??[]).slice(-5).join('\n'));
    const after=simulation.value.accounts?.[0]?.lamports;
    const fee=(await this.chain.connection.getFeeForMessage(tx.compileMessage(),'confirmed')).value;
    if(!Number.isSafeInteger(after)||!Number.isSafeInteger(fee)||fee<0)throw Error('Cannot measure simulation cost');
    // Conservatively add the fee even if simulation already deducted it. Rent
    // and protocol fees come from the simulated payer balance, not a flat guess.
    const estimatedLamports=Math.max(0,before.value.lamports-after)+fee;
    const reservedLamports=Math.ceil(estimatedLamports*1.15)+10000;
    const reservedUsd=reservedLamports/1e9*price.usdPerSol;
    if(state.spentUsd+reservedUsd>state.budgetUsd)throw Error('This action exceeds the remaining $10 run budget');
    if(before.value.lamports<reservedLamports)throw Error('Wallet balance is below the cost reserve');
    const attempt={id:randomUUID(),action:action.id,poc:action.poc,status:'prepared',payer,label,createdAt:new Date().toISOString(),block,
      messageHash:digest(tx.serializeMessage()),packet:bytes.toString('base64'),detail:plan.detail,expect:plan.expect,result:plan.result,
      observation,price,estimatedLamports,reservedLamports,reservedUsd,simulation:{slot:simulation.context.slot,units:simulation.value.unitsConsumed,logs:simulation.value.logs},
      instructions:tx.instructions.map(i=>({program:i.programId.toBase58(),accounts:i.keys.map(k=>({address:k.pubkey.toBase58(),signer:k.isSigner,writable:k.isWritable})),dataHex:i.data.toString('hex')}))};
    state.wallet=payer;state.attempts.push(attempt);this.store.save();return attempt;
  });}
  async submit(id,encoded) {return this.exclusive(async()=>{
    const a=this.store.value.attempts.find(a=>a.id===id);if(!a)throw Error('Unknown attempt');
    const signed=validateSigned(a,encoded);
    if(a.signature) {if(a.signature!==signed.signature)throw Error('Attempt signature conflict');return this.reconcile(a);}
    if(a.status!=='prepared')throw Error('Attempt is not signable');
    if(Date.now()-Date.parse(a.price.observedAt)>180000)throw Error('Prepared quote is stale. Recover after blockhash expiry, then prepare again.');
    if(await this.chain.connection.getGenesisHash()!==GENESIS)throw Error('Wrong chain genesis');
    if(await this.chain.connection.getBlockHeight('confirmed')>a.block.lastValidBlockHeight)throw Error('Blockhash expired. Recover before preparing again.');
    const programs=await this.chain.observePrograms(a.action),price=await this.chain.quoteSolUsd();
    if(programs.genesis!==GENESIS||!(price.usdPerSol>0)||!Number.isFinite(price.usdPerSol))throw Error('Submission observation invalid');
    const before=await this.chain.balance(a.payer);
    const simulation=await this.chain.simulate(signed.bytes.toString('base64'),a.payer,before.context.slot);
    const after=simulation.value.accounts?.[0]?.lamports;
    const fee=(await this.chain.connection.getFeeForMessage(signed.tx.compileMessage(),'confirmed')).value;
    if(simulation.value.err||!before.value||!Number.isSafeInteger(after)||!Number.isSafeInteger(fee))throw Error('Signed packet no longer simulates successfully');
    const cost=Math.max(0,before.value.lamports-after)+fee,usd=cost/1e9*price.usdPerSol;
    if(cost>a.reservedLamports||usd>a.reservedUsd||this.store.value.spentUsd+usd>this.store.value.budgetUsd)throw Error('Fresh submission cost exceeds the reviewed reserve');
    a.submissionObservation={programs,price,slot:simulation.context.slot,estimatedLamports:cost};
    // Persist identity BEFORE broadcast. On timeout/restart only reconciliation
    // is allowed; there is no background retry or replacement transaction.
    a.signature=signed.signature;a.status='submitted';a.submittedAt=new Date().toISOString();this.store.save();
    try {
      const returned=await this.chain.connection.sendRawTransaction(signed.bytes,{skipPreflight:false,maxRetries:0});
      if(returned!==a.signature)throw Error('RPC returned a different signature');
    } catch(error) {a.status='unknown';a.error=error.message;this.store.save();return a;}
    return this.reconcile(a);
  });}
  async recover(id) {return this.exclusive(async()=>{
    const a=this.store.value.attempts.find(a=>a.id===id);if(!a)throw Error('Unknown attempt');return this.reconcile(a);
  });}
  async reconcile(a) {
    if(!pending(a))return a;
    if(!a.signature) {
      if(await this.chain.connection.getBlockHeight('finalized')>a.block.lastValidBlockHeight){a.status='expired';this.store.save();}
      return a;
    }
    const status=(await this.chain.connection.getSignatureStatuses([a.signature],{searchTransactionHistory:true})).value[0];
    if(status?.confirmationStatus!=='finalized') {
      // Signed ambiguous attempts stay reserved even after blockhash expiry:
      // absence from one public RPC does not prove non-execution.
      a.status='unknown';a.lastObservedStatus=status;a.lastCheckedAt=new Date().toISOString();this.store.save();return a;
    }
    const receipt=await this.chain.receipt(a.signature);
    if(!receipt?.meta||!receipt.transaction?.message)throw Error('Finalized receipt temporarily unavailable');
    if(receipt.transaction.signatures[0]!==a.signature)throw Error('Receipt signature mismatch');
    if(digest(new Message(receipt.transaction.message).serialize())!==a.messageHash)throw Error('Receipt message mismatch');
    const keys=receipt.transaction.message.accountKeys.map(k=>typeof k==='string'?k:k.pubkey);
    if(keys[0]!==a.payer)throw Error('Receipt payer mismatch');
    const debit=Math.max(0,receipt.meta.preBalances[0]-receipt.meta.postBalances[0]);
    if(!Number.isSafeInteger(debit)||debit<receipt.meta.fee)throw Error('Invalid receipt costs');
    const state=this.store.value;
    if(!a.accounted) {state.spentLamports+=debit;state.spentUsd+=debit/1e9*(a.submissionObservation?.price??a.price).usdPerSol;a.accounted=true;}
    a.receipt=receipt;a.actualLamports=debit;a.finalizedAt=new Date().toISOString();
    if(debit>a.reservedLamports||state.spentUsd>state.budgetUsd)state.hold='Realized cost exceeded the approved reserve; inspect receipts';
    if(receipt.meta.err) {a.status='failed';a.error=JSON.stringify(receipt.meta.err);this.store.save();return a;}
    try {
      a.verification=await this.verify(this.chain.connection,a.expect,receipt);a.status='finalized';delete a.error;
      state.artifacts[a.action]={...a.result,signature:a.signature,verifiedAt:a.finalizedAt};
    } catch(error) {a.status='verification-failed';a.error=error.message;}
    this.store.save();return a;
  }
}
