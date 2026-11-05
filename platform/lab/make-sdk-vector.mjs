// Run with the absolute packages/meme-protocol path from the inspected
// October checkout after frozen, script-disabled dependency installation.
// Emits test instructions only. The SDK's Connection cannot issue a request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { launchAllocations } from '../domain/economics/index.mjs';

if (!process.argv[2]) throw Error('Supply the pinned, installed October protocol-lab directory.');
const requirePinned = createRequire(resolve(process.argv[2], 'package.json'));
const installed = JSON.parse(readFileSync(resolve(process.argv[2], 'node_modules/@meteora-ag/cp-amm-sdk/package.json')));
assert.equal(installed.version, '1.5.1');
const sdk = requirePinned('@meteora-ag/cp-amm-sdk');
const { Connection, Keypair } = requirePinned('@solana/web3.js');
const spl = requirePinned('@solana/spl-token');
const BN = requirePinned('bn.js');
const offline = new Connection('http://127.0.0.1:8899', { fetch() { throw Error('No RPC in fixture generation'); } });
const key = seed => Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey;
const mint = key(2), og = key(3), payer = key(4), nft = key(5);
const supply = 1_000_000_000_000n;
const allocation = launchAllocations({ supply, activeSeasonWeight: 2013n });
const activation = 1_800_000_000;
const baseFee = sdk.getFeeTimeSchedulerParams(9000, 100, sdk.BaseFeeMode.FeeTimeSchedulerLinear, 89, 89);
const d = sdk.decodeFeeTimeSchedulerParams(Buffer.from(baseFee.data));
sdk.validateFeeTimeScheduler(d.numberOfPeriod, d.periodFrequency, d.reductionFactor, d.cliffFeeNumerator, d.baseFeeMode, sdk.CURRENT_POOL_VERSION);
const numerator = elapsed => sdk.getFeeTimeBaseFeeNumerator(d.cliffFeeNumerator, d.numberOfPeriod, d.periodFrequency,
  d.reductionFactor, d.baseFeeMode, new BN(activation + elapsed), new BN(activation)).toString();
const amm = new sdk.CpAmm(offline);
const low = sdk.getSqrtPriceFromPrice('0.000001', 9, 9);
const high = sdk.getSqrtPriceFromPrice('0.001', 9, 9);
const amount = new BN(String(allocation.liquidity));
const delta = amm.preparePoolCreationSingleSide({ tokenAAmount: amount, minSqrtPrice: low, maxSqrtPrice: high,
  initSqrtPrice: low, collectFeeMode: sdk.CollectFeeMode.OnlyB });
const plan = await amm.createCustomPool({ creator: payer, payer, positionNft: nft, tokenAMint: mint, tokenBMint: og,
  tokenAAmount: amount, tokenBAmount: new BN(1), sqrtMinPrice: low, sqrtMaxPrice: high,
  initSqrtPrice: low, liquidityDelta: delta, poolFees: { baseFee, compoundingFeeBps: 0, padding: 0, dynamicFee: null },
  hasAlphaVault: false, activationType: sdk.ActivationType.Timestamp, collectFeeMode: sdk.CollectFeeMode.OnlyB,
  activationPoint: new BN(activation), tokenAProgram: spl.TOKEN_PROGRAM_ID, tokenBProgram: spl.TOKEN_PROGRAM_ID,
  isLockLiquidity: true });
const protocol = plan.tx.instructions.filter(ix => ix.programId.equals(sdk.CP_AMM_PROGRAM_ID));
const [init, lock] = protocol.map(ix => sdk.cpAmmCoder.instruction.decode(ix.data));
assert.equal(init.name, 'initialize_customizable_pool');
assert.equal(lock.name, 'permanent_lock_position');
assert.equal(lock.data.permanent_lock_liquidity.toString(), delta.toString());
assert.equal(init.data.params.collect_fee_mode, 1);
assert.equal(init.data.params.activation_type, 1);
assert.equal(init.data.params.activation_point.toString(), String(activation));
const accounts = Object.fromEntries(sdk.CpAmmIdl.instructions.find(i => i.name === init.name).accounts
  .map((account, i) => [account.name, protocol[0].keys[i].pubkey]));
assert.equal(accounts.token_a_mint.toBase58(), mint.toBase58());
assert.equal(accounts.token_b_mint.toBase58(), og.toBase58());
const serialize = ix => ({ program: ix.programId.toBase58(), data: ix.data.toString('hex'),
  accounts: ix.keys.map(a => ({ key: a.pubkey.toBase58(), signer: a.isSigner, writable: a.isWritable })) });
async function swap(input, output) {
  const tx = await amm.swap({ payer, pool: plan.pool, inputTokenMint: input, outputTokenMint: output,
    amountIn: new BN(1_000_000), minimumAmountOut: new BN(1), tokenAMint: mint, tokenBMint: og,
    tokenAVault: accounts.token_a_vault, tokenBVault: accounts.token_b_vault,
    tokenAProgram: spl.TOKEN_PROGRAM_ID, tokenBProgram: spl.TOKEN_PROGRAM_ID, referralTokenAccount: null,
    // The builder only needs the fee-mode discriminator for this linear schedule.
    poolState: { poolFees: { baseFee: { baseFeeInfo: { data: Array(32).fill(0) } } } } });
  return tx.instructions.map(serialize);
}
const vector = { provenance: 'Meteora cp-amm-sdk 1.5.1 / offline unsigned fixture', program: sdk.CP_AMM_PROGRAM_ID.toBase58(),
  poolVersion: sdk.CURRENT_POOL_VERSION, activation, supply: String(supply), quoteSeed: '1',
  allocation: Object.fromEntries(Object.entries(allocation).map(([k,v]) => [k, String(v)])),
  baseFeeHex: Buffer.from(baseFee.data).toString('hex'),
  numerators: [-1, ...Array.from({ length: 91 }, (_, i) => i)].map(elapsed => ({ elapsed, numerator: numerator(elapsed) })),
  mint: mint.toBase58(), og: og.toBase58(), payer: payer.toBase58(), nft: nft.toBase58(),
  pool: plan.pool.toBase58(), position: plan.position.toBase58(), delta: delta.toString(),
  tokenAVault: accounts.token_a_vault.toBase58(), tokenBVault: accounts.token_b_vault.toBase58(),
  attAta: spl.getAssociatedTokenAddressSync(mint, payer).toBase58(), ogAta: spl.getAssociatedTokenAddressSync(og, payer).toBase58(),
  initAndLock: plan.tx.instructions.map(serialize), buy: await swap(og, mint), sell: await swap(mint, og) };
writeFileSync(new URL('./fixtures/damm-v2-prd-vector.json', import.meta.url), JSON.stringify(vector, null, 2) + '\n');
