import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
let require = createRequire(
  new URL("./social-tools/package.json", import.meta.url),
);
try {
  require.resolve("solc");
} catch {
  require = createRequire(
    new URL("../.tmp/social-contract-tools/package.json", import.meta.url),
  );
}
const solc = require("solc");
const source = await readFile(
  new URL("../contracts/SocialCheckIn.sol", import.meta.url),
  "utf8",
);
const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "SocialCheckIn.sol": { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "shanghai",
        outputSelection: {
          "*": {
            "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
          },
        },
      },
    }),
  ),
);
const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length)
  throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
const compiled = output.contracts["SocialCheckIn.sol"].SocialCheckIn;
const artifact = {
  contractName: "SocialCheckIn",
  compiler: solc.version(),
  chainId: 8453,
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
};
await mkdir(new URL("../contracts/artifacts/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../contracts/artifacts/SocialCheckIn.json", import.meta.url),
  JSON.stringify(artifact, null, 2) + "\n",
);
console.log(
  `Compiled SocialCheckIn (${compiled.evm.deployedBytecode.object.length / 2} bytes).`,
);
const appRequire = createRequire(
  new URL("../app/package.json", import.meta.url),
);
const { createPublicClient, createWalletClient, custom, http, decodeEventLog } =
  appRequire("viem");
const { base } = appRequire("viem/chains");
if (process.argv.includes("--deploy")) {
  const { privateKeyToAccount } = appRequire("viem/accounts");
  const key = process.env.SOCIAL_CHECKIN_DEPLOYER_KEY;
  if (!key || !/^0x[0-9a-f]{64}$/i.test(key))
    throw new Error(
      "Set SOCIAL_CHECKIN_DEPLOYER_KEY for the funded Base mainnet deployment wallet. The key is never logged.",
    );
  const account = privateKeyToAccount(key),
    transport = http(process.env.BASE_RPC_URL || "https://mainnet.base.org");
  const client = createPublicClient({ chain: base, transport });
  if ((await client.getChainId()) !== 8453)
    throw new Error("Refusing deployment on a non-Base-mainnet RPC");
  const wallet = createWalletClient({ chain: base, transport, account });
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("Deployment failed");
  await writeFile(
    new URL("../contracts/artifacts/SocialCheckIn.base.json", import.meta.url),
    JSON.stringify(
      {
        chainId: 8453,
        address: receipt.contractAddress,
        transactionHash: hash,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Deployed on Base: ${receipt.contractAddress}. Set SOCIAL_CHECKIN_ADDRESS to this address in local and production bindings.`,
  );
} else {
  const ganache = require("ganache");
  const provider = ganache.provider({
    chain: { chainId: 8453 },
    wallet: { deterministic: true },
    logging: { quiet: true },
  });
  try {
    const transport = custom(provider),
      client = createPublicClient({ chain: base, transport }),
      wallet = createWalletClient({ chain: base, transport });
    const [alice, bob] = await wallet.getAddresses();
    const hash = await wallet.deployContract({
      account: alice,
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      gas: 1000000n,
    });
    const deployment = await client.waitForTransactionReceipt({ hash });
    const address = deployment.contractAddress;
    assert.ok(address);
    assert.equal(deployment.status, "success");
    const first = await wallet.writeContract({
      account: alice,
      address,
      abi: artifact.abi,
      functionName: "checkIn",
    });
    const receipt = await client.waitForTransactionReceipt({ hash: first });
    assert.equal(receipt.status, "success");
    const event = decodeEventLog({ abi: artifact.abi, ...receipt.logs[0] });
    assert.equal(event.eventName, "CheckedIn");
    assert.equal(event.args.member.toLowerCase(), alice.toLowerCase());
    const day = await client.readContract({
      address,
      abi: artifact.abi,
      functionName: "lastDay",
      args: [alice],
    });
    assert.ok(day > 0n);
    await assert.rejects(() =>
      client.simulateContract({
        account: alice,
        address,
        abi: artifact.abi,
        functionName: "checkIn",
      }),
    );
    await client.simulateContract({
      account: bob,
      address,
      abi: artifact.abi,
      functionName: "checkIn",
    });
    await assert.rejects(() =>
      client.simulateContract({
        account: bob,
        address,
        abi: artifact.abi,
        functionName: "checkIn",
        value: 1n,
      }),
    );
    await provider.request({ method: "evm_increaseTime", params: [86400] });
    await provider.request({ method: "evm_mine", params: [] });
    const second = await wallet.writeContract({
      account: alice,
      address,
      abi: artifact.abi,
      functionName: "checkIn",
      gas: 100000n,
    });
    assert.equal(
      (await client.waitForTransactionReceipt({ hash: second })).status,
      "success",
    );
    assert.equal(
      await client.readContract({
        address,
        abi: artifact.abi,
        functionName: "lastDay",
        args: [alice],
      }),
      day + 1n,
    );
    console.log(
      "Contract tests passed: wallet event, UTC day, duplicate rejection, independent wallet, payment rejection, next-day check-in. No mainnet transaction sent.",
    );
  } finally {
    await provider.disconnect();
  }
}
