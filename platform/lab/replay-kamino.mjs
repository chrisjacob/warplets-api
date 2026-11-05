// In-memory funds and deterministic lab keys only. Uses the real captured
// Farms ELF checked against a finalized public programdata observation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FARM_PROGRAM, readFarmConfig, readGlobalConfig } from './kamino.mjs';
import { launchAllocations } from '../domain/economics/index.mjs';

const ref = resolve(process.argv[2]);
const elf = readFileSync(process.argv[3]);
const evidence = JSON.parse(readFileSync(new URL('./fixtures/kamino-public.json', import.meta.url)));
assert.equal(createHash('sha256').update(elf).digest('hex'), evidence.deployment.allocatedElfSha256);
const qa = createRequire(resolve(ref, 'packages/meme-qa/package.json'));
const lab = createRequire(resolve(ref, 'packages/meme-protocol/package.json'));
const { Surfnet } = qa('@solana/surfpool');
const { Connection, Keypair, PublicKey, TransactionInstruction, Transaction, ComputeBudgetProgram,
  SystemProgram, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY } = lab('@solana/web3.js');
const spl = lab('@solana/spl-token');
const system = SystemProgram.programId, token = spl.TOKEN_PROGRAM_ID;
const program = new PublicKey(FARM_PROGRAM);
const makeKey = seed => Keypair.fromSeed(new Uint8Array(32).fill(seed));
const [admin,user,mintKey,globalKey,farmKey] = [41,42,43,44,45].map(makeKey);
const mint = mintKey.publicKey, global = globalKey.publicKey, farm = farmKey.publicKey;
const pda = (label, ...keys) => PublicKey.findProgramAddressSync([Buffer.from(label), ...keys.map(k => k.toBuffer())], program)[0];
const fAuth = pda('authority', farm), gAuth = pda('authority', global);
const fVault = pda('fvault', farm, mint), rVault = pda('rvault', farm, mint), tVault = pda('tvault', global, mint);
const userState = pda('user', farm, user.publicKey);
const adminAta = spl.getAssociatedTokenAddressSync(mint, admin.publicKey);
const userAta = spl.getAssociatedTokenAddressSync(mint, user.publicKey);
const unsigned = (width, value) => {
  const n = BigInt(value);
  if (n < 0n || n >= (1n << BigInt(width * 8))) throw Error('unsigned instruction value out of range');
  return Buffer.from(n.toString(16).padStart(width * 2, '0'), 'hex').reverse();
};
const u64 = n => unsigned(8, n);
const r = pubkey => ({ pubkey, isSigner: false, isWritable: false });
const w = pubkey => ({ ...r(pubkey), isWritable: true });
const s = pubkey => ({ ...w(pubkey), isSigner: true });
const ix = (name, keys, ...args) => new TransactionInstruction({ programId: program, keys,
  data: Buffer.concat([createHash('sha256').update('global:' + name).digest().subarray(0,8), ...args]) });
const cfg = (authority, mode, payload) => ix('update_farm_config', [s(authority), w(farm), r(program)],
  unsigned(2, mode), unsigned(4, payload.length), payload);
const stake = n => ix('stake', [s(user.publicKey), w(userState), w(farm), w(fVault), w(userAta), r(mint), r(program), r(token)], u64(n));
const withdrawPrincipal = () => [
  ix('unstake', [s(user.publicKey), w(userState), w(farm), r(program)], unsigned(16, (1n << 128n) - 1n)),
  ix('withdraw_unstaked_deposits', [s(user.publicKey), w(userState), w(farm), w(userAta), w(fVault), r(fAuth), r(token)]),
];
const harvest = () => ix('harvest_reward', [s(user.publicKey), w(userState), w(farm), r(global), r(mint),
  w(userAta), w(rVault), w(tVault), r(fAuth), r(program), r(token)], u64(0));
const recover = authority => ix('withdraw_reward', [s(authority), w(farm), r(mint), w(rVault), r(fAuth),
  w(adminAta), r(program), r(token)], u64((1n << 64n) - 1n), u64(0));

const net = Surfnet.startWithConfig({ offline: true, blockProductionMode: 'transaction' });
try {
  const endpoint = new URL(net.rpcUrl);
  assert(endpoint.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname));
  net.deploy({ programId: FARM_PROGRAM, soBytes: elf });
  const rpc = new Connection(net.rpcUrl, { commitment: 'confirmed', wsEndpoint: net.wsUrl });
  for (const key of [admin.publicKey, user.publicKey]) net.fundSol(key.toBase58(), 20_000_000_000);
  async function send(instructions, payer = admin, extra = []) {
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
    throw Error('Unknown local outcome. Inspect signature ' + sig + ' before retrying.');
  }
  async function accountIx(owner, newKey, space) {
    return SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: newKey.publicKey, space,
      lamports: await rpc.getMinimumBalanceForRentExemption(space), programId: owner });
  }
  const amount = async address => (await spl.getAccount(rpc, address)).amount;
  const chainAt = async () => Number((await rpc.getAccountInfo(SYSVAR_CLOCK_PUBKEY)).data.readBigInt64LE(32));
  const travel = async ts => { net.timeTravelToTimestamp(ts * 1000); assert.equal(await chainAt(), ts); };
  async function decodedAccount(address, decode) {
    const acc = await rpc.getAccountInfo(address);
    assert(acc);
    return decode({ owner: acc.owner.toBase58(), executable: acc.executable, space: acc.data.length,
      data: [acc.data.toString('base64'), 'base64'] });
  }
  const supply = 17_280_000_000_000n;
  const funding = launchAllocations({ supply, activeSeasonWeight: 0n }).stake;
  const day = 86_400;
  const rps = funding / BigInt(day * 10);
  assert.equal(rps * BigInt(day * 10), funding);
  const start = 1_800_000_000;
  await travel(start - 60);
  await send([await accountIx(token, mintKey, spl.MINT_SIZE), spl.createInitializeMint2Instruction(mint, 9, admin.publicKey, null)], admin, [mintKey]);
  await send([spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminAta, admin.publicKey, mint),
    spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userAta, user.publicKey, mint),
    spl.createMintToInstruction(mint, adminAta, admin.publicKey, supply),
    spl.createTransferInstruction(adminAta,userAta,admin.publicKey,100n)]);
  await send([await accountIx(program, globalKey, 2136), ix('initialize_global_config',
    [s(admin.publicKey), w(global), r(gAuth), r(system)])], admin, [globalKey]);
  const gs = await decodedAccount(global, readGlobalConfig);
  assert.equal(gs.treasuryFeeBps, 0);
  await send([await accountIx(program, farmKey, 8336), ix('initialize_farm',
    [s(admin.publicKey), w(farm), r(global), w(fVault), r(fAuth), r(mint), r(token), r(system), r(SYSVAR_RENT_PUBKEY)])], admin, [farmKey]);
  await send([ix('initialize_reward', [s(admin.publicKey), w(farm), r(global), r(mint), w(rVault), w(tVault),
    r(fAuth), r(gAuth), r(token), r(system), r(SYSVAR_RENT_PUBKEY)])]);
  await send([ix('initialize_user', [s(user.publicKey), s(user.publicKey), r(user.publicKey), r(user.publicKey), w(userState), w(farm), r(system), r(SYSVAR_RENT_PUBKEY)])], user);
  await send([ix('add_rewards', [s(admin.publicKey), w(farm), r(mint), w(rVault), r(fAuth), w(adminAta), r(program), r(token)], u64(funding), u64(0))]);
  // Anchor config mode 16 encodes reward index and a Borsh Vec of curve points.
  const points = Buffer.concat([u64(0), unsigned(4, 3), u64(0), u64(0), u64(start), u64(rps), u64(start + 10 * day), u64(0)]);
  await send([cfg(admin.publicKey,16,points)]);
  const fs = await decodedAccount(farm, readFarmConfig);
  assert.equal(fs.mint, fs.rewards[0].mint);
  assert.equal(fs.warmup + fs.cooldown, 0);
  assert.equal(fs.lockingMode, '0');
  assert.equal(await amount(rVault), funding);
  console.log('Created same-mint farm, funded 5% and loaded the ten-day curve into the recorded ELF.');

  // One full day elapses with zero stake. The first staker must not acquire
  // those idle emissions. Signed instructions go through the real program.
  await travel(start + day);
  await send([stake(100)], user);
  assert.equal(await amount(fVault),100n);
  await travel(start + day + 10);
  await send([harvest()], user);
  assert.equal(await amount(userAta), 10n * rps);
  assert.equal(await amount(fVault),100n);
  await send(withdrawPrincipal(), user);
  assert.equal(await amount(fVault),0n);
  assert.equal(await amount(userAta), 100n + 10n * rps);
  await send([stake(100)], user);
  await assert.rejects(send([cfg(user.publicKey,0,Buffer.concat([u64(0),u64(0)]))],user), /InvalidFarmConfigUpdateAuthority|authority/i);

  await travel(start + 10 * day + 10);
  await assert.rejects(send([recover(admin.publicKey)]), /RewardScheduleCurveSet|curve/i);
  const adminBefore = await amount(adminAta);
  // Set constant rate zero after expiry. The program requires the default
  // curve before recovering unused rewards. Earned liabilities remain.
  await send([cfg(admin.publicKey,0,Buffer.concat([u64(0),u64(0)]))]);
  await send([recover(admin.publicKey)]);
  const recovered = await amount(adminAta) - adminBefore;
  const claim = await amount(rVault);
  assert.equal(recovered,rps * BigInt(day));
  assert.equal(claim, funding - recovered - 10n * rps);
  assert.equal(await amount(fVault),100n);
  const beforeClaim = await amount(userAta);
  await send([harvest()],user);
  assert.equal(await amount(userAta) - beforeClaim,claim);
  await send(withdrawPrincipal(),user);
  assert.equal(await amount(fVault),0n);
  assert.equal(await amount(rVault),0n);
  assert.equal(await amount(tVault),0n);
  assert.equal(await amount(userAta), funding - recovered + 100n);
  console.log(JSON.stringify({ deployedSlot:evidence.deployment.deployedSlot, programHash:evidence.deployment.allocatedElfSha256,
    grossFarmFunding:String(funding), idleRecovered:String(recovered), userGrossRewards:String(funding - recovered),
    harvestFeeBps:gs.treasuryFeeBps, withdrawnPrincipal:'100', realFundsUsed:false, sourceMatch:'unverified' }));
} finally { net.stop(); }
