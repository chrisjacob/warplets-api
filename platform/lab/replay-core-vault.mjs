// Exercise the actual Core Execute and Rewards programs together. No custom
// contract signs for a claimant, and no production wallet or connection exists.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ref = resolve(process.argv[2]), qa=createRequire(resolve(ref,'packages/meme-qa/package.json')), lab=createRequire(resolve(ref,'packages/meme-protocol/package.json'));
const { Surfnet }=qa('@solana/surfpool'), { keccak256 }=qa('viem');
const web3=lab('@solana/web3.js'),spl=lab('@solana/spl-token');
const { PublicKey,Keypair,TransactionInstruction,Transaction,SystemProgram,ComputeBudgetProgram,Connection,
  AddressLookupTableProgram,TransactionMessage,VersionedTransaction }=web3;
const pin = candidate => JSON.parse(readFileSync(new URL('./fixtures/'+candidate+'-program.json',import.meta.url)));
const corePin=pin('core'),rewardPin=pin('rewards');
const core=new PublicKey(corePin.program),rewards=new PublicKey(rewardPin.program),system=SystemProgram.programId,token=spl.TOKEN_PROGRAM_ID;
const key = seed => Keypair.fromSeed(new Uint8Array(32).fill(seed));
const [admin,alice,bob,assetKey,seed,mintKey]=[81,82,83,84,85,86].map(key);
const asset=assetKey.publicKey,mint=mintKey.publicKey;
const pda=(program,prefix,...keys)=>PublicKey.findProgramAddressSync([Buffer.from(prefix),...keys.map(k=>k.toBuffer())],program);
const [signer]=pda(core,'mpl-core-execute',asset),[event]=pda(rewards,'event_authority');
const [dist,bump]=pda(rewards,'merkle_distribution',mint,admin.publicKey,seed.publicKey);
const [claimId,claimBump]=pda(rewards,'merkle_claim',dist,signer),[marker]=pda(rewards,'revocation',dist,signer);
const vault=spl.getAssociatedTokenAddressSync(mint,dist,true),ata=(owner)=>spl.getAssociatedTokenAddressSync(mint,owner,true);
const r=pubkey=>({pubkey,isSigner:false,isWritable:false}),w=pubkey=>({...r(pubkey),isWritable:true}),s=(pubkey,writable=false)=>({...r(pubkey),isSigner:true,isWritable:writable});
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const str=text=>{const b=Buffer.from(text);return Buffer.concat([u32(b.length),b]);};
const ix=(programId,keys,...data)=>new TransactionInstruction({programId,keys,data:Buffer.concat(data)});
const start=1_800_000_000,day=86_400;
const schedule=Buffer.concat([Buffer.from([1]),u64(start+day),u64(start+2*day)]);
const keccak=bytes=>Buffer.from(keccak256(bytes).slice(2),'hex');
const leaf=keccak(Buffer.concat([Buffer.from([0]),keccak(Buffer.concat([signer.toBuffer(),u64(100),schedule]))]));
// A complete 16,384-leaf tree exercises the 14-sibling proof size of a
// Genesis-wide launch. Other leaves use zero-amount synthetic slot data.
const zeros=Array.from({length:16383},(_,i)=>keccak(Buffer.concat([Buffer.from([0]),keccak(Buffer.concat([u64(i),Buffer.from('unused simulation slot')]))])));
const proof=[];
let tree=[leaf,...zeros];
while(tree.length>1) {
  proof.push(tree[1]); const next=[];
  for(let i=0;i<tree.length;i+=2) next.push(keccak(Buffer.concat([tree[i],tree[i+1]].sort(Buffer.compare))));
  tree=next;
}
const root=tree[0];
function execute(owner, inner) {
  return ix(core, [w(asset),r(core),r(signer),s(owner,true),r(core),r(system),r(inner.programId),
    ...inner.keys.map(meta=>meta.pubkey.equals(signer)?{...meta,isSigner:false}:meta)],
    Buffer.from([31]),u32(inner.data.length),inner.data);
}
function coreTransfer(owner,newOwner) {
  return ix(core,[w(asset),r(core),s(owner,true),r(core),r(newOwner),r(system),r(core)],Buffer.from([14,0]));
}
function claim(owner, destination, requested) {
  return execute(owner,ix(rewards,[s(owner,true),s(signer),w(dist),w(claimId),r(marker),r(mint),w(vault),w(destination),
    r(system),r(token),r(event),r(rewards)],Buffer.from([6,claimBump]),u64(100),u64(requested),schedule,u32(proof.length),...proof));
}
function signedSweep(owner, holding, destination, units) {
  return [execute(owner,spl.createTransferInstruction(holding,destination,signer,units)),
    execute(owner,spl.createCloseAccountInstruction(holding,owner,signer))];
}
const net=Surfnet.startWithConfig({offline:true,blockProductionMode:'transaction'});
try {
  const endpoint=new URL(net.rpcUrl); assert(endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname));
  for(const [pin,path] of [[rewardPin,process.argv[3]],[corePin,process.argv[4]]]) {
    const bytes=readFileSync(path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.allocatedElfSha256);
    net.deploy({programId:pin.program,soBytes:bytes});
  }
  const rpc=new Connection(net.rpcUrl,{commitment:'confirmed',wsEndpoint:net.wsUrl});
  for(const account of [admin,alice,bob])net.fundSol(account.publicKey.toBase58(),10_000_000_000);
  let sequence=0;
  const wireSizes=[];
  async function send(ixs,payer=admin,extra=[],lookup) {
    const block=await rpc.getLatestBlockhash('confirmed');
    const all=[ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000 - (++sequence%128)}),...ixs];
    let raw;
    if(lookup) {
      const msg=new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:block.blockhash,instructions:all}).compileToV0Message([lookup]);
      const tx=new VersionedTransaction(msg);tx.sign([payer,...extra]);raw=tx.serialize();
      assert(raw.length<=1232,'v0 transaction exceeds packet cap: '+raw.length);
      wireSizes.push(raw.length);
    } else {
      const tx=new Transaction({feePayer:payer.publicKey,...block}).add(...all);tx.sign(payer,...extra);raw=tx.serialize();
    }
    const sig=await rpc.sendRawTransaction(raw,{skipPreflight:false,maxRetries:0});
    const deadline=performance.now()+10000;
    while(performance.now()<deadline) {
      const {value}=await rpc.getSignatureStatus(sig,{searchTransactionHistory:true});
      if(value?.err)throw Error(JSON.stringify(value.err));
      if(value?.confirmationStatus==='finalized')return sig;
      await delay(25);
    }
    throw Error('Unknown simulator transaction: '+sig);
  }
  const amount=async address=>(await spl.getAccount(rpc,address)).amount;
  net.timeTravelToTimestamp(start*1000);
  await send([SystemProgram.createAccount({fromPubkey:admin.publicKey,newAccountPubkey:mint,space:spl.MINT_SIZE,programId:token,
    lamports:await rpc.getMinimumBalanceForRentExemption(spl.MINT_SIZE)}),spl.createInitializeMint2Instruction(mint,0,admin.publicKey,null)],admin,[mintKey]);
  await send([...[admin,alice,bob].map(owner=>spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey,ata(owner.publicKey),owner.publicKey,mint)),
    spl.createMintToInstruction(mint,ata(admin.publicKey),admin.publicKey,100)]);
  await send([ix(rewards,[s(admin.publicKey,true),s(admin.publicKey),s(seed.publicKey),w(dist),r(mint),w(vault),w(ata(admin.publicKey)),
    r(system),r(token),r(spl.ASSOCIATED_TOKEN_PROGRAM_ID),r(event),r(rewards)],
    Buffer.from([5,bump,0]),u64(100),root,u64(100),u64((1n<<63n)-1n))],admin,[seed]);
  assert.equal(await amount(vault),100n);
  assert.equal(await rpc.getAccountInfo(asset),null);
  // Reusable per-campaign ALT; only common accounts go in it. No per-NFT
  // table allocation. Confirm the table and sign with official v0 encoding.
  const recentSlot=await rpc.getSlot('finalized');
  const [makeTable,tableId]=AddressLookupTableProgram.createLookupTable({authority:admin.publicKey,payer:admin.publicKey,recentSlot});
  const shared=[rewards,system,token,event,dist,vault,mint];
  await send([makeTable]);
  await send([AddressLookupTableProgram.extendLookupTable({payer:admin.publicKey,authority:admin.publicKey,lookupTable:tableId,addresses:shared})]);
  const table=(await rpc.getAddressLookupTable(tableId)).value;assert(table);
  async function prepareHolding(owner,seedByte) {
    const holding=key(seedByte);
    await send([SystemProgram.createAccount({fromPubkey:owner.publicKey,newAccountPubkey:holding.publicKey,
      space:spl.ACCOUNT_SIZE,lamports:await rpc.getMinimumBalanceForRentExemption(spl.ACCOUNT_SIZE),programId:token}),
      spl.createInitializeAccount3Instruction(holding.publicKey,mint,signer)],owner,[holding]);
    return holding.publicKey;
  }
  const aliceHolding=await prepareHolding(alice,89);
  // Asset public key is in the root but not yet minted. Nobody can invoke
  // its signer. No future draw/order policy is proved by this fixture.
  await assert.rejects(send([claim(alice.publicKey,aliceHolding,30)],alice,[],table));
  assert.equal(await amount(vault),100n);
  net.timeTravelToTimestamp((start+day+day/2)*1000);
  await send([ix(core,[s(asset,true),r(core),r(core),s(alice.publicKey,true),r(alice.publicKey),r(core),r(system),r(core)],
    Buffer.from([0,0]),str('10X reserve fixture'),str('urn:10x:fixture'),Buffer.from([0]))],alice,[assetKey]);
  const assetState=async()=>{const a=await rpc.getAccountInfo(asset);assert.equal(a.owner.toBase58(),core.toBase58());return a;};
  assert.equal(new PublicKey((await assetState()).data.subarray(1,33)).toBase58(),alice.publicKey.toBase58());
  const lamportsBefore=(await assetState()).lamports;
  await send([claim(alice.publicKey,aliceHolding,30),...signedSweep(alice.publicKey,aliceHolding,ata(alice.publicKey),30n)],alice,[],table);
  assert.equal(await amount(ata(alice.publicKey)),30n);assert.equal(await amount(vault),70n);
  assert.equal(await rpc.getAccountInfo(aliceHolding),null);
  const threeExecuteFees=(await assetState()).lamports-lamportsBefore;
  // A previous owner can authorize a lasting SPL delegate on a persistent
  // PDA-owned token account, independently of Core's later owner transfer.
  await send([spl.createAssociatedTokenAccountIdempotentInstruction(alice.publicKey,ata(signer),signer,mint),
    execute(alice.publicKey,spl.createApproveInstruction(ata(signer),alice.publicKey,signer,100n))],alice);
  await send([coreTransfer(alice.publicKey,bob.publicKey)],alice);
  assert.equal(new PublicKey((await assetState()).data.subarray(1,33)).toBase58(),bob.publicKey.toBase58());
  const bobHolding=await prepareHolding(bob,90);
  net.timeTravelToTimestamp((start+800*day)*1000);
  await assert.rejects(send([claim(alice.publicKey,bobHolding,70)],alice,[],table));
  assert.equal(await amount(vault),70n);
  await send([claim(bob.publicKey,bobHolding,70),...signedSweep(bob.publicKey,bobHolding,ata(bob.publicKey),70n)],bob,[],table);
  assert.equal(await amount(ata(bob.publicKey)),70n);assert.equal(await amount(vault),0n);
  assert.equal(await rpc.getAccountInfo(bobHolding),null);
  await send([spl.createMintToInstruction(mint,ata(signer),admin.publicKey,1)],admin);
  await send([spl.createTransferInstruction(ata(signer),ata(alice.publicKey),alice.publicKey,1)],alice);
  assert.equal(await amount(ata(signer)),0n);
  console.log(JSON.stringify({coreDeployment:corePin.deployedSlot,rewardsDeployment:rewardPin.deployedSlot,
    unrealizedReserve:100,originalOwnerClaim:30,buyerClaim:70,formerOwnerAttempt:'rejected',proofDepth:proof.length,
    v0PacketBytes:wireSizes,threeExecuteFeesLamports:threeExecuteFees,assetBurnAndPlugins:'separate gates'}));

  // Direct owner burn on a plain asset: even an app without a burn
  // surface cannot preserve signing authority for that destroyed asset.
  const burn=(assetPk,owner,extra=[])=>ix(core,[w(assetPk),r(core),s(owner,true),r(core),r(system),r(core),...extra],Buffer.from([12,0]));
  await send([spl.createAssociatedTokenAccountIdempotentInstruction(bob.publicKey,ata(signer),signer,mint),
    spl.createMintToInstruction(mint,ata(signer),admin.publicKey,1)],bob,[admin]);
  await send([burn(asset,bob.publicKey)],bob);
  await assert.rejects(send([execute(bob.publicKey,spl.createTransferInstruction(ata(signer),ata(bob.publicKey),signer,1))],bob));
  assert.equal(await amount(ata(signer)),1n);
  console.log(JSON.stringify({plainAssetBurn:'succeeded',assetSignerSpendAfterBurn:'rejected',strandedUnits:'1'}));

  // Optional experimental configuration: a single frozen lookup table
  // provides five immutable bytes at a public, verified offset. Core's
  // existing Oracle adapter reads those bytes. No signer can edit a frozen
  // ALT. Keep this separate from the plain asset proof and customer policy.
  const recordBytes=Buffer.alloc(32);
  recordBytes.set([1,2,2,1,2]); // OracleValidation::V1 {Pass,Pass,Rejected,Pass}
  const recordPk=new PublicKey(recordBytes);
  const [createOracle,oracle]=AddressLookupTableProgram.createLookupTable({authority:admin.publicKey,payer:admin.publicKey,
    recentSlot:await rpc.getSlot('finalized')});
  await send([createOracle]);
  await send([AddressLookupTableProgram.extendLookupTable({lookupTable:oracle,authority:admin.publicKey,payer:admin.publicKey,
    addresses:[recordPk]})]);
  await send([AddressLookupTableProgram.freezeLookupTable({lookupTable:oracle,authority:admin.publicKey})]);
  const oracleInfo=await rpc.getAccountInfo(oracle);
  assert.deepEqual(oracleInfo.data.subarray(56,88),recordBytes);
  assert.equal((await rpc.getAddressLookupTable(oracle)).value.state.authority,undefined);
  await assert.rejects(send([AddressLookupTableProgram.extendLookupTable({lookupTable:oracle,authority:admin.publicKey,
    payer:admin.publicKey,addresses:[mint]})]));
  const protectedAsset=key(92);
  // Oracle adapter enum=1, Some(Authority::None), one Burn hook with
  // CanReject flag 4, static address, Some(Custom byte offset 56).
  const oracleAdapter=Buffer.concat([Buffer.from([1]),oracle.toBuffer(),Buffer.from([1,0]),u32(1),
    Buffer.from([2]),u32(4),Buffer.from([0,1,2]),u64(56)]);
  await send([ix(core,[s(protectedAsset.publicKey,true),r(core),r(core),s(alice.publicKey,true),r(alice.publicKey),
    r(alice.publicKey),r(system),r(core)],Buffer.from([20,0]),str('Protected test asset'),str('urn:10x:protected'),
    Buffer.from([0,1]),u32(1),oracleAdapter)],alice,[protectedAsset]);
  // Test true veto with oracle PRESENT as well as fail-closed omission.
  await assert.rejects(send([burn(protectedAsset.publicKey,alice.publicKey,[r(oracle)])],alice));
  await assert.rejects(send([burn(protectedAsset.publicKey,alice.publicKey)],alice));
  const removeOracle=ix(core,[w(protectedAsset.publicKey),r(core),s(alice.publicKey,true),r(core),r(system),r(core)],
    Buffer.from([24,1]),oracle.toBuffer());
  // Setting adapter Authority::None doesn't remove the *asset* update
  // authority's program-level permission to remove the whole adapter.
  await send([removeOracle],alice);
  await send([burn(protectedAsset.publicKey,alice.publicKey)],alice);
  console.log(JSON.stringify({updateAuthorityCanRemoveOracle:true,postRemovalBurn:'succeeded',
    previousOwnerPersistentTokenDelegate:'can spend independently of Core owner',freshAtomicPayout:'protected'}));

  // Separate candidate; no operator can sign on behalf of a PDA derived
  // under the built-in System Program. This also constrains metadata updates
  // and must not be silently chosen as production product policy.
  const locked=key(93),[deadAuthority]=pda(system,'10x-unreachable-update-authority',locked.publicKey);
  assert.equal(PublicKey.isOnCurve(deadAuthority.toBytes()),false);
  await send([ix(core,[s(locked.publicKey,true),r(core),r(core),s(alice.publicKey,true),r(alice.publicKey),
    r(deadAuthority),r(system),r(core)],Buffer.from([20,0]),str('Locked oracle fixture'),str('urn:10x:locked'),
    Buffer.from([0,1]),u32(1),oracleAdapter)],alice,[locked]);
  const removeLocked=owner=>ix(core,[w(locked.publicKey),r(core),s(owner,true),r(core),r(system),r(core)],Buffer.from([24,1]),oracle.toBuffer());
  const manage=(owner,data)=>ix(core,[w(locked.publicKey),r(core),s(owner,true),r(core),r(system),r(core)],...data);
  await assert.rejects(send([removeLocked(alice.publicKey)],alice));
  await assert.rejects(send([removeLocked(admin.publicKey)],admin));
  // Replace the Oracle settings with no lifecycle checks; then attempt
  // to give the owner a force-approval PermanentBurnDelegate after issue.
  await assert.rejects(send([manage(alice.publicKey,[Buffer.from([26,1]),oracle.toBuffer(),Buffer.from([1,1]),u32(0),Buffer.from([0,0])])],alice));
  await assert.rejects(send([manage(alice.publicKey,[Buffer.from([2,8,1,3]),alice.publicKey.toBuffer()])],alice));
  await assert.rejects(send([burn(locked.publicKey,alice.publicKey,[r(oracle)])],alice));
  await assert.rejects(send([burn(locked.publicKey,alice.publicKey)],alice));
  await send([ix(core,[w(locked.publicKey),r(core),s(alice.publicKey,true),r(core),r(bob.publicKey),r(system),r(core)],Buffer.from([14,0]))],alice);
  assert.equal(new PublicKey((await rpc.getAccountInfo(locked.publicKey)).data.subarray(1,33)).toBase58(),bob.publicKey.toBase58());
  await assert.rejects(send([burn(locked.publicKey,bob.publicKey,[r(oracle)])],bob));
  console.log(JSON.stringify({optionalPolicy:'frozen burn-only Oracle with unreachable asset update authority',
    sharedOracleRentLamports:oracleInfo.lamports,ownerBurn:'rejected',missingOracle:'rejected',ownerRemoval:'rejected',
    formerIssuerRemoval:'rejected',normalTransfer:'succeeded',metadataMutability:'separate design gate',independentReview:'required'}));

  // An issuer-created force-approval delegate is a different asset class.
  // Never infer protection from an Oracle in isolation.
  const bypass=key(94);
  await send([ix(core,[s(bypass.publicKey,true),r(core),r(core),s(alice.publicKey,true),r(alice.publicKey),
    r(deadAuthority),r(system),r(core)],Buffer.from([20,0]),str('Unsafe delegate fixture'),str('urn:10x:bypass'),
    Buffer.from([1]),u32(1),Buffer.from([8,1,3]),alice.publicKey.toBuffer(),Buffer.from([1]),u32(1),oracleAdapter)],alice,[bypass]);
  await send([burn(bypass.publicKey,alice.publicKey,[r(oracle)])],alice);
  console.log(JSON.stringify({mintedPermanentBurnDelegate:'can force a burn despite the veto',assetAndCollectionPluginAllowlist:'required'}));
} finally {net.stop();}
