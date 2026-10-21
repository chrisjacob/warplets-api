import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {gateSample,key,signature} from "./wallet-fixtures.test-helper";
import {assess,DEFAULT_POLICY,type Candidate} from "./model";
import {defaultScoreInput,evaluateDiscoveryScore,freezeDiscoveryScore,replayDiscoveryScore,scoreFreshness} from "./discovery-score";
import {rankedDiscovery,candidateScorecard,scoreInventoryCandidates} from "./discovery-score-store";
import type {ScoreInput} from "./discovery-score-model";
import {createElection,electionRecord} from "./elections";
import {handle,type LocalEnv} from "./worker";

const at=new Date("2026-10-21T01:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
function dbFixture(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
async function ideal():Promise<ScoreInput>{
  // Synthetic policy fixture only; never inserted in the live local store.
  const c={...(await fixtureCandidates(at))[0]!,mode:"live" as const};
  c.holders={version:"owners-v2",status:"verified",layout_certified:true,observed_at:at.toISOString(),context_slot:20000,payload_hash:"a".repeat(64),supply_raw:"1000000",inventoried_raw:"1000000",account_count:200,holder_count:200,top1_pct:5,top10_pct:20,pool_pct:20,creator_pct:1,creator:key(7),owners:[],gaps:[]};
  const w=await gateSample();c.wallet_analysis={...w,version:"wallet-signals-v5",observed_at:at.toISOString(),funding_coverage:w.wallets.map((wallet,i)=>({wallet:wallet.wallet,anchor_signature:signature(i+80),anchor_kind:wallet.signed_creation?"signed_creation" as const:"sampled_buy" as const,anchor_at:c.creation!.block_time,window_start:new Date(Date.parse(c.creation!.block_time)-3600000).toISOString(),pages:1,signatures:0,transactions_in_window:0,transactions_examined:0,status:"window_examined" as const,boundary_reached:true,gaps:[]}))};
  const prices=Array.from({length:7},(_,i)=>({source:"geckoterminal" as const,fetched_at:new Date(at.getTime()-(6-i)*300000).toISOString(),observed_at:null,price_usd:1+i/24}));
  return defaultScoreInput(c,at,prices);
}
async function put(db:D1Database,c:Candidate){await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?1,?2,?3,?4,?5)").bind(c.mode,c.address,c.pool,JSON.stringify(c),c.checked_at).run();}
describe("versioned continuous discovery grading",()=>{
  it("reaches exactly 100 only with complete fresh support and preserves independent action checks",async()=>{
    const input=await ideal(),result=evaluateDiscoveryScore(input);expect(result.value).toBe(100);expect(result.evidence_coverage).toBe(100);expect(result.components.reduce((n,c)=>n+c.maximum,0)).toBe(100);expect(result.criteria).toHaveLength(18);
    const record=await freezeDiscoveryScore(input);expect((await replayDiscoveryScore(record)).status).toBe("verified");expect(assess(input.candidate,DEFAULT_POLICY,at).eligibility).toBe("eligible");
  });
  it("distinguishes an unobserved zero from a well-observed rejected origin",async()=>{
    const good=await ideal(),empty={...good.candidate,creation:null,graduation:null,verification:"provisional" as const,market:null,holders:null,wallet_analysis:null,risk:{...good.candidate.risk,mint_authority:"unknown" as const,freeze_authority:"unknown" as const,pool_reserves_verified:false,observed_at:null}};
    const missing=evaluateDiscoveryScore(defaultScoreInput(empty,at)),bad=evaluateDiscoveryScore({...good,candidate:{...good.candidate,verification:"rejected"}});
    expect(missing).toMatchObject({value:0,evidence_coverage:0,concerns:[]});expect(bad.value).toBe(0);expect(bad.evidence_coverage).toBeGreaterThan(80);expect(bad.concerns[0]!.code).toBe("origin_rejected");expect(JSON.stringify(missing)).not.toMatch(/scam|rug/i);
  });
  it("never renormalizes absent cap or funding data into clean evidence",async()=>{
    const input=await ideal(),missingCap=evaluateDiscoveryScore({...input,candidate:{...input.candidate,market:{...input.candidate.market!,market_cap_usd:null,fdv_usd:999999999}}});
    expect(missingCap.value).toBe(90);expect(missingCap.evidence_coverage).toBe(90);
    const w=input.candidate.wallet_analysis!,partial=evaluateDiscoveryScore({...input,candidate:{...input.candidate,wallet_analysis:{...w,funding_coverage:[]}}});
    expect(partial.value).toBeLessThan(90);expect(partial.criteria.find(c=>c.id==="dev_funded_supply_pct")?.points).toBe(0);
  });
  it.each(["liquidity","holders","buyers"])("rewards graded increases in %s up to its bound",async kind=>{
    const input=await ideal(),values=kind==="liquidity"?[0,1000,5000,25000,50000]:kind==="holders"?[0,10,50,100,200]:[0,1,2,3,10];
    const scores=values.map(value=>{const c=structuredClone(input.candidate);if(kind==="liquidity")c.market!.liquidity_usd=value;else if(kind==="holders")c.holders!.holder_count=value;else c.wallet_analysis!.metrics.distinct_buyers=value;return evaluateDiscoveryScore({...input,candidate:c}).criteria.find(c=>c.id===(kind==="buyers"?"sampled_buyers":kind))!.points;});
    expect(scores).toEqual([...scores].sort((a,b)=>a-b));expect(scores[0]).toBe(0);expect(scores.at(-1)).toBe(scores.at(-2));
  });
  it("caps concentrated tokens despite perfect reported momentum, including stale/partial adverse inventories",async()=>{
    const input=await ideal(),c=structuredClone(input.candidate);c.holders!.top1_pct=90;
    const result=evaluateDiscoveryScore({...input,candidate:c});expect(result.value).toBeLessThanOrEqual(20);expect(result.ceiling).toBe(20);
    c.holders!.status="partial";c.holders!.observed_at=new Date(at.getTime()-86400000).toISOString();
    const stale=evaluateDiscoveryScore({...input,candidate:c});expect(stale.ceiling).toBe(20);expect(stale.components.find(c=>c.category==="holders")!.points).toBe(0);
  });
  it.each(["top1_pct","top10_pct","creator_pct"])("never improves the grade as %s concentration worsens",async field=>{
    const input=await ideal(),scores=[0,5,10,20,40,70,90,100].map(value=>{const c=structuredClone(input.candidate);c.holders![field as "top1_pct"]=value;return evaluateDiscoveryScore({...input,candidate:c}).value;});expect(scores).toEqual([...scores].sort((a,b)=>b-a));
  });
  it("applies authority and wallet-exposure ceilings without promoting them to fraud findings",async()=>{
    const input=await ideal(),authority=evaluateDiscoveryScore({...input,candidate:{...input.candidate,risk:{...input.candidate.risk,mint_authority:"active"}}});expect(authority.value).toBeLessThanOrEqual(40);
    const w=input.candidate.wallet_analysis!,exposure=evaluateDiscoveryScore({...input,candidate:{...input.candidate,wallet_analysis:{...w,status:"unavailable",metrics:{...w.metrics,dev_funded_supply_pct:100}}}});expect(exposure.ceiling).toBe(20);
  });
  it("distinguishes unknown liquidity from observed loss of depth and never lets other points hide zero liquidity",async()=>{
    const input=await ideal(),grade=(liquidity_usd:number|null)=>evaluateDiscoveryScore({...input,candidate:{...input.candidate,market:{...input.candidate.market!,liquidity_usd}}});
    expect(grade(null).concerns).toEqual([]);expect(grade(null).value).toBeGreaterThan(0);expect(grade(0)).toMatchObject({value:0,ceiling:0});expect(grade(5000).value).toBeLessThanOrEqual(20);expect(grade(12500).value).toBeLessThanOrEqual(50);expect(grade(25000).ceiling).toBe(100);
    expect(grade(0).criteria.find(c=>c.id==="liquidity")!.status).toBe("observed");expect(grade(null).criteria.find(c=>c.id==="liquidity")!.status).toBe("unknown");
  });
  it("decays positive support smoothly, rejects future credit and keeps dated adverse ceilings",async()=>{
    const input=await ideal(),ttl=180;expect(scoreFreshness(at.toISOString(),at.getTime()+ttl*1000,ttl)).toBe(1);expect(scoreFreshness(at.toISOString(),at.getTime()+2.5*ttl*1000,ttl)).toBe(.5);expect(scoreFreshness(at.toISOString(),at.getTime()+4*ttl*1000,ttl)).toBe(0);
    const midway=evaluateDiscoveryScore({...input,as_of:new Date(at.getTime()+450000).toISOString()});expect(midway.components.find(c=>c.category==="market")!.points).toBe(10);
    const c=structuredClone(input.candidate);c.market!.observed_at=new Date(at.getTime()+1).toISOString();c.risk.observed_at=new Date(at.getTime()+1).toISOString();c.holders!.observed_at=new Date(at.getTime()+1).toISOString();c.wallet_analysis!.observed_at=new Date(at.getTime()+1).toISOString();
    const future=evaluateDiscoveryScore({...input,candidate:c,prices:[]});expect(future.value).toBe(10);expect(future.evidence_coverage).toBe(10);expect(future.criteria.filter(c=>["market","controls","holders","wallets"].includes(c.category)).every(c=>c.points===0)).toBe(true);
  });
  it.each(["limited","mixed","duplicate","gap","future","short"])("does not award sampled-performance credit for %s history",async kind=>{
    const input=await ideal();if(kind==="limited")input.history_limited=true;if(kind==="mixed")input.prices[0]!.source="dexscreener";if(kind==="duplicate")input.prices[1]!.fetched_at=input.prices[0]!.fetched_at;if(kind==="gap")input.prices[0]!.fetched_at=new Date(at.getTime()-7200000).toISOString();if(kind==="future")input.prices.at(-1)!.observed_at=new Date(at.getTime()+1).toISOString();if(kind==="short")input.prices=input.prices.slice(1);
    expect(evaluateDiscoveryScore(input).criteria.find(c=>c.id==="sampled_performance")!.points).toBe(0);
  });
  it("does not let unrelated or duplicate completed windows cover missing expected wallets",async()=>{
    const input=await ideal(),w=input.candidate.wallet_analysis!,first=w.funding_coverage![0]!;
    w.funding_coverage=Array.from({length:4},(_,i)=>({...first,wallet:key(80+i)}));expect(evaluateDiscoveryScore(input).criteria.find(c=>c.id==="funding_windows")!.points).toBe(0);
    w.funding_coverage=Array(4).fill(first);expect(evaluateDiscoveryScore(input).criteria.find(c=>c.id==="funding_windows")!.points).toBe(2.5);
  });
  it.each(["funding_wallet_limit","funding_output_limit"])("withholds clean-funding credit when %s hides the denominator",async gap=>{
    const input=await ideal();input.candidate.wallet_analysis!.gaps.push(gap);const result=evaluateDiscoveryScore(input);
    expect(result.criteria.find(c=>c.id==="funding_windows")!.points).toBe(0);expect(result.criteria.find(c=>c.id==="dev_funded_supply_pct")!.points).toBe(0);expect(result.criteria.find(c=>c.id==="funding_windows")!.status).toBe("unknown");
  });
  it("withholds buyer/clean-sale credit for uncertified or omitted trade data",async()=>{
    const input=await ideal();input.candidate.wallet_analysis!.gaps.push("trade_token_owner_unverified");const r=evaluateDiscoveryScore(input);expect(r.criteria.find(c=>c.id==="sampled_buyers")!.points).toBe(0);expect(r.criteria.find(c=>c.id==="dev_sold_supply_pct")!.points).toBe(0);
  });
  it("keeps overflowing derived ratios unknown instead of awarding points or breaking the list",async()=>{
    const input=await ideal();input.candidate.market!.market_cap_usd=1e-300;input.candidate.market!.liquidity_usd=1e300;input.prices[0]!.price_usd=1e-300;input.prices.at(-1)!.price_usd=1e300;
    const result=evaluateDiscoveryScore(input);expect(result.criteria.find(c=>c.id==="liquidity_ratio")!.value).toBeNull();expect(result.criteria.find(c=>c.id==="sampled_performance")!.points).toBe(0);expect(result.criteria.find(c=>c.id==="sampled_performance")!.notes).toContain("price_return_nonfinite");
  });
  it("rejects changed inputs, weights, results and observation times when replaying an exported scorecard",async()=>{
    const original=await freezeDiscoveryScore(await ideal());
    for(const kind of ["input","result","time","policy"]){const r=structuredClone(original);if(kind==="input")r.inputs.candidate.name="Changed";if(kind==="result")r.result.value=5;if(kind==="time")r.inputs.as_of=new Date(at.getTime()+10000).toISOString();if(kind==="policy")(r.inputs.policy.weights as {origin:number}).origin=99;await expect(replayDiscoveryScore(r)).rejects.toThrow();}
    const huge=await ideal();huge.candidate.verification_reasons=["x".repeat(1800001)];await expect(freezeDiscoveryScore(huge)).rejects.toThrow("discovery_score_input_size_limit");
  });
});
describe("cached graded browsing and unchanged action snapshots",()=>{
  it("ranks the whole inventory before taking 100 and keeps action failures inspectable at high grades",async()=>{
    const {db}=dbFixture(),input=await ideal(),base={...input.candidate,holders:null,wallet_analysis:null};
    for(let i=1;i<=102;i++)await put(db,{...base,address:key(i),checked_at:new Date(at.getTime()-i*1000).toISOString()});
    const exceptional={...input.candidate,address:key(102),holders:{...input.candidate.holders!,top1_pct:11}};await db.prepare("UPDATE tenx_candidates SET payload=?1 WHERE mode='live' AND address=?2").bind(JSON.stringify(exceptional),exceptional.address).run();
    for(const price of input.prices)await db.prepare("INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(exceptional.address,price.fetched_at,JSON.stringify({...input.candidate.market!,...price})).run();
    const provider=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("provider forbidden"));const ranked=await rankedDiscovery(db,await scoreInventoryCandidates(db,"live",false),at,"score","all");
    expect(ranked.rows).toHaveLength(100);expect(ranked.rows[0]!.address).toBe(exceptional.address);expect(ranked.rows[0]!.discovery_score.value).toBe(99);expect(ranked.rows[0]!.eligibility).toBe("excluded");expect(ranked.rows[0]!.rank).toBeNull();expect(ranked.rows[0]!.discovery_rank).toBe(1);expect(provider).not.toHaveBeenCalled();expect(await db.prepare("SELECT count(*) n FROM tenx_usage").first()).toEqual({n:0});
    const record=await candidateScorecard(db,exceptional.address,"live",at);expect(record?.result.value).toBe(99);expect((await replayDiscoveryScore(record!)).status).toBe("verified");
  });
  it("keeps deterministic ASCII ties independent of input order",async()=>{
    const {db}=dbFixture(),base=(await ideal()).candidate,items=[3,2,1].map(n=>({...base,mode:"fixture" as const,address:key(n)}));
    const a=await rankedDiscovery(db,items,at,"score","all"),b=await rankedDiscovery(db,[...items].reverse(),at,"score","all");expect(a.rows.map(c=>c.address)).toEqual(b.rows.map(c=>c.address));expect(a.rows.map(c=>c.address)).toEqual(items.map(c=>c.address).sort());
  });
  it("pins pagination to its observation clock and rejects sort, source and stale-cursor changes",async()=>{
    const {db}=dbFixture(),input=await ideal();for(let i=1;i<=3;i++)await put(db,{...input.candidate,address:key(i)});
    vi.useFakeTimers();vi.setSystemTime(at);const env={TENX_DB:db,TENX_LOCAL_ONLY:"true"} as LocalEnv,base="http://127.0.0.1:8794/api/10x/candidates?limit=1&view=cards";
    const first=await (await handle(new Request(base),env)).json() as {next_cursor:string;data:{candidates:{address:string}[]}};expect(first.next_cursor.length).toBeLessThanOrEqual(300);
    vi.setSystemTime(new Date(at.getTime()+30000));const url=base+`&cursor=${encodeURIComponent(first.next_cursor)}`;
    const next=await handle(new Request(url),env);expect(next.status).toBe(200);expect((await next.json() as typeof first).data.candidates[0]!.address).not.toBe(first.data.candidates[0]!.address);
    expect((await handle(new Request(url+"&sort=liquidity"),env)).status).toBe(409);
    await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.name','new observation')").run();expect((await handle(new Request(url),env)).status).toBe(409);
    vi.setSystemTime(new Date(at.getTime()+300001));expect((await handle(new Request(url),env)).status).toBe(409);
  });
  it("leaves action eligibility, frozen election inputs and hashes unchanged after scoring",async()=>{
    const {db}=dbFixture(),input=await ideal();await put(db,input.candidate);
    const before=assess(input.candidate,DEFAULT_POLICY,at),election=await createElection(db,{id:"daily-2026-10-21",kind:"daily",reason:"Independent action snapshot",now:at});
    const ranked=await rankedDiscovery(db,[input.candidate],at,"score","all");expect(ranked.rows[0]!.rank).toBe(1);expect(ranked.rows[0]!.discovery_rank).toBe(1);await candidateScorecard(db,input.candidate.address,"live",at);
    expect(assess(input.candidate,DEFAULT_POLICY,at)).toEqual(before);expect(await electionRecord(db,election.id)).toEqual(election);expect(await db.prepare("SELECT count(*) n FROM tenx_usage").first()).toEqual({n:0});
  });
  it("reports bounded history explicitly and refuses an oversized inventory rather than silently ranking its first 500",async()=>{
    const {db}=dbFixture(),input=await ideal();await put(db,input.candidate);
    for(let i=0;i<65;i++){const fetched_at=new Date(at.getTime()-i*60000).toISOString();await db.prepare("INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(input.candidate.address,fetched_at,JSON.stringify({...input.candidate.market!,fetched_at})).run();}
    const record=(await candidateScorecard(db,input.candidate.address,"live",at))!;expect(record.inputs.prices).toHaveLength(64);expect(record.inputs.history_limited).toBe(true);expect(record.result.criteria.find(c=>c.id==="sampled_performance")!.points).toBe(0);
    await db.prepare("DELETE FROM tenx_candidates").run();for(let i=1;i<=501;i++){const bytes=new Uint8Array(32);new DataView(bytes.buffer).setUint32(0,i);const {toBase58}=await import("./solana");await put(db,{...input.candidate,address:toBase58(bytes)});}
    await expect(scoreInventoryCandidates(db,"live",false)).rejects.toThrow("discovery_score_inventory_limit");
  });
});
