import { describe, expect, it } from "vitest";
import creation from "../fixtures/recorded/pump-creation.json";
import origin from "../fixtures/recorded/pump-creation-provenance.json";
import migration from "../fixtures/recorded/pump-migration.json";
import state from "../fixtures/recorded/pump-state.json";
import pairedCreation from "../fixtures/recorded/paired-creation.json";
import pairedMigration from "../fixtures/recorded/paired-migration.json";
import pairedState from "../fixtures/recorded/paired-state.json";
import paired from "../fixtures/recorded/paired-provenance.json";
import { AccountsSchema, TransactionSchema } from "./rpc";
import { creationProof, migrations, verifyState } from "./pump";

describe("recorded public mainnet evidence (offline replay)", () => {
  it("decodes a real finalized create_v2 independently of pool discovery", async () => {
    const result = await creationProof(TransactionSchema.parse(creation), origin.mint, origin.proof.fetched_at);
    expect(result?.proof.signature).toBe(origin.proof.signature);
    expect(result?.proof.payload_hash).toBe(origin.proof.payload_hash);
    expect(result?.proof.instruction).toBe("create_v2");
    expect(result?.name).toBe(origin.name);
  });
  it("decodes a real finalized canonical Pump migration and token-2022 pool state", async () => {
    const tx = TransactionSchema.parse(migration);
    const events = await migrations(tx);
    expect(events).toHaveLength(1);
    expect(events[0]?.address).toBe("F6eaCZz5SQ2Ze5Z1dbKfJWCP77nYDdEZuqNs37Jhpump");
    expect(await verifyState(events[0]!, AccountsSchema.parse(state), "2026-10-19T13:52:00.590Z", tx.slot)).toMatchObject({ mint_authority: "revoked", freeze_authority: "revoked", pool_reserves_verified: true, mint_extensions: [18, 19] });
  });
  it("does not join creation and migration proofs from different assets", async () => {
    const event = (await migrations(TransactionSchema.parse(migration)))[0]!;
    expect(await creationProof(TransactionSchema.parse(creation), event.address, origin.proof.fetched_at)).toBeNull();
    expect(origin.mint).not.toBe(event.address);
  });
  it("replays both real proofs and current canonical state for one actual asset", async () => {
    const tx = TransactionSchema.parse(pairedMigration);
    const event = (await migrations(tx)).find(m => m.address === paired.mint)!;
    const creation = await creationProof(TransactionSchema.parse(pairedCreation), paired.mint, paired.captured_at);
    expect(event.pool).toBe(paired.pool);
    expect(creation?.proof.payload_hash).toBe(paired.creation.payload_hash);
    expect(creation?.proof.signature).toBe(paired.creation.signature);
    expect(tx.transaction.signatures[0]).toBe(paired.graduation.signature);
    expect(await verifyState(event, AccountsSchema.parse(pairedState), paired.captured_at, tx.slot)).toMatchObject({ pool_reserves_verified: true, mint_authority: "revoked", freeze_authority: "revoked" });
  });
});
