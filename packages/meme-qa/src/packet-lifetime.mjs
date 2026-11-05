import { rpc, hash, loopback } from "./safety.mjs";
export async function inspectPacketLifetime(
  url,
  packetHash,
  packet,
  request = rpc,
) {
  if (packet.network === "solana-local") loopback(url);
  else if (
    packet.network !== "solana-mainnet" ||
    url !== "https://api.mainnet-beta.solana.com"
  )
    throw Error("Unsupported packet network");
  const genesisHash = await request(url, "getGenesisHash"),
    blockHeight = await request(url, "getBlockHeight", [
      { commitment: "finalized", minContextSlot: packet.lifetime.contextSlot },
    ]);
  const valid = await request(url, "isBlockhashValid", [
    packet.lifetime.blockhash,
    { commitment: "finalized", minContextSlot: packet.lifetime.contextSlot },
  ]);
  if (
    typeof genesisHash !== "string" ||
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 0 ||
    !Number.isSafeInteger(valid?.context?.slot) ||
    valid.context.slot < packet.lifetime.contextSlot ||
    typeof valid.value !== "boolean"
  )
    throw Error("Incomplete chain lifetime evidence");
  if (packet.lookupTables.length) {
    const tables = await request(url, "getMultipleAccounts", [
      packet.lookupTables.map((t) => t.address),
      {
        encoding: "base64",
        commitment: "finalized",
        minContextSlot: packet.lifetime.contextSlot,
      },
    ]);
    if (
      !Number.isSafeInteger(tables?.context?.slot) ||
      tables.context.slot < packet.lifetime.contextSlot ||
      !Array.isArray(tables.value) ||
      tables.value.length !== packet.lookupTables.length
    )
      throw Error("Lookup provenance unavailable");
    for (let i = 0; i < tables.value.length; i++)
      if (
        tables.value[i]?.owner !==
          "AddressLookupTab1e1111111111111111111111111" ||
        !Array.isArray(tables.value[i].data) ||
        tables.value[i].data[1] !== "base64" ||
        hash(Buffer.from(tables.value[i].data[0], "base64")) !==
          packet.lookupTables[i].dataHash
      )
        throw Error("Lookup table changed after packet review");
  }
  return {
    packetHash,
    genesisHash,
    contextSlot: valid.context.slot,
    blockHeight,
    blockhashValid: valid.value,
    observedAt: Date.now(),
    completeIntentSearch: false,
  };
}
