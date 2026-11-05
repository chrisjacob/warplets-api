// Exact deployed-program test, with disconnected fixture wallets on an offline
// Surfpool network. Claimants and amounts are bound into a single-leaf root.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ref = resolve(process.argv[2]), elf = readFileSync(process.argv[3]);
const pin = JSON.parse(readFileSync(new URL('./fixtures/rewards-program.json', import.meta.url)));
assert.equal(createHash('sha256').update(elf).digest('hex'), pin.allocatedElfSha256);
const qa = createRequire(resolve(ref,'packages/meme-qa/package.json'));
const lab = createRequire(resolve(ref,'packages/meme-protocol/package.json'));
const { keccak256 } = qa('viem'), { Surfnet } = qa('@solana/surfpool');
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram } = lab('@solana/web3.js');
const spl = lab('@solana/spl-token');
const keypair = seed => Keypair.fromSeed(new Uint8Array(32).fill(seed));
const [payer, authority, seed, alice, bob, mintKey, nftKey] = [61,62,63,64,65,66,67].map(keypair);
const program = new PublicKey(pin.program), mint = mintKey.publicKey, token = spl.TOKEN_PROGRAM_ID, system = SystemProgram.programId;
const pda = (label, ...keys) => PublicKey.findProgramAddressSync([Buffer.from(label), ...keys.map(k => k.toBuffer())],program);
const [dist,bump] = pda('merkle_distribution', mint, authority.publicKey, seed.publicKey);
// Use the program's events/shared.rs constant. Older IDL account prose
// describes the Anchor convention with underscores, which this ELF rejects.
const [event] = pda('event_authority');
const vault = spl.getAssociatedTokenAddressSync(mint, dist, true);
const ata = (key, asset=mint) => spl.getAssociatedTokenAddressSync(asset,key);
const aAta = ata(alice.publicKey), bAta = ata(bob.publicKey), sourceAta = ata(authority.publicKey);
const read = pubkey => ({pubkey,isWritable:false,isSigner:false});
const write = pubkey => ({...read(pubkey),isWritable:true});
const sign = (pubkey,isWritable=false) => ({pubkey,isWritable,isSigner:true});
const number = x => { const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(x));return b; };
const instruction = (tag, keys, ...data) => new TransactionInstruction({programId:program, keys, data:Buffer.concat([Buffer.from([tag]),...data])});
const keccak = b => Buffer.from(keccak256(b).slice(2),'hex');
const start = 1_800_000_000, day = 86_400;
const allocation = 100n;
// Linear start at T+24h gives zero at the cliff with no catch-up amount.
const schedule = Buffer.concat([Buffer.from([1]), number(start+day), number(start+2*day)]);
const leaf = keccak(Buffer.concat([Buffer.from([0]),keccak(Buffer.concat([alice.publicKey.toBuffer(),number(allocation),schedule]))]));
const claimFor = user => pda('merkle_claim',dist,user.publicKey);
const markerFor = user => pda('revocation',dist,user.publicKey)[0];
function claim(user, requested=0n) {
  const [claimId,claimBump] = claimFor(user);
  return instruction(6, [sign(payer.publicKey,true),sign(user.publicKey),write(dist),write(claimId),read(markerFor(user)),
    read(mint),write(vault),write(ata(user.publicKey)),read(system),read(token),read(event),read(program)],
    Buffer.from([claimBump]),number(allocation),number(requested),schedule,Buffer.alloc(4));
}
const net = Surfnet.startWithConfig({offline:true,blockProductionMode:'transaction'});
try {
  const endpoint = new URL(net.rpcUrl);
  assert(endpoint.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname));
  net.deploy({programId:pin.program,soBytes:elf});
  const rpc = new Connection(net.rpcUrl,{commitment:'confirmed',wsEndpoint:net.wsUrl});
  for(const user of [payer,authority,alice,bob]) net.fundSol(user.publicKey.toBase58(),10_000_000_000);
  const time = ts => net.timeTravelToTimestamp(ts*1000);
  time(start);
  async function send(ixs, extra=[]) {
    const block=await rpc.getLatestBlockhash('confirmed');
    const tx=new Transaction({feePayer:payer.publicKey,...block}).add(ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000}),...ixs);
    tx.sign(payer,...extra);
    const sig=await rpc.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:0});
    const deadline=performance.now()+10_000;
    while(performance.now()<deadline) {
      const {value}=await rpc.getSignatureStatus(sig,{searchTransactionHistory:true});
      if(value?.err)throw Error(JSON.stringify(value.err));
      if(value?.confirmationStatus==='finalized')return sig;
      await delay(25);
    }
    throw Error('Unknown local outcome; inspect ' + sig + ' before replay.');
  }
  const amount = async id => (await spl.getAccount(rpc,id)).amount;
  const createAta = (user,asset=mint) => spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey,ata(user.publicKey,asset),user.publicKey,asset);
  for(const key of [mintKey,nftKey]) {
    await send([SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:key.publicKey,
      lamports:await rpc.getMinimumBalanceForRentExemption(spl.MINT_SIZE),space:spl.MINT_SIZE,programId:token}),
      spl.createInitializeMint2Instruction(key.publicKey,0,payer.publicKey,null)], [key]);
  }
  await send([createAta(authority),createAta(alice),createAta(bob),createAta(alice,nftKey.publicKey),createAta(bob,nftKey.publicKey)]);
  await send([spl.createMintToInstruction(mint,sourceAta,payer.publicKey,allocation),
    spl.createMintToInstruction(nftKey.publicKey,ata(alice.publicKey,nftKey.publicKey),payer.publicKey,1n),
    spl.createSetAuthorityInstruction(nftKey.publicKey,payer.publicKey,spl.AuthorityType.MintTokens,null)]);
  await send([instruction(5,[sign(payer.publicKey,true),sign(authority.publicKey),sign(seed.publicKey),write(dist),read(mint),write(vault),
    write(sourceAta),read(system),read(token),read(spl.ASSOCIATED_TOKEN_PROGRAM_ID),read(event),read(program)],
    Buffer.from([bump,0]),number(allocation),leaf,number(allocation),number((1n<<63n)-1n))],[authority,seed]);
  assert.equal(await amount(vault),allocation);
  console.log('Funded nonrevocable distribution with maximum representable clawback timestamp.');
  for(const at of [start+day-1,start+day]) {
    time(at);
    await assert.rejects(send([claim(alice)],[alice]),/custom program error: 0x6\b|NothingToClaim/i);
    assert.equal(await amount(aAta),0n);
  }
  time(start+day+day/2);
  await send([claim(alice,20n)],[alice]);
  assert.equal(await amount(aAta),20n);
  await send([claim(alice)],[alice]);
  assert.equal(await amount(aAta),50n);
  await assert.rejects(send([claim(alice)],[alice]),/custom program error: 0x6\b|NothingToClaim/i);
  const revocation = instruction(10,[sign(authority.publicKey),sign(payer.publicKey,true),write(dist),write(claimFor(alice)[0]),
    write(markerFor(alice)),read(alice.publicKey),read(mint),write(vault),write(aAta),write(sourceAta),read(system),read(token),read(event),read(program)],
    Buffer.from([1]),number(allocation),schedule,Buffer.alloc(4));
  await assert.rejects(send([revocation],[authority]),/custom program error: 0x11\b|DistributionNotRevocable/i);
  // Real transfer of a one-of-one SPL asset. This program's claim schema
  // accepts no NFT ownership evidence. A Core transfer cannot change the
  // wallet bound into the leaf either.
  await send([spl.createTransferInstruction(ata(alice.publicKey,nftKey.publicKey),ata(bob.publicKey,nftKey.publicKey),alice.publicKey,1n)], [alice]);
  assert.equal(await amount(ata(bob.publicKey,nftKey.publicKey)),1n);
  time(start+800*day);
  const close=instruction(8,[sign(authority.publicKey,true),write(dist),read(mint),write(vault),write(sourceAta),read(token),read(event),read(program)]);
  await assert.rejects(send([close],[authority]),/custom program error: 0xd\b|ClawbackNotReached/i);
  await assert.rejects(send([claim(bob)],[bob]),/custom program error: 0xc\b|InvalidMerkleProof/i);
  await send([claim(alice)],[alice]);
  assert.equal(await amount(aAta),100n);
  assert.equal(await amount(vault),0n);
  assert.equal(await amount(bAta),0n);
  console.log(JSON.stringify({program:pin.program,captureSlot:pin.contextSlot,vestedAtCliff:'0',vestedAt36h:'50',
    claimAtDay800:'50',adminRevoke:'rejected',adminClose:'rejected',buyerClaim:'rejected',sellerClaim:'succeeded',
    earnWire:'verified on captured binary',directNftVault:'incompatible',sourceMatch:'unverified'}));
} finally { net.stop(); }
