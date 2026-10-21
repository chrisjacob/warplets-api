import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates, syntheticBundle } from "./fixtures";
import { acquire, captureCohort, control, dryRun, reserveQuota, saveCandidate } from "./store";
import { runReviews } from "./research";
import { runMarketCycle } from "./market-cycle";
import { DEFAULT_POLICY } from "./model";
import worker, { handle, type LocalEnv } from "./worker";
import { boundedJson, MAINNET_GENESIS, RpcClient } from "./rpc";
import { runCycle } from "./ingest";
import { gateSample, walletInput, signature } from "./wallet-fixtures.test-helper";
import { reserveWalletQuota, runWalletCycle } from "./wallet-cycle";
import { WSOL } from "./pump";
import { CandidateCardSchema, candidateCard } from "./candidate-card";
import { assess } from "./model";
import { InboxRecoveryResponse } from "./inbox-recovery-model";

const instances: DatabaseSync[] = [];
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function fixture() {
  const db = new DatabaseSync(":memory:"); instances.push(db);
  db.exec(readFileSync(new URL("../migrations/0001_discovery.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_account_evidence.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0003_fixture_isolation.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0004_research_history.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0005_wallet_analysis.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0006_wallet_research.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0007_funding_history.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0008_second_hop.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0009_elections.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0010_quality_refresh.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0011_lead_markets.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0012_token_artwork.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0013_wallet_work.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0014_policy_previews.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0015_signal_research.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0016_wallet_yield.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0017_operations.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0018_solana_identity.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0019_backing_rehearsal.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0020_backing_cutoff_history.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0021_backing_candidate_scope_guard.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0022_backing_window_index.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0023_attention_lab.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0025_inbox_recovery.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0028_funding_reader_recovery.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0033_mint_review_intake.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0035_candidate_expiry.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0036_market_batch_diagnostics.sql", import.meta.url), "utf8"));
  const d1 = sqliteD1(db);
  const env: LocalEnv = { TENX_DB: d1, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: "a".repeat(64), TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "3000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_PROVIDER: "geckoterminal", TENX_QUALITY_ENABLED: "true", TENX_QUALITY_RPC_DAILY_LIMIT: "1800", TENX_MARKET_ENABLED: "false", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
  return { db, d1, env };
}
const req = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:8794/api/10x/${path}`, init);
function admin(body: unknown, token = "a".repeat(64)): RequestInit { return { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }; }
describe("durable discovery state and public/admin API", () => {
  it("serves recovery receipts from saved state without reserving source calls or accepting public writes",async()=>{
    const {d1,env}=fixture(),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("provider forbidden"));
    const before=await d1.prepare("SELECT * FROM tenx_usage").all();
    const response=await handle(req("discovery/inbox-recovery"),env);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(InboxRecoveryResponse.parse(await response.json()).data).toMatchObject({used_today:0,pending_recent:0,recent:[],provider_requests:0,evidence_gates_changed:false});
    expect((await handle(req("discovery/inbox-recovery",{method:"POST"}),env)).status).toBe(404);
    expect(await d1.prepare("SELECT * FROM tenx_usage").all()).toEqual(before);expect(outside).not.toHaveBeenCalled();
  });
  it("projects compact cards only after full assessment and keeps evidence on detail/default reads", async () => {
    const { d1, env } = fixture(), at = new Date(), examples = await fixtureCandidates(at);
    examples[0].wallet_analysis = await gateSample();
    for (const c of examples) await saveCandidate(d1, c);
    const full = await (await handle(req("candidates?mode=fixture&limit=100"), env)).json() as { data: { candidates: unknown[]; counts: unknown } };
    const compact = await (await handle(req("candidates?mode=fixture&limit=100&view=cards"), env)).json() as { data: { candidates: unknown[]; counts: unknown } };
    expect(compact.data.counts).toEqual(full.data.counts);
    expect(compact.data.candidates.map(c => CandidateCardSchema.parse(c).address)).toEqual(full.data.candidates.map(c => (c as { address: string }).address));
    for (const raw of compact.data.candidates) {
      const card = CandidateCardSchema.parse(raw), original = examples.find(c => c.address === card.address)!;
      const assessed = assess(original, DEFAULT_POLICY, at);
      expect(card.eligibility).toBe(assessed.eligibility); expect(card.reasons).toEqual(assessed.reasons);
      expect(raw).not.toHaveProperty("wallet_analysis"); expect(raw).not.toHaveProperty("risk"); expect(raw).not.toHaveProperty("holders.owners"); expect(raw).not.toHaveProperty("creation.signature");
      expect(card.discovery_score?.version).toBe("discovery-score-v1");
      expect(candidateCard({...assessed,discovery_score:card.discovery_score,discovery_rank:card.discovery_rank})).toEqual(card);
    }
    expect(JSON.stringify(compact.data).length).toBeLessThan(JSON.stringify(full.data).length * 0.65);
    const first = await (await handle(req("candidates?mode=fixture&limit=1&view=cards"), env)).json() as { next_cursor: string };
    expect((await handle(req(`candidates?mode=fixture&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`), env)).status).toBe(409);
    expect((await handle(req(`candidates?mode=fixture&limit=1&view=cards&cursor=${encodeURIComponent(first.next_cursor)}`), env)).status).toBe(200);
    const detail = await (await handle(req(`candidates/solana/${examples[0].address}?mode=fixture`), env)).json() as { data: unknown };
    expect(JSON.stringify(detail)).toContain("wallet_analysis"); expect(JSON.stringify(full.data)).toContain("wallet_analysis");
  });
  it("retains first discovery but measures wallet research from its later immutable baseline", async () => {
    const { d1 } = fixture(), at = new Date("2026-10-18T00:00:00Z"), c = { ...(await fixtureCandidates(at))[0]!, mode: "live" as const }, w = await gateSample();
    await captureCohort(d1, c, at.toISOString());
    const later = "2026-10-18T00:10:00Z", sample = { ...c, wallet_analysis: { ...w, observed_at: later }, market: { ...c.market!, fetched_at: later } };
    await captureCohort(d1, sample, later); await captureCohort(d1, { ...sample, wallet_analysis: { ...sample.wallet_analysis, observed_at: "2026-10-18T00:20:00Z" } }, "2026-10-18T00:20:00Z");
    expect((await d1.prepare("SELECT selected_at FROM tenx_cohorts").first<{ selected_at: string }>())?.selected_at).toBe(at.toISOString());
    expect((await d1.prepare("SELECT selected_at FROM tenx_wallet_cohorts").first<{ selected_at: string }>())?.selected_at).toBe(later);
    await runReviews(d1, new Date("2026-10-19T03:00:00Z"));
    const report = JSON.parse((await d1.prepare("SELECT payload FROM tenx_reviews WHERE day='2026-10-18'").first<{ payload: string }>())!.payload);
    expect(report.outcomes[0]).toMatchObject({ selected_at: later, cohort_kind: "first_wallet_sample", recommended: false, features: { sampled_buyers: 3 } });
  });
  it("timestamps independently refreshed wallet evidence before freezing it for research", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates(new Date("2026-10-20T00:00:00Z")))[0]!, mode: "live" as const }, w = await gateSample();
    await captureCohort(d1, { ...c, wallet_analysis: { ...w, observed_at: "2026-10-20T00:01:00Z" } }, "2026-10-20T00:00:00Z");
    expect((await d1.prepare("SELECT selected_at FROM tenx_cohorts").first<{ selected_at: string }>())?.selected_at).toBe("2026-10-20T00:01:00Z");
  });
  it("preserves newer risk/holder observations when older discovery work finishes",async()=>{
    const {d1}=fixture(),at=new Date("2026-10-20T00:00:00Z"),c={...(await fixtureCandidates(at))[0]!,mode:"live" as const};
    const later="2026-10-20T00:10:00.000Z";await saveCandidate(d1,{...c,risk:{...c.risk,observed_at:later}});await saveCandidate(d1,c);
    const saved=JSON.parse((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{payload:string}>())!.payload);
    expect(saved.risk.observed_at).toBe(later);expect((await d1.prepare("SELECT selected_at FROM tenx_cohorts").first<{selected_at:string}>())?.selected_at).toBe(later);
  });
  it("collects, persists and exposes immutable wallet transactions without repeating source-limited work", async () => {
    const { d1, env } = fixture(), input = await walletInput(), base = (await fixtureCandidates())[0]!;
    await saveCandidate(d1, { ...base, mode: "live", creation: input.asset.creation, graduation: null });
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const result = body.method === "getGenesisHash" ? MAINNET_GENESIS : body.method === "getTransaction" ? input.records.find(r => r.signature === body.params[0])?.transaction ?? null : body.method === "getSignaturesForAddress" ? body.params[0] === input.histories[0]!.address ? input.records.map(r => ({ signature: r.signature, slot: r.transaction!.slot, blockTime: r.transaction!.blockTime, err: null, confirmationStatus: "finalized" })).reverse() : [] : null;
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    });
    const settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 100, marketEnabled: false, walletEnabled: true, walletDailyLimit: 80, transport };
    const first = await runWalletCycle(settings, base.address); expect(first).toMatchObject({ state: "succeeded", verified_buys: 3 });
    const before = transport.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).method === "getTransaction").length;
    expect(await runWalletCycle(settings, base.address)).toMatchObject({ state: "waiting", reason:"source_limited",rpc_calls:0 });
    expect(transport.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).method === "getTransaction")).toHaveLength(before);
    expect(transport.mock.calls.filter(([,init])=>{const b=JSON.parse(String(init?.body));return b.method==="getSignaturesForAddress" && b.params[0]===input.histories[0]!.address})).toHaveLength(1);
    const evidence = await handle(req(`wallet-evidence/${first.evidence_hash}`), env); expect(evidence.status).toBe(200);
    const provider=vi.spyOn(globalThis,"fetch");
    const activity=await handle(req(`activity/solana/${base.address}`),env);
    expect(activity.status).toBe(200);expect(await activity.json()).toMatchObject({data:{organic_trading:"unverified",fees:{network_fee_lamports_raw:"15000",transactions:3}}});expect(provider).not.toHaveBeenCalled();
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_wallet_transactions").first<{ n: number }>())?.n).toBe(4);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_wallet_profiles").first<{ n: number }>())?.n).toBe(4);
    const current = JSON.parse((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{payload:string}>())!.payload);
    await d1.prepare("UPDATE tenx_wallet_evidence SET payload=json_set(payload,'$.gaps',json('[\"tampered\"]')) WHERE payload_hash=?1").bind(current.wallet_analysis.evidence_hash).run();
    expect(await runWalletCycle(settings,base.address)).toMatchObject({state:"waiting",reason:"cache_invalid",plan:{gaps:["wallet_evidence_cache_hash_mismatch"]},rpc_calls:0});
  });
  it("exposes bounded wallet planning and measured yield without provider calls or public writes",async()=>{
    const {d1,env}=fixture(),provider=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("provider forbidden"));
    const before=await d1.prepare("SELECT payload FROM tenx_candidates").all();
    const response=await handle(req("discovery/wallet-plan"),env);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({data:{scope:"up_to_20_current_contenders",provider_requests:0,evidence_gates_changed:false,reader_recovery:{daily_limit:20,per_turn_limit:2,used_today:0,remaining_today:20,recent:[],provider_requests:0,evidence_gates_changed:false},yield:{turns:0,rpc_calls:0,rpc_per_completed_window:null}}});
    expect(await d1.prepare("SELECT payload FROM tenx_candidates").all()).toEqual(before);expect(provider).not.toHaveBeenCalled();
    expect((await handle(new Request("http://localhost/api/10x/discovery/wallet-plan",{method:"POST"}),env)).status).toBe(404);
  });
  it("preserves newer independent wallet and market snapshots when older chain work completes", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates(new Date("2026-10-20T00:00:00Z")))[0]!, mode: "live" as const }, w = await gateSample();
    const newer = { ...c, wallet_analysis: w, market: { ...c.market!, fetched_at: "2026-10-20T00:01:00Z" } };
    await saveCandidate(d1, newer); await saveCandidate(d1, c);
    const row = JSON.parse((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{ payload: string }>())!.payload);
    expect(row.wallet_analysis).toEqual(w); expect(row.market.fetched_at).toBe(newer.market.fetched_at);
  });
  it("caps wallet requests atomically inside the global RPC allowance", async () => {
    const { d1 } = fixture(), settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 2, marketDailyLimit: 100, marketEnabled: false, walletEnabled: true, walletDailyLimit: 3 };
    const reserve = reserveWalletQuota(d1, settings, new Date());
    const result = await Promise.allSettled(Array.from({ length: 10 }, () => reserve()));
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect((await d1.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first<{ used: number }>())?.used).toBe(2);
    expect((await d1.prepare("SELECT used FROM tenx_wallet_usage").first<{ used: number }>())?.used).toBe(3);
  });
  it("wallet automation respects pause, source backoff and active leases, including targeted manual refresh", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates())[0]!, mode: "live" as const }; await saveCandidate(d1, c);
    const transport = vi.fn(), settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 100, marketEnabled: false, walletEnabled: true, walletDailyLimit: 80, transport };
    await d1.prepare("UPDATE tenx_control SET paused=1").run(); expect(await runWalletCycle(settings, c.address)).toMatchObject({ state: "paused" });
    await d1.prepare("UPDATE tenx_control SET paused=0").run();
    const later = new Date(Date.now() + 300000).toISOString();
    await d1.prepare("UPDATE tenx_wallet_control SET next_refresh_at=?1,last_error='rpc_rate_limited'").bind(later).run();
    expect(await runWalletCycle(settings, c.address)).toMatchObject({ state: "waiting" });
    await d1.prepare("UPDATE tenx_wallet_control SET last_error=NULL,lease_until=?1").bind(later).run();
    expect(await runWalletCycle(settings, c.address)).toMatchObject({ state: "waiting" }); expect(transport).not.toHaveBeenCalled();
  });
  it("wallet public reads are cached and admin wallet collection requires authentication", async () => {
    const { env } = fixture(), transport = vi.spyOn(globalThis, "fetch");
    expect((await handle(req(`wallets/solana/${(await fixtureCandidates())[0]!.address}`), env)).status).toBe(200);
    expect((await handle(req(`wallet-evidence/${"a".repeat(64)}`), env)).status).toBe(404);
    expect((await handle(req("admin/wallet-refresh"), env)).status).toBe(401); expect(transport).not.toHaveBeenCalled();
  });
  it("retains immutable observation and first recommendation snapshots separately", async () => {
    const { d1 } = fixture(), now = new Date("2026-10-20T00:00:00Z"), c = { ...(await fixtureCandidates(now))[0]!, mode: "live" as const };
    await captureCohort(d1, c, now.toISOString());
    const initial = await d1.prepare("SELECT payload,input_hash FROM tenx_cohorts").first();
    const h = { version: "owners-v2" as const, layout_certified: true, status: "verified" as const, observed_at: now.toISOString(), context_slot: 30000, payload_hash: "a".repeat(64), supply_raw: "1000", inventoried_raw: "1000", account_count: 201, holder_count: 200, top1_pct: 1, top10_pct: 10, pool_pct: 50, creator_pct: 0, creator: c.address, owners: [], gaps: [] };
    await captureCohort(d1, { ...c, holders: h, wallet_analysis: await gateSample() }, now.toISOString());
    expect(await d1.prepare("SELECT payload,input_hash FROM tenx_cohorts").first()).toEqual(initial);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_selections").first<{ n: number }>())?.n).toBe(1);
    expect(await d1.prepare("SELECT payload FROM tenx_selections").first()).not.toEqual({ payload: (initial as { payload: string }).payload });
  });
  it("creates idempotent daily report revisions without provider calls and keeps absent outcomes unknown", async () => {
    const { d1, env } = fixture(), prior = new Date("2026-10-18T00:00:00Z"), c = { ...(await fixtureCandidates(prior))[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    await runReviews(d1, new Date("2026-10-19T03:00:00Z")); await runReviews(d1, new Date("2026-10-19T04:00:00Z"));
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_reviews").first<{ n: number }>())?.n).toBe(1);
    const response = await (await handle(req("research/reviews"), env)).json() as { data: { reports: { counts: { measured: number; insufficient_data: number } }[]; automatic_policy_changes: boolean } };
    expect(response.data.reports[0]?.counts).toMatchObject({ measured: 0, insufficient_data: 1 }); expect(response.data.automatic_policy_changes).toBe(false);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_usage").first<{ n: number }>())?.n).toBe(0);
  });
  it("batches market history under a lease, preserves risk data and validates history queries", async () => {
    const { d1, env } = fixture(), now = new Date(), c = { ...(await fixtureCandidates(now))[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    const transport = vi.fn(async () => Response.json({ data: [{ attributes: { address: c.pool, base_token_price_usd: ".002", market_cap_usd: null, fdv_usd: "400000", reserve_in_usd: "50000", volume_usd: { h24: "5000" } }, relationships: { base_token: { data: { id: `solana_${c.address}` } } } }], included: [{ id: `solana_${c.address}`, type: "token", attributes: { image_url: "https://assets.geckoterminal.com/valid" } }] }));
    const settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 100, marketEnabled: true, transport };
    expect(await runMarketCycle(settings, new Date(now.getTime() + 1000))).toMatchObject({ state: "succeeded", updated: 1 });
    expect(await runMarketCycle(settings, new Date(now.getTime() + 2000))).toMatchObject({ state: "waiting" }); expect(transport).toHaveBeenCalledTimes(1);
    const saved = JSON.parse((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{ payload: string }>())!.payload);
    expect(saved.risk).toEqual(c.risk); expect(saved.checked_at).toBe(c.checked_at); expect(saved.market.image_url).toBe("https://assets.geckoterminal.com/valid");
    const history = await (await handle(req(`history/solana/${c.address}?hours=24`), env)).json() as { data: { points: unknown[] } };
    expect(history.data.points).toHaveLength(2); expect((await worker.fetch(req(`history/solana/${c.address}?hours=999`), env)).status).toBe(400);
  });
  it("screens uninspected migrations in one market request without publishing unverified candidates", async () => {
    const { d1 } = fixture(), now = new Date(), b = await syntheticBundle(now, 91), at = now.toISOString();
    await d1.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES(?1,?2,?3,?4,?5)").bind(b.mint,b.pool,JSON.stringify(b.graduation),b.graduation.transaction.signatures[0]!,at).run();
    const transport = vi.fn(async () => Response.json([{chainId:"solana",pairAddress:b.pool,baseToken:{address:b.mint},quoteToken:{address:WSOL},marketCap:200000,liquidity:{usd:50000}}]));
    expect(await runMarketCycle({db:d1,rpcUrl:"https://rpc.example",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:true,marketProvider:"dexscreener",transport},now)).toMatchObject({state:"succeeded",requested:1,updated:1});
    expect(transport).toHaveBeenCalledOnce();
    expect(JSON.parse((await d1.prepare("SELECT payload FROM tenx_lead_markets WHERE address=?1").bind(b.mint).first<{payload:string}>())!.payload)).toMatchObject({market_cap_usd:200000});
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_candidates").first<{n:number}>())?.n).toBe(0);
    expect((await d1.prepare("SELECT used FROM tenx_usage WHERE provider='market'").first<{used:number}>())?.used).toBe(1);
  });
  it("paces chain refresh without source calls before the scheduled next tick", async () => {
    const { d1 } = fixture(), now = new Date();
    await d1.prepare("UPDATE tenx_control SET next_refresh_at=?1 WHERE id=1").bind(new Date(now.getTime() + 300000).toISOString()).run();
    const transport = vi.fn();
    expect(await runCycle({ db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 5000, marketDailyLimit: 600, marketEnabled: false, paced: true, transport }, now)).toMatchObject({ state: "waiting" }); expect(transport).not.toHaveBeenCalled();
    expect(DEFAULT_POLICY.version).toBe("discovery-local-v3");
  });
  it("reserves the remaining free budget for contender checks instead of spending it on discovery",async()=>{
    const {d1}=fixture(),now=new Date("2026-10-20T00:00:00Z"),transport=vi.fn();
    const result=await runCycle({db:d1,rpcUrl:"https://rpc.example",rpcDailyLimit:100,marketDailyLimit:600,marketEnabled:false,paced:true,qualityEnabled:true,qualityDailyLimit:80,walletEnabled:true,walletDailyLimit:30,transport},now);
    expect(result).toMatchObject({state:"waiting",reason:"rpc_budget_reserved_for_contenders"});expect(transport).not.toHaveBeenCalled();expect((await control(d1)).lease_owner).toBeNull();expect((await control(d1)).retry_after).toBeNull();
  });
  it("reserves quotas atomically, including concurrent requests", async () => {
    const { d1 } = fixture(), reserve = reserveQuota(d1, { rpc: 3, market: 2 }, new Date());
    const result = await Promise.allSettled(Array.from({ length: 10 }, () => reserve("rpc")));
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(3);
    expect((await d1.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first<{ used: number }>())?.used).toBe(3);
  });
  it("permits only one active job lease and respects pause", async () => {
    const { d1 } = fixture(), now = new Date().toISOString();
    expect(await acquire(d1, "one", now)).toBe(true); expect(await acquire(d1, "two", now)).toBe(false);
    await d1.prepare("UPDATE tenx_control SET paused=1,lease_until=NULL WHERE id=1").run();
    expect(await acquire(d1, "three", now)).toBe(false);
  });
  it("does not count fixture data as live or let it win a dry run", async () => {
    const { env, d1 } = fixture();
    for (const c of await fixtureCandidates()) await saveCandidate(d1, c);
    const live = await (await handle(req("candidates"), env)).json() as { data: { candidates: unknown[] } };
    expect(live.data.candidates).toEqual([]);
    const examples = await (await handle(req("candidates?mode=fixture"), env)).json() as { data: { candidates: unknown[] } };
    expect(examples.data.candidates).toHaveLength(4);
    expect(await dryRun(d1, new Date())).toMatchObject({ outcome: "no_eligible_winner", winner_address: null, launch_enabled: false });
  });
  it("preserves independent proofs and deduplicates repeated saves", async () => {
    const { d1 } = fixture(), c = (await fixtureCandidates())[0]!;
    const live = { ...c, mode: "live" as const };
    await saveCandidate(d1, live); await saveCandidate(d1, live);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_candidates").first<{ n: number }>())?.n).toBe(1);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_proofs").first<{ n: number }>())?.n).toBe(2);
  });
  it("cannot overwrite a live candidate by seeding the same fixture address", async () => {
    const { d1 } = fixture(), c = (await fixtureCandidates())[0]!;
    await saveCandidate(d1, { ...c, mode: "live", name: "Live name" }); await saveCandidate(d1, c);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_candidates").first<{ n: number }>())?.n).toBe(2);
    expect((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{ payload: string }>())?.payload).toContain("Live name");
  });
  it("denies all admin reads/writes without the local operator token", async () => {
    const { env } = fixture();
    for (const path of ["jobs", "refresh", "pause", "dry-run", "seed-fixtures", "policies/preview"]) {
      expect((await handle(req(`admin/${path}`, path === "jobs" ? undefined : admin({ reason: "test" }, "wrong")), env)).status).toBe(401);
    }
    expect((await handle(req("admin/jobs", { headers: { authorization: `Bearer ${env.TENX_ADMIN_TOKEN}` } }), env)).status).toBe(200);
  });
  it("rejects cross-origin admin writes and remote runtime hosts", async () => {
    const { env } = fixture();
    const init = admin({ reason: "test pause", paused: true });
    (init.headers as Record<string, string>).origin = "https://evil.example";
    expect((await handle(req("admin/pause", init), env)).status).toBe(403);
    expect((await handle(new Request("https://deployed.example/api/10x/candidates"), env)).status).toBe(503);
    expect((await handle(req("candidates"), { ...env, TENX_LOCAL_ONLY: "false" })).status).toBe(503);
  });
  it("validates pagination and expires a cursor against a changed snapshot", async () => {
    const { env, d1 } = fixture(); for (const c of await fixtureCandidates()) await saveCandidate(d1, c);
    expect((await worker.fetch(req("candidates?limit=101"), env)).status).toBe(400);
    expect((await worker.fetch(req("candidates?cursor=not-base64"), env)).status).toBe(400);
    const first = await (await handle(req("candidates?mode=fixture&limit=2"), env)).json() as { next_cursor: string; data: { candidates: { address: string }[] } };
    const second = await (await handle(req(`candidates?mode=fixture&limit=2&cursor=${encodeURIComponent(first.next_cursor)}`), env)).json() as { data: { candidates: { address: string }[] } };
    expect(new Set([...first.data.candidates, ...second.data.candidates].map(c => c.address)).size).toBe(4);
    const c = (await fixtureCandidates())[0]!; c.name = "changed snapshot"; await saveCandidate(d1, c);
    expect((await handle(req(`candidates?mode=fixture&cursor=${encodeURIComponent(first.next_cursor)}`), env)).status).toBe(409);
  });
  it("filters by verified 24h token creation and binds cursors to the age view",async()=>{
    const {env,d1}=fixture();for(const c of await fixtureCandidates())await saveCandidate(d1,c);
    const first=await(await handle(req("candidates?mode=fixture&age=24h&limit=1"),env)).json() as {data:{candidates:{symbol:string}[]};next_cursor:string};
    expect(first.data.candidates).toHaveLength(1);
    expect((await handle(req(`candidates?mode=fixture&age=all&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`),env)).status).toBe(409);
    const all=await(await handle(req("candidates?mode=fixture&age=24h&limit=100"),env)).json()as{data:{candidates:{symbol:string}[]}};expect(all.data.candidates.map(c=>c.symbol)).not.toContain("OLD");expect(all.data.candidates).toHaveLength(3);
  });
  it("persists pause reason and never enables financial capabilities", async () => {
    const { env, d1 } = fixture();
    expect((await handle(req("admin/pause", admin({ reason: "test maintenance", paused: true })), env)).status).toBe(200);
    expect((await control(d1)).paused).toBe(1);
    expect((await d1.prepare("SELECT reason FROM tenx_audit").first<{ reason: string }>())?.reason).toBe("test maintenance");
    const status = await (await handle(req("system/status"), env)).json() as { data: { capabilities: Record<string, boolean> } };
    expect(status.data.capabilities).toMatchObject({ voting: false, launches: false, signing: false, rewards: false });
  });
  it("retains last-good candidates and backs off after a provider outage", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates())[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    const result = await runCycle({ db: d1, rpcUrl: "https://api.mainnet-beta.solana.com", rpcDailyLimit: 20, marketDailyLimit: 20, marketEnabled: false, transport: async () => { throw new Error("offline"); } });
    expect(result).toMatchObject({ state: "failed", error_code: "rpc_unavailable" });
    expect((await d1.prepare("SELECT payload FROM tenx_candidates").first<{ payload: string }>())?.payload).toBe(JSON.stringify(c));
    expect((await control(d1)).retry_after).not.toBeNull(); expect((await control(d1)).lease_owner).toBeNull();
  });
  it("processes a replayed lead end to end, stores both proofs, and ignores duplicate job delivery", async () => {
    const { d1 } = fixture(), b = await syntheticBundle(), now = new Date("2026-10-20T00:00:00Z");
    await d1.prepare("UPDATE tenx_control SET last_harvest=?1 WHERE id=1").bind(now.toISOString()).run();
    await d1.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES(?1,?2,?3,?4,?5)")
      .bind(b.mint, b.pool, JSON.stringify(b.graduation), b.graduation.transaction.signatures[0]!, now.toISOString()).run();
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const result = body.method === "getGenesisHash" ? MAINNET_GENESIS : body.method === "getSignaturesForAddress" ? [{ signature: b.creation.transaction.signatures[0], slot: b.creation.slot, err: null, blockTime: b.creation.blockTime, confirmationStatus: "finalized" }] : body.method === "getTransaction" ? b.creation : b.accounts;
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    });
    const settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 10, marketEnabled: false, transport };
    expect(await runCycle(settings, now)).toMatchObject({ state: "succeeded", processed: 1 });
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_proofs").first<{ n: number }>())?.n).toBe(2);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_evidence").first<{ n: number }>())?.n).toBe(2);
    const calls = transport.mock.calls.length;
    expect(await runCycle(settings, now)).toMatchObject({ state: "duplicate" }); expect(transport).toHaveBeenCalledTimes(calls);
  });
  it("records an unsupported inbox layout and advances other signatures without retrying that body", async () => {
    const {d1}=fixture(),now=new Date("2026-10-20T00:00:00Z");
    await d1.prepare("UPDATE tenx_control SET last_harvest=?1 WHERE id=1").bind(now.toISOString()).run();
    for(const n of [91,92])await d1.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at) VALUES(?1,?2,?3)").bind(signature(n),10000-n,now.toISOString()).run();
    const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const b=JSON.parse(String(init?.body));
      return Response.json({jsonrpc:"2.0",id:b.id,result:b.method==="getGenesisHash"?MAINNET_GENESIS:b.params[0]===signature(91)?{version:1}:null});
    });
    const settings={db:d1,rpcUrl:"https://rpc.example",rpcDailyLimit:100,marketDailyLimit:10,marketEnabled:false,transport};
    expect(await runCycle(settings,now)).toMatchObject({state:"succeeded",rpc_calls:3});
    expect(await d1.prepare("SELECT result FROM tenx_pending_signatures WHERE signature=?1").bind(signature(91)).first()).toEqual({result:"transaction_layout_unsupported"});
    expect(await runCycle(settings,new Date(now.getTime()+60000))).toMatchObject({state:"succeeded",rpc_calls:2});
    const bodies=transport.mock.calls.map(([,init])=>JSON.parse(String(init?.body))).filter(b=>b.method==="getTransaction");
    expect(bodies.filter(b=>b.params[0]===signature(91))).toHaveLength(1);
    expect(bodies.filter(b=>b.params[0]===signature(92))).toHaveLength(2); // Archival null stays retryable.
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_candidates").first<{n:number}>())!.n).toBe(0);
  });
  it("rejects an attempt to replace an immutable proof", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates())[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    await expect(saveCandidate(d1, { ...c, creation: { ...c.creation!, payload_hash: "f".repeat(64) } })).rejects.toThrow("conflicting_immutable_proof");
  });
});
describe("bounded read-only RPC adapter", () => {
  it("checks mainnet identity and uses finalized commitment/version limits", async () => {
    const bundle = await syntheticBundle(); const calls: { method: string; params: unknown[]; id: number }[] = [];
    const rpc = new RpcClient("https://api.mainnet-beta.solana.com", async () => {}, async (_url, init) => {
      expect(init?.redirect).toBe("manual");
      const body = JSON.parse(String(init?.body)); calls.push(body);
      return Response.json({ jsonrpc: "2.0", id: body.id, result: body.method === "getGenesisHash" ? MAINNET_GENESIS : bundle.creation });
    });
    await rpc.checkCluster(); await rpc.transaction(bundle.creation.transaction.signatures[0]!);
    expect(calls[1]?.params[1]).toEqual({ commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1 });
  });
  it("fails closed for a wrong cluster, signature mismatch, and unsupported versions", async () => {
    const b = await syntheticBundle();
    const rpc = new RpcClient("https://rpc.example", async () => {}, async (_url, init) => Response.json({ jsonrpc: "2.0", id: JSON.parse(String(init?.body)).id, result: "devnet" }));
    await expect(rpc.checkCluster()).rejects.toThrow("wrong_solana_cluster");
    const r2 = new RpcClient("https://rpc.example", async () => {}, async () => Response.json({ jsonrpc: "2.0", id: 1, result: b.creation }));
    await expect(r2.transaction(b.graduation.transaction.signatures[0]!)).rejects.toThrow("transaction_signature_mismatch");
    const r3 = new RpcClient("https://rpc.example", async () => {}, async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32015 } }));
    await expect(r3.transaction(b.creation.transaction.signatures[0]!)).rejects.toThrow("unsupported_transaction_version");
  });
  it("does not retry 429s or exceed its cycle budget", async () => {
    const reserve = vi.fn(), transport = vi.fn(async () => new Response("limited", { status: 429 }));
    const rpc = new RpcClient("https://rpc.example", reserve, transport, 1);
    await expect(rpc.checkCluster()).rejects.toThrow("rpc_rate_limited");
    await expect(rpc.checkCluster()).rejects.toThrow("cycle_rpc_budget_exhausted");
    expect(transport).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1);
  });
  it("honors longer numeric or HTTP-date provider cooldowns with a five-minute minimum", async () => {
    vi.spyOn(Date,"now").mockReturnValue(Date.parse("2026-10-20T00:00:00Z"));
    for (const [header,seconds] of [["900",900],["Tue, 20 Oct 2026 00:20:00 GMT",1200],["1",300],["invalid",300]] as const) {
      const transport=vi.fn(async()=>new Response(null,{status:429,headers:{"retry-after":header}}));
      await expect(new RpcClient("https://rpc.example",async()=>{},transport).checkCluster()).rejects.toMatchObject({code:"rpc_rate_limited",retryAfterSeconds:seconds});
      expect(transport).toHaveBeenCalledOnce();
    }
  });
  it("cancels oversized streams before parsing", async () => {
    await expect(boundedJson(new Response("x".repeat(200)), 100)).rejects.toThrow("response_too_large");
  });
});
