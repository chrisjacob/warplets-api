import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates, syntheticBundle } from "./fixtures";
import { creationProof } from "./pump";
import { Reader, fromBase58, toBase58 } from "./solana";
import { saveCandidate } from "./store";
import { artworkFor, runArtworkCycle } from "./artwork";
import { safeMetadataUrl, safeTokenImage, tokenImageSources } from "./images";
import { handle, type LocalEnv } from "./worker";
const at = new Date("2026-10-20T00:00:00Z"), cid = "QmVqaEuPxZ6wNcuCHyg7RA824LrWvhrbEQGn6Vb5yATJx2", uri = `https://ipfs.io/ipfs/${cid}`;
const opened: DatabaseSync[] = [];
afterEach(() => { opened.forEach(d => d.close()); opened.length = 0; vi.restoreAllMocks(); });
async function setup(metadataUri = uri) {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), b = await syntheticBundle(at), ix = b.creation.transaction.message.instructions[0]!, bytes = fromBase58(ix.data), r = new Reader(bytes, 8);
  r.string(); r.string(); const start = r.offset; r.string();
  const text = new TextEncoder().encode(metadataUri), size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, text.length, true);
  ix.data = toBase58(Uint8Array.from([...bytes.slice(0, start), ...size, ...text, ...bytes.slice(r.offset)]));
  const origin = (await creationProof(b.creation, b.mint, at.toISOString()))!;
  const c = { ...(await fixtureCandidates(at))[0]!, mode: "live" as const, creation: origin.proof };
  await saveCandidate(db, c, [b.creation]);
  const transport = vi.fn(async () => Response.json({ image: "https://pbs.twimg.com/media/HVAL_kebgAAP6r9?format=png&name=240x240" }));
  const settings = { db, rpcUrl: "https://api.mainnet-beta.solana.com", rpcDailyLimit: 5000, marketDailyLimit: 600, marketEnabled: true, transport };
  return { db, sqlite, c, transport, settings };
}
describe("creation-linked token artwork", () => {
  it("normalizes IPFS and permits only explicit image hosts and media paths", () => {
    expect(safeMetadataUrl(`ipfs://${cid}`)).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
    expect(safeTokenImage("https://pbs.twimg.com/media/HVAL_kebgAAP6r9?format=png")).toBeTruthy();
    expect(tokenImageSources(uri, `ipfs://${cid}`)).toEqual([`https://gateway.pinata.cloud/ipfs/${cid}`]);
    for (const u of ["http://127.0.0.1/secret", "https://gateway.pinata.cloud:8794/ipfs/" + cid, "https://pbs.twimg.com/redirect", "https://pbs.twimg.com.evil.example/media/a", "data:image/png,x"]) expect(safeTokenImage(u)).toBeNull();
    expect(safeMetadataUrl("https://pbs.twimg.com/media/abc")).toBeNull();
  });
  it("replays cached creation, caches metadata with provenance and makes zero RPC calls", async () => {
    const { db, c, transport, settings } = await setup();
    expect(await runArtworkCycle(settings, at)).toMatchObject({ state: "succeeded", updated: 1, requested: 1 });
    expect(transport).toHaveBeenCalledExactlyOnceWith(`https://gateway.pinata.cloud/ipfs/${cid}`, expect.objectContaining({ redirect: "manual" }));
    const art = (await artworkFor(db, [c.address]))[c.address]!;
    expect(art).toMatchObject({ creation_hash: c.creation!.payload_hash, fetched_at: at.toISOString(), error: null });
    expect(art.metadata_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first()).toBeNull();
    expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='market'").first()).toEqual({ used: 1 });
    expect(await runArtworkCycle(settings, at)).toEqual({ state: "waiting" });
    await runArtworkCycle(settings, new Date(at.getTime() + 120000)); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects changed evidence without fetching any metadata", async () => {
    const { db, c, transport, settings } = await setup();
    await db.prepare("UPDATE tenx_evidence SET payload=json_set(payload,'$.slot',123)").run();
    await runArtworkCycle(settings, at);
    expect(transport).not.toHaveBeenCalled(); expect((await artworkFor(db, [c.address]))[c.address]!.error).toBe("creation_evidence_mismatch");
  });
  it("reuses identical content-addressed metadata while binding each mint to its own creation", async () => {
    const { db, c, transport, settings } = await setup();
    const fetched = "2026-10-19T12:00:00.000Z";
    await db.prepare("INSERT INTO tenx_artwork(address,image_url,metadata_uri,creation_hash,metadata_hash,fetched_at,attempted_at,error) VALUES('other','https://cdn.pump.fun/token.png',?1,?2,?3,?4,?4,NULL)").bind(`https://gateway.pinata.cloud/ipfs/${cid}`, "b".repeat(64), "c".repeat(64), fetched).run();
    expect(await runArtworkCycle(settings, at)).toMatchObject({ updated: 1, requested: 0 });
    expect(transport).not.toHaveBeenCalled(); expect((await artworkFor(db, [c.address]))[c.address]).toMatchObject({ creation_hash: c.creation!.payload_hash, fetched_at: fetched, metadata_hash: "c".repeat(64) });
  });
  it("does not contact unsupported metadata origins even when linked by a genuine creation", async () => {
    const { db, c, transport, settings } = await setup("https://localhost/private");
    await runArtworkCycle(settings, at); expect(transport).not.toHaveBeenCalled(); expect((await artworkFor(db, [c.address]))[c.address]!.error).toBe("metadata_uri_unsupported");
  });
  it("bounds metadata bodies and never fills missing artwork with an invented image", async () => {
    const { db, c, transport, settings } = await setup();
    transport.mockImplementationOnce(async () => new Response(JSON.stringify({ image: "https://cdn.pump.fun/token.png", data: "a".repeat(65000) })));
    await runArtworkCycle(settings, at); expect((await artworkFor(db, [c.address]))[c.address]).toMatchObject({ image_url: null, error: "metadata_unavailable" }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("obeys pause, shared market quota and the separate daily metadata ceiling", async () => {
    const { db, transport, settings } = await setup();
    await db.prepare("UPDATE tenx_control SET paused=1").run(); expect(await runArtworkCycle(settings, at)).toEqual({ state: "paused" });
    await db.prepare("UPDATE tenx_control SET paused=0").run();
    await db.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('artwork','2026-10-20',120)").run();
    expect(await runArtworkCycle(settings, at)).toMatchObject({ state: "failed", error_code: "artwork_daily_budget_exhausted" }); expect(transport).not.toHaveBeenCalled();
    await db.prepare("DELETE FROM tenx_usage WHERE provider='artwork'").run();
    await db.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('market','2026-10-20',600)").run();
    expect(await runArtworkCycle(settings, new Date(at.getTime() + 3600001))).toMatchObject({ state: "failed", error_code: "market_daily_budget_exhausted" }); expect(transport).not.toHaveBeenCalled();
  });
  it("does not follow redirects, execute metadata or fetch arbitrary image URLs", async () => {
    const { db, c, transport, settings } = await setup();
    transport.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: "http://localhost/private" } }));
    await runArtworkCycle(settings, at); expect((await artworkFor(db, [c.address]))[c.address]!.image_url).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("public artwork reads use cache only and admin refresh requires authentication", async () => {
    const { db, c } = await setup(), env: LocalEnv = { TENX_DB: db, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: "a".repeat(64), TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "5000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_PROVIDER: "dexscreener", TENX_QUALITY_ENABLED: "true", TENX_QUALITY_RPC_DAILY_LIMIT: "1800", TENX_MARKET_ENABLED: "true", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network"));
    const r = await handle(new Request(`http://127.0.0.1:8794/api/10x/artwork?addresses=${c.address}`), env); expect(r.status).toBe(200); expect((await r.json() as { data: unknown }).data).toEqual({});
    expect((await handle(new Request("http://127.0.0.1:8794/api/10x/admin/artwork-refresh", { method: "POST" }), env)).status).toBe(401); expect(network).not.toHaveBeenCalled();
  });
});
