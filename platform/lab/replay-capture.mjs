// Linux x64 only. The simulator, SDK and SPL client resolve from the frozen
// October lab checkout. Every transaction below targets Surfnet's offline VM.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { inspectStoredCapture } from './capture.mjs';

const ref = resolve(process.argv[2]);
const qa = createRequire(resolve(ref, 'packages/meme-qa/package.json'));
const lab = createRequire(resolve(ref, 'packages/meme-protocol/package.json'));
const { Surfnet } = qa('@solana/surfpool');
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, SYSVAR_CLOCK_PUBKEY } = lab('@solana/web3.js');
const spl = lab('@solana/spl-token');
const { cpAmmCoder } = lab('@meteora-ag/cp-amm-sdk');
const v = JSON.parse(readFileSync(new URL('./fixtures/damm-v2-prd-vector.json', import.meta.url)));
const [pin] = inspectStoredCapture();
const archive = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/programs-mainnet.json.gz', import.meta.url)), { maxOutputLength: 16 * 1024 * 1024 }));
const program = archive.accounts.find(a => a.address === pin.address);
const data = archive.accounts.find(a => a.address === program.programData);
const elf = Buffer.from(data.data, 'base64').subarray(45);
const pk = value => new PublicKey(value);
const keypair = seed => Keypair.fromSeed(new Uint8Array(32).fill(seed));
const ix = rows => rows.map(row => new TransactionInstruction({ programId: pk(row.program),
  keys: row.accounts.map(a => ({ pubkey: pk(a.key), isSigner: a.signer, isWritable: a.writable })), data: Buffer.from(row.data, 'hex') }));

const net = Surfnet.startWithConfig({ offline: true, blockProductionMode: 'transaction' });
try {
  const endpoint = new URL(net.rpcUrl);
  assert.equal(endpoint.protocol, 'http:');
  assert(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname));
  net.deploy({ programId: v.program, soBytes: elf });
  const rpc = new Connection(net.rpcUrl, { commitment: 'confirmed', wsEndpoint: net.wsUrl });
  const payer = keypair(4);
  assert.equal(payer.publicKey.toBase58(), v.payer);
  net.fundSol(v.payer, 20_000_000_000);
  assert((await rpc.getBalance(payer.publicKey)) >= 10_000_000_000, 'simulator payer funding failed');
  net.timeTravelToTimestamp((v.activation - 60) * 1000);
  const sendFixture = async (instructions, extra = []) => {
    const block = await rpc.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: payer.publicKey, ...block }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...instructions);
    tx.sign(payer, ...extra);
    const sig = await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const { value } = await rpc.getSignatureStatus(sig, { searchTransactionHistory: true });
      if (value?.err) throw Error(JSON.stringify(value.err));
      if (value?.confirmationStatus === 'finalized') return sig;
      await delay(25);
    }
    throw Error('Local transaction outcome unknown.');
  };
  const makeMint = async seed => {
    const account = keypair(seed);
    await sendFixture([
      lab('@solana/web3.js').SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: account.publicKey,
        lamports: await rpc.getMinimumBalanceForRentExemption(spl.MINT_SIZE), space: spl.MINT_SIZE, programId: spl.TOKEN_PROGRAM_ID }),
      spl.createInitializeMint2Instruction(account.publicKey, 9, payer.publicKey, null),
    ], [account]);
    return account.publicKey;
  };
  const mint = await makeMint(2), og = await makeMint(3);
  const ata = async (token, wallet = payer.publicKey) => {
    const address = spl.getAssociatedTokenAddressSync(token, wallet);
    await sendFixture([spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, address, wallet, token)]);
    return address;
  };
  const attAta = await ata(mint), ogAta = await ata(og);
  const balance = async address => (await spl.getAccount(rpc, pk(address))).amount;
  const pool = async () => {
    const account = await rpc.getAccountInfo(pk(v.pool));
    assert.equal(account.owner.toBase58(), v.program);
    return cpAmmCoder.accounts.decode('Pool', account.data);
  };
  const send = (rows, extra = []) => sendFixture(ix(rows), extra);
  const mintFixture = (token, to, amount) => sendFixture([spl.createMintToInstruction(token, to, payer.publicKey, amount)]);
  await mintFixture(mint, attAta, BigInt(v.allocation.liquidity));
  const reserves = [];
  for (const [i, name] of ['earn', 'stake', 'genesisVault', 'seasonVault'].entries()) {
    const destination = await ata(mint, keypair(20 + i).publicKey);
    const amount = BigInt(v.allocation[name]);
    await mintFixture(mint, destination, amount);
    reserves.push({ destination, amount });
  }
  const nft = keypair(5);
  console.log('Fixture mint accounts and five allocation buckets created.');
  await assert.rejects(send(v.initAndLock, [nft]), /insufficient funds/i);
  assert.equal(await rpc.getAccountInfo(pk(v.pool)), null);
  await mintFixture(og, ogAta, 1n);
  await send(v.initAndLock, [nft]);
  console.log('Executed one-raw-unit OG pool initialization and permanent lock.');
  assert.equal(await balance(v.tokenAVault), BigInt(v.allocation.liquidity));
  assert.equal(await balance(attAta), 0n);
  assert.equal(await balance(v.tokenBVault), 1n);
  const position = await rpc.getAccountInfo(pk(v.position));
  assert.equal(position.owner.toBase58(), v.program);
  const pos = cpAmmCoder.accounts.decode('Position', position.data);
  assert.equal(pos.permanent_locked_liquidity.toString(), v.delta);
  assert.equal(pos.unlocked_liquidity.toString(), '0');
  const state = await pool();
  assert.equal(state.token_a_mint.toBase58(), v.mint);
  assert.equal(state.token_b_mint.toBase58(), v.og);
  assert.equal(state.collect_fee_mode, 1);
  const fee = Buffer.from(state.pool_fees.base_fee.base_fee_info.data);
  assert.equal(fee.readBigUInt64LE(0), 900000000n);
  assert.equal(fee.readUInt16LE(14), 89);
  assert.equal(fee.readBigUInt64LE(16), 1n);
  assert.equal(fee.readBigUInt64LE(24), 10000000n);
  await mintFixture(og, ogAta, 1000000000n);
  await assert.rejects(send(v.buy));
  const samples = [];
  for (const elapsed of [0, 1, 30, 60, 88, 89, 90]) {
    net.timeTravelToTimestamp((v.activation + elapsed) * 1000);
    const clock = Number((await rpc.getAccountInfo(SYSVAR_CLOCK_PUBKEY)).data.readBigInt64LE(32));
    assert.equal(clock, v.activation + elapsed);
    const [attBefore, ogBefore, before] = await Promise.all([balance(attAta), balance(ogAta), pool()]);
    await send(v.buy);
    const [attAfter, ogAfter, after] = await Promise.all([balance(attAta), balance(ogAta), pool()]);
    assert(attAfter > attBefore);
    assert.equal(ogBefore - ogAfter, 1_000_000n);
    const treasury = BigInt(after.protocol_b_fee.toString()) - BigInt(before.protocol_b_fee.toString());
    const pct = BigInt(after.pool_fees.protocol_fee_percent);
    assert(pct > 0n);
    assert.equal(treasury, 1_000_000n * BigInt(Math.max(1, 90 - elapsed)) * pct / 10_000n);
    assert.equal(after.protocol_a_fee.toString(), before.protocol_a_fee.toString());
    samples.push({ second: elapsed, ogProtocolFee: String(treasury) });
  }
  const ogBefore = await balance(ogAta), attBefore = await balance(attAta);
  await send(v.sell);
  assert(await balance(ogAta) > ogBefore);
  assert.equal(attBefore - await balance(attAta), 1_000_000n);
  for (const { destination, amount } of reserves) assert.equal(await balance(destination), amount);
  assert.equal((await spl.getMint(rpc, mint)).supply, BigInt(v.supply));
  console.log(JSON.stringify({ captureSlot: pin.contextSlot, lpFunds: v.allocation.liquidity, minimumOg: 1,
    permanentLock: v.delta, samples, sellExecuted: true, liveParity: 'unverified', kamino: 'not captured' }));
} finally {
  net.stop();
}
