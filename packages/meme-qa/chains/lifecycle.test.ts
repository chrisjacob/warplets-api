import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  createTransferInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import worker from "../../../meme/src/worker/index";
import { testDb } from "../../../meme/src/worker/testDb";
import { sha } from "../../../meme/src/worker/db";
import { canonical } from "../../../meme/src/shared/canonical";
import { decodeDistributor } from "../src/jito-account.mjs";
import { encode58 } from "../../../meme/src/shared/base58";
import {
  prepareIntent,
  simulateIntent,
  beginHandoff,
  recordSignature,
  reconcileIntent,
} from "../../../meme/src/worker/transactions";
import type {
  TransactionPlan,
  TransactionReadAdapter,
} from "../../../meme/src/shared/transactions";
// Test-only imports; boundary checks reject all of these from application source.
import {
  startSolana,
  chainTime,
  instructionsForPlan,
  localReadAdapter,
  sendLocalPlan,
  createLocalMint,
  createLocalAta,
  mintLocal,
} from "../src/local-solana.mjs";
import {
  planLockedJito,
  buildLockedClaimInstructions,
  assertJitoAccount,
} from "../../meme-protocol/src/jito-locked.mjs";
import {
  buildLaunchProof,
  cpAmmCoder,
} from "../../meme-protocol/src/meteora.mjs";
import { fixture } from "../../meme-protocol/src/fixture.mjs";
const DAY = 86400000,
  origin = "http://127.0.0.1:5196";
test(
  "actual local launch → signed vote → immutable settlement → verified funding → released claim survives a lost response",
  {
    skip: process.platform !== "linux" || process.arch !== "x64",
    timeout: 120000,
  },
  async (context) => {
    const { net, connection, payer } = await startSolana(),
      storage = testDb();
    try {
      const claimant = Keypair.generate();
      net.fundSol(claimant.publicKey.toBase58(), 10000000000);
      const mint = await createLocalMint(connection, payer, 9),
        og = await createLocalMint(connection, payer, 9);
      const source = await createLocalAta(
          connection,
          payer,
          mint,
          payer.publicKey,
        ),
        quote = await createLocalAta(connection, payer, og, payer.publicKey),
        destination = await createLocalAta(
          connection,
          payer,
          mint,
          claimant.publicKey,
        );
      await mintLocal(connection, payer, mint, source.address, 1000000000000n);
      await mintLocal(connection, payer, og, quote.address, 1n);
      const initial = await chainTime(connection),
        nft = Keypair.generate();
      context.mock.timers.enable({ apis: ["Date"], now: initial });
      const proof = await buildLaunchProof({
        ...fixture,
        totalSupply: "1000000000000",
        editionMint: mint.toBase58(),
        ogMint: og.toBase58(),
        creator: payer.publicKey.toBase58(),
        payer: payer.publicKey.toBase58(),
        positionNft: nft.publicKey.toBase58(),
        activationUnixSeconds: Math.floor(initial / 1000) + 1,
      });
      async function execute(
        operation: TransactionPlan["operation"],
        subject: string,
        instructions: TransactionInstruction[],
        signers: Keypair[],
        expected: Record<string, string>,
        observe: () => Promise<Record<string, string>>,
        notBefore = Date.now(),
        loseResponse = false,
        beforeHandoff?: () => Promise<{
          observedHash: string;
          observedAt: number;
          context: string;
        }>,
      ) {
        const plan: TransactionPlan = {
          version: 1,
          network: "solana-local",
          operation,
          subject,
          businessKey: `solana-local:${operation}:${subject}`,
          signers: signers.map((s) => s.publicKey.toBase58()),
          instructions: instructionsForPlan(instructions),
          expected,
          maximumCost: "1000000000",
          costUnit: "lamports",
          notBefore,
          expiresAt: Date.now() + 3600000,
          simulated: true,
        };
        const intent = await prepareIntent(storage.db, plan),
          adapter = localReadAdapter(
            connection,
            observe,
          ) as TransactionReadAdapter;
        await simulateIntent(storage.db, intent.id, adapter);
        await beginHandoff(
          storage.db,
          intent.id,
          beforeHandoff
            ? async () => ({
                ...(await beforeHandoff()),
                planHash: intent.plan_hash,
              })
            : undefined,
        );
        const signature = await sendLocalPlan(connection, plan, signers);
        if (loseResponse) {
          storage.interruptNextBatch();
          await assert.rejects(
            recordSignature(storage.db, intent.id, signature),
            /lost response/,
          );
        }
        await recordSignature(storage.db, intent.id, signature);
        let receipt = await reconcileIntent(storage.db, intent.id, adapter);
        const deadline = performance.now() + 30000;
        while (receipt.state !== "confirmed" && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          receipt = await reconcileIntent(storage.db, intent.id, adapter);
        }
        assert.equal(receipt.state, "confirmed");
        assert.equal(receipt.chain_status, "finalized");
        assert.equal(
          (await reconcileIntent(storage.db, intent.id, adapter)).state,
          "confirmed",
        );
        return receipt;
      }
      const launchInstructions = proof.instructions.map(
        (i) =>
          new TransactionInstruction({
            programId: new PublicKey(i.program),
            keys: i.accounts.map((a) => ({
              pubkey: new PublicKey(a.pubkey),
              isSigner: a.signer,
              isWritable: a.writable,
            })),
            data: Buffer.from(i.data, "hex"),
          }),
      );
      await execute(
        "launch",
        "edition",
        launchInstructions,
        [payer, nft],
        {
          pool: proof.pool,
          mint: mint.toBase58(),
          permanentLockedLiquidity: proof.liquidityDelta,
        },
        async () => {
          const a = await connection.getAccountInfo(
            new PublicKey(proof.position),
          );
          const p = cpAmmCoder.accounts.decode("Position", a!.data);
          return {
            pool: p.pool.toBase58(),
            mint: mint.toBase58(),
            permanentLockedLiquidity: p.permanent_locked_liquidity.toString(),
          };
        },
      );
      const launchedAt = await chainTime(connection);
      context.mock.timers.setTime(launchedAt + 20 * 3600000);
      const token = "disposable-cycle-session",
        operator = "disposable-cycle-operator";
      storage.raw
        .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
        .run(await sha(token), origin, 42, null, launchedAt + 2 * DAY);
      storage.raw
        .prepare("INSERT INTO meme_operator_tokens VALUES(?,?,?)")
        .run(await sha(operator), "disposable complete cycle", Date.now());
      async function call(path: string, body?: unknown, privileged = false) {
        const r = await worker.fetch(
          new Request(origin + path, {
            method: body === undefined ? "GET" : "POST",
            headers: {
              origin,
              "content-type": "application/json",
              cookie: "meme_session=" + token,
              ...(privileged ? { authorization: "Bearer " + operator } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
          {
            MEME_DB: storage.db,
            LOCAL_PREVIEW_ONLY: "true",
            LOCAL_PARTICIPATION_ENABLED: "true",
            LOCAL_OPERATIONS_ENABLED: "false",
            HELIUS_API_KEY: "",
            PYTH_API_KEY: "",
          },
        );
        const value = (await r.json()) as any;
        assert.equal(r.status, 200, JSON.stringify(value));
        return value;
      }
      const challenge = await call("/api/auth/solana/challenge", {
        address: claimant.publicKey.toBase58(),
        role: "reward",
      });
      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        Buffer.concat([
          Buffer.from("302e020100300506032b657004220420", "hex"),
          Buffer.from(claimant.secretKey.subarray(0, 32)),
        ]),
        { name: "Ed25519" },
        false,
        ["sign"],
      );
      await call("/api/auth/solana/verify", {
        nonce: challenge.nonce,
        signature: encode58(
          new Uint8Array(
            await crypto.subtle.sign(
              "Ed25519",
              privateKey,
              new TextEncoder().encode(challenge.message),
            ),
          ),
        ),
      });
      const opens = launchedAt + 21 * 3600000,
        closes = launchedAt + 23 * 3600000;
      await call(
        "/api/meme/operator/rounds",
        {
          id: "cycle",
          opensAt: opens,
          closesAt: closes,
          attribute: "cast",
          simulated: true,
          candidates: [
            {
              id: "a",
              name: "Alpha",
              symbol: "A",
              ogMint: og.toBase58(),
              evidence: "SIMULATED controlled local campaign",
            },
          ],
        },
        true,
      );
      await call(
        "/api/meme/operator/rounds/cycle/freeze",
        {
          source: "warplets",
          mode: "simulated",
          sourceAt: Date.now(),
          checkpoint: "simulated-no-warplets",
          complete: true,
          ownership: [],
        },
        true,
      );
      await call(
        "/api/meme/operator/campaigns",
        {
          id: "edition",
          mint: mint.toBase58(),
          symbol: "QA",
          launchedAt,
          totalSupply: "1000000000000",
          decimals: 9,
          mode: "simulated",
          launchEvidence:
            "Executed captured program in local Surfpool; financial receipt recorded",
        },
        true,
      );
      context.mock.timers.setTime(opens + 1);
      await call("/api/meme/rounds/cycle/vote", {
        candidateId: "a",
        key: "cycle-vote-0001",
      });
      context.mock.timers.setTime(closes + 1);
      await call(
        "/api/meme/operator/ledger",
        {
          campaignId: "edition",
          mode: "simulated",
          scopeWallets: [claimant.publicKey.toBase58()],
          events: [],
          throughAt: closes,
          throughSlot: 1,
          source: "SIMULATED complete zero-activity history",
          cursor: "final",
          complete: true,
          fromMint: true,
        },
        true,
      );
      await call(
        "/api/meme/operator/rounds/cycle/outcome",
        {
          skip: true,
          reason:
            "SIMULATED skipped next launch; existing campaign still releases",
        },
        true,
      );
      let settled = await call(
        "/api/meme/operator/rounds/cycle/settle",
        {},
        true,
      );
      for (let n = 0; n < 10 && settled.state !== "finalized"; n++)
        settled = await call(
          "/api/meme/operator/rounds/cycle/settle",
          {},
          true,
        );
      assert.equal(settled.state, "finalized");
      const state = await call("/api/meme/state"),
        entitlement = state.entitlements[0];
      assert.equal(entitlement.amount, "10000000000");
      net.timeTravelToTimestamp(closes + 1000);
      const plan = planLockedJito({
        simulated: true,
        state: "finalized_unfunded",
        allocationId: "edition:1",
        inputHash: settled.inputHash,
        resultHash: settled.resultHash,
        version: "1001",
        mint: mint.toBase58(),
        admin: payer.publicKey.toBase58(),
        receiverOwner: payer.publicKey.toBase58(),
        launchedAtMs: launchedAt,
        releaseIndex: 1,
        preparedAt: Math.floor((closes + 1000) / 1000),
        expectedAmount: entitlement.amount,
        recipients: [
          { wallet: entitlement.reward_wallet, amount: entitlement.amount },
        ],
      });
      const distributor = new PublicKey(plan.expected.distributor),
        vault = new PublicKey(plan.expected.tokenVault);
      const preconditionHash = await sha(
        canonical({
          ...plan.expected,
          clawedBack: false,
          vaultAmount: "0",
          vaultMint: mint.toBase58(),
          vaultAuthority: distributor.toBase58(),
        }),
      );
      await execute(
        "create-distributor",
        "edition:1",
        [plan.creation],
        [payer],
        { owner: plan.expected.program },
        async () => ({
          owner: (await connection.getAccountInfo(
            distributor,
          ))!.owner.toBase58(),
        }),
      );
      await execute(
        "fund",
        "edition:1",
        [
          createTransferInstruction(
            source.address,
            vault,
            payer.publicKey,
            BigInt(entitlement.amount),
          ),
        ],
        [payer],
        { mint: mint.toBase58(), amount: entitlement.amount, preconditionHash },
        async () => {
          const a = await getAccount(connection, vault);
          assertJitoAccount(
            plan,
            decodeDistributor(
              plan,
              await connection.getAccountInfo(distributor),
            ),
          );
          return {
            mint: a.mint.toBase58(),
            amount: a.amount.toString(),
            preconditionHash,
          };
        },
        Date.now(),
        true,
        async () => {
          const observed = decodeDistributor(
            plan,
            await connection.getAccountInfo(distributor, "finalized"),
          );
          assertJitoAccount(plan, observed);
          const token = await getAccount(connection, vault, "finalized");
          const observedHash = await sha(
            canonical({
              ...observed,
              vaultAmount: token.amount.toString(),
              vaultMint: token.mint.toBase58(),
              vaultAuthority: token.owner.toBase58(),
            }),
          );
          return {
            observedHash,
            observedAt: Date.now(),
            context: "solana-local:" + (await connection.getSlot("finalized")),
          };
        },
      );
      const immutableBefore = JSON.stringify(
        storage.raw.prepare("SELECT * FROM meme_entitlements").all(),
      );
      const fundedView = await call("/api/meme/state");
      assert.equal(fundedView.entitlements[0].fundingState, "funded");
      assert.equal(fundedView.entitlements[0].releaseState, "scheduled");
      assert.equal(fundedView.entitlements[0].claimable, false);
      context.mock.timers.setTime(plan.expected.endVestingAt * 1000 + 1000);
      net.timeTravelToTimestamp(Date.now());
      await execute(
        "claim",
        "edition:1:42",
        buildLockedClaimInstructions(plan, claimant.publicKey.toBase58()),
        [claimant],
        { amount: entitlement.amount, wallet: claimant.publicKey.toBase58() },
        async () => {
          const a = await getAccount(connection, destination.address);
          return { amount: a.amount.toString(), wallet: a.owner.toBase58() };
        },
        entitlement.release_at,
      );
      assert.equal(
        JSON.stringify(
          storage.raw.prepare("SELECT * FROM meme_entitlements").all(),
        ),
        immutableBefore,
      );
      assert.equal(
        storage.raw
          .prepare("SELECT COUNT(*) n FROM meme_financial_receipts")
          .get()!.n,
        4,
      );
      assert.equal(
        (await getAccount(connection, destination.address)).amount,
        10000000000n,
      );
      const claimedView = await call("/api/meme/state");
      assert.equal(claimedView.entitlements[0].claimState, "claimed");
      assert.equal(claimedView.entitlements[0].releaseState, "released");
    } finally {
      context.mock.timers.reset();
      storage.close();
      net.stop();
    }
  },
);
