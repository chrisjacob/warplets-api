import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key } from "./wallet-fixtures.test-helper";
import { normalizeAttentionCandles } from "./attention-candles";
import { attentionCandlesFresh } from "./attention-candle-model";
import { attentionCandleRequest, buildAttentionQueue, collectAttention, collectAttentionCandles, readAttentionQueue, reviewAttention } from "./attention-queue";
import { normalizeAttention } from "./attention-feed-contract";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import worker from "./worker";

const at=new Date("2026-10-22T14:00:00.000Z"),address=key(20),id="attention-candles-2026102214",opened:DatabaseSync[]=[];
const request={kind:"gmgn_token_candles",address,start_at:"2026-10-22T13:00:00.000Z",end_at:at.toISOString()};
const rows=()=>Array.from({length:60},(_,i)=>({time:Date.parse(request.start_at)+i*60000,open:.001,high:.0011,low:.0009,close:.001,volume:1,amount:1000}));
const body={code:0,data:[{chain:"sol",interval:"24h",tokens:[{address,rank:1,visiting_count:100,is_wash_trading:false,renounced_mint:1,renounced_freeze_account:1}]}]};
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
async function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));const db=sqliteD1(sqlite),settings={db,apiKey:"synthetic-candle-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 await collectAttention(settings,{source:"gmgn",reason:"Synthetic attention sample"},async()=>Response.json(body),()=>new Date(at.getTime()-60000));
 await reviewAttention(settings,{reason:"Synthetic focused market sample"},async()=>Response.json([{chainId:"solana",baseToken:{address},liquidity:{usd:30000}}]),()=>new Date(at.getTime()-30000));return{sqlite,db,settings};}

it("reuses v2 closed-minute validation and field-labelled unit corroboration without organic or mint certification",()=>{
 const review=normalizeAttentionCandles(id,request,{code:0,data:{list:rows()}},at.toISOString());
 expect(review).toMatchObject({candle_count:60,complete_window:true,expected_count:60,response_identity:"request_context_only",organic_volume_verified:false,units:{state:"price_consistent",usd_field:"volume",independent_trade_verification:false}});
 expect(attentionCandlesFresh(review,at)).toBe(true);expect(attentionCandlesFresh(review,new Date(at.getTime()+7200001))).toBe(false);expect(attentionCandlesFresh(review,new Date(at.getTime()-1))).toBe(false);
 const oldWindow={...review,window_end:new Date(at.getTime()-7200001).toISOString()};expect(attentionCandlesFresh(oldWindow,at)).toBe(false);
 expect(()=>normalizeAttentionCandles(id,{...request,start_at:"2026-10-22T12:00:00.000Z"},{code:0,data:[]},at.toISOString())).toThrow("scope_mismatch");
 expect(()=>normalizeAttentionCandles(id,request,{code:0,data:[...rows(),rows()[0]]},at.toISOString())).toThrow();
});
it("keeps sparse and empty windows incomplete, absent amount unknown, and pattern warnings descriptive",()=>{
 const sparse=rows().filter((_,i)=>i!==30).map(r=>({...r,amount:undefined}));
 expect(normalizeAttentionCandles(id,request,{code:0,data:sparse},at.toISOString())).toMatchObject({candle_count:59,complete_window:false,units:{state:"unknown"},activity:{adjacent_pairs:57,zero_reported_flow_moving_candles:0}});
 expect(normalizeAttentionCandles(id,request,{code:0,data:[]},at.toISOString())).toMatchObject({candle_count:0,complete_window:false});
 const rise=rows().map((r,i)=>({...r,open:100+i,high:102+i,low:99+i,close:101+i,volume:0,amount:0}));
 const reviewed=normalizeAttentionCandles(id,request,{code:0,data:rise},at.toISOString());expect(reviewed.activity.review_reasons).toContain("price_moves_with_both_flow_fields_zero");expect(reviewed.activity.review_reasons).toContain("twelve_or_more_consecutive_rising_closes");expect(reviewed.activity.wash_trading_verdict).toBe("not_established");
});
it("selects only a fresh, market-checked Solana lead from the leading twenty and never widens request scope",()=>{
 const queue=buildAttentionQueue([normalizeAttention({kind:"gmgn_hot_searches"},body,at.toISOString())],at);
 expect(attentionCandleRequest(queue,at)).toBeNull();queue.rows[0]!.market_crosschecked=true;
 expect(attentionCandleRequest(queue,new Date(at.getTime()+45123))).toEqual(request);
 queue.rows[0]!.checks="adverse";expect(attentionCandleRequest(queue,at)).toBeNull();queue.rows[0]!.checks="review";queue.rows[0]!.attention_families=0;expect(attentionCandleRequest(queue,at)).toBeNull();
});
it("prefers unattempted leaders over repeat inspections and uses the oldest attempt when all were seen",()=>{
 const queue=buildAttentionQueue([normalizeAttention({kind:"gmgn_hot_searches"},body,at.toISOString())],at),second=key(21),third=key(22);
 queue.rows[0]!.market_crosschecked=true;queue.rows.push({...queue.rows[0]!,address:second},{...queue.rows[0]!,address:third});
 const attempts=[{address,last_attempt:"2026-10-22T12:00:00.000Z"},{address:second,last_attempt:"2026-10-22T13:00:00.000Z"}];
 expect(attentionCandleRequest(queue,at,attempts)?.address).toBe(third);
 attempts.push({address:third,last_attempt:"2026-10-22T11:00:00.000Z"});expect(attentionCandleRequest(queue,at,attempts)?.address).toBe(third);
});
it("charges one candle call per hour, replays it on cache reads and leaves proofs, candidates and scores untouched",async()=>{
 const{db,sqlite,settings}=await setup(),fetcher=vi.fn(async(url:string,init:RequestInit)=>{const target=new URL(url);expect(target.pathname).toBe("/v1/market/token_kline");expect(target.searchParams.get("chain")).toBe("sol");expect(target.searchParams.get("address")).toBe(address);expect(target.searchParams.get("from")).toBe(String(Date.parse(request.start_at)));expect(target.searchParams.get("to")).toBe(String(at.getTime()-1));expect(init.method).toBe("GET");return Response.json({code:0,data:{list:rows()}});});
 expect(await collectAttentionCandles(settings,{reason:"Focused candle sample"},fetcher,()=>at)).toMatchObject({state:"retained",provider_requests:1,review:{complete_window:true}});
 expect(await collectAttentionCandles(settings,{reason:"Repeated hourly sample"},fetcher,()=>at)).toMatchObject({reason:"candles_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 const queue=await readAttentionQueue(db,at);expect(queue.candle_reviews).toHaveLength(1);expect(queue.rows[0]!.attention_families).toBe(1);expect(queue.snapshot_count).toBe(2);expect(queue.launch_enabled).toBe(false);expect(queue.scoring_effect).toBe("none");expect(attentionCandleRequest(queue,at)).toBeNull();
 expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:3});for(const table of["tenx_candidates","tenx_proofs","tenx_score_cohorts"])expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
 sqlite.prepare("UPDATE tenx_source_reservations SET receipt_hash='tampered' WHERE id=?").run(id);const tampered=await readAttentionQueue(db,at);expect(tampered.candle_reviews).toEqual([]);expect(tampered.gaps).toContain("receipt_replay_or_schema_failed");
});
it("preserves configuration, authentication, pause, budget and failed-hour backoff controls",async()=>{
 const{db,sqlite,settings}=await setup(),fetcher=vi.fn(async()=>Response.json({reset_at:at.getTime()/1000+300},{status:429}));
 expect(await collectAttentionCandles({...settings,apiKey:undefined},{reason:"Missing key"},fetcher,()=>at)).toMatchObject({reason:"gmgn_configuration_required",provider_requests:0});
 sqlite.exec("UPDATE tenx_control SET paused=1");expect(await collectAttentionCandles(settings,{reason:"Paused candle sample"},fetcher,()=>at)).toMatchObject({provider_requests:0});sqlite.exec("UPDATE tenx_control SET paused=0");
 expect(await collectAttentionCandles({...settings,marketDailyLimit:2},{reason:"Exhausted shared budget"},fetcher,()=>at)).toMatchObject({provider_requests:0});expect(fetcher).not.toHaveBeenCalled();
 expect(await collectAttentionCandles(settings,{reason:"Failed candle sample"},fetcher,()=>at)).toMatchObject({state:"failed",provider_requests:1,review:null});
 expect(await collectAttentionCandles(settings,{reason:"Repeated failed sample"},fetcher,()=>at)).toMatchObject({reason:"candles_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);expect(sqlite.prepare("SELECT backoff_until FROM tenx_source_transport_control").get()).toEqual({backoff_until:"2026-10-22T14:05:00.000Z"});
 const response=await worker.fetch(new Request("http://localhost/api/10x/admin/discovery/attention/candles",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:"Unauthorized"})}),{TENX_LOCAL_ONLY:"true",TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64)} as Parameters<typeof worker.fetch>[1]);expect(response.status).toBe(401);
});
it("caps candle replay separately while preserving attention and market observations",async()=>{
 const{db,sqlite,settings}=await setup();await collectAttentionCandles(settings,{reason:"Synthetic bounded replay"},async()=>Response.json({code:0,data:rows()}),()=>at);
 const seed=sqlite.prepare("SELECT * FROM tenx_source_reservations WHERE id=?").get(id)!;
 for(let n=0;n<10;n++)sqlite.prepare(`INSERT INTO tenx_source_reservations (${Object.keys(seed).join(",")}) VALUES (${Object.keys(seed).map(()=>"?").join(",")})`).run(...Object.values({...seed,id:`attention-candles-20261022${String(n).padStart(2,"0")}`,owner:`synthetic-candle-owner-${n}`,reserved_at:new Date(at.getTime()-n).toISOString()}) as (string|number|null)[]);
 const reader=vi.spyOn(db,"prepare"),queue=await readAttentionQueue(db,at);expect(queue.candle_reviews).toHaveLength(6);expect(queue.snapshot_count).toBe(2);expect(queue.rows).toHaveLength(1);expect(queue.history_truncated).toBe(true);expect(reader).toHaveBeenCalledTimes(9);
 reader.mockClear();const focused=await readAttentionQueue(db,at,"review");expect(focused.candle_reviews).toHaveLength(3);expect(focused.history_truncated).toBe(true);expect(reader).toHaveBeenCalledTimes(6);
});
