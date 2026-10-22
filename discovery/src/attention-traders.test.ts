import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key } from "./wallet-fixtures.test-helper";
import { normalizeAttentionTraders } from "./attention-traders";
import { attentionTradersFresh } from "./attention-trader-model";
import { attentionTraderRequest,buildAttentionQueue,collectAttention,collectAttentionTraders,collectAttentionCandles,readAttentionQueue,reviewAttention } from "./attention-queue";
import { normalizeAttention } from "./attention-feed-contract";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import worker from "./worker";

const at=new Date("2026-10-22T14:00:00.000Z"),address=key(20),id="attention-traders-2026102214",opened:DatabaseSync[]=[];
const request={kind:"gmgn_token_traders",address};
const traders={code:0,data:{list:[{address:key(21),addr_type:0,buy_volume_cur:200,sell_volume_cur:100,buy_tx_count_cur:2,sell_tx_count_cur:1},
 {address:key(22),addr_type:0,buy_volume_cur:100},{address:key(23),addr_type:2,buy_volume_cur:10000,sell_volume_cur:10000},{address:key(24),buy_volume_cur:200,sell_volume_cur:200}]}};
const body={code:0,data:[{chain:"sol",interval:"24h",tokens:[{address,rank:1,visiting_count:100,is_wash_trading:false,renounced_mint:1,renounced_freeze_account:1}]}]};
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
async function setup(extra:string[]=[]){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));
 const db=sqliteD1(sqlite),settings={db,apiKey:"synthetic-trader-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 const feed=structuredClone(body);feed.data[0]!.tokens.push(...extra.map((mint,i)=>({...body.data[0]!.tokens[0]!,address:mint,rank:i+2,visiting_count:50-i})));
 await collectAttention(settings,{source:"gmgn",reason:"Synthetic attention sample"},async()=>Response.json(feed),()=>new Date(at.getTime()-60000));
 await reviewAttention(settings,{reason:"Synthetic market sample"},async()=>Response.json([address,...extra].map(mint=>({chainId:"solana",baseToken:{address:mint},liquidity:{usd:30000}}))),()=>new Date(at.getTime()-30000));return{sqlite,db,settings};}

it("keeps ranked selection, missing fields, address types, period and identity limitations explicit",()=>{
 const review=normalizeAttentionTraders(id,request,traders,at.toISOString());
 expect(review).toMatchObject({chain:"solana",address,response_identity:"request_context_only",sample:{returned_rows:4,regular_wallet_rows:2,excluded_non_wallet_rows:1,unknown_address_type_rows:1,complete_volume_rows:1,missing_volume_rows:1,reported_buy_volume_usd:200,reported_sell_volume_usd:100,largest_wallet_flow_share_pct:100,top_five_wallet_flow_share_pct:100,two_sided_wallet_rows:1,time_scope:"provider_aggregate_period_unknown",population_coverage:"unknown",organic_volume_usd:null,wash_trading_verdict:"not_established",scoring_effect:"none"}});
 expect(attentionTradersFresh(review,at)).toBe(true);expect(attentionTradersFresh(review,new Date(at.getTime()+7200001))).toBe(false);expect(attentionTradersFresh(review,new Date(at.getTime()-1))).toBe(false);
 expect(()=>normalizeAttentionTraders(id,{kind:"gmgn_token_info",address},traders,at.toISOString())).toThrow("scope_mismatch");
 expect(()=>normalizeAttentionTraders(id,request,{code:0,data:{list:[traders.data.list[0],traders.data.list[0]]}},at.toISOString())).toThrow("duplicate");
 expect(()=>normalizeAttentionTraders("unrelated-research",request,traders,at.toISOString())).toThrow();
 const empty=normalizeAttentionTraders(id,request,{code:0,data:{list:[]}},at.toISOString());expect(empty.sample).toMatchObject({returned_rows:0,reported_combined_flow_usd:null,largest_wallet_flow_share_pct:null});
});
it("selects only fresh non-adverse market-checked Solana leads, skipping a fresh saved sample",()=>{
 const queue=buildAttentionQueue([normalizeAttention({kind:"gmgn_hot_searches"},body,at.toISOString())],at);
 expect(attentionTraderRequest(queue,at)).toBeNull();queue.rows[0]!.market_crosschecked=true;expect(attentionTraderRequest(queue,at)).toEqual(request);
 queue.trader_reviews=[normalizeAttentionTraders(id,request,traders,at.toISOString())];expect(attentionTraderRequest(queue,at)).toBeNull();expect(attentionTraderRequest(queue,new Date(at.getTime()+7200001))).toEqual(request);
 queue.rows[0]!.checks="adverse";expect(attentionTraderRequest(queue,at)).toBeNull();queue.rows[0]!.checks="review";queue.rows[0]!.attention_families=0;expect(attentionTraderRequest(queue,at)).toBeNull();
});
it("rotates unattempted leaders before repeats, then uses oldest attempt with stable rank ties",()=>{
 const queue=buildAttentionQueue([normalizeAttention({kind:"gmgn_hot_searches"},body,at.toISOString())],at),second=key(30),third=key(31);queue.rows[0]!.market_crosschecked=true;queue.rows.push({...queue.rows[0]!,address:second},{...queue.rows[0]!,address:third});
 const attempts=[{address,last_attempt:"2026-10-22T12:00:00.000Z"},{address:second,last_attempt:"2026-10-22T13:00:00.000Z"}];expect(attentionTraderRequest(queue,at,attempts)?.address).toBe(third);
 attempts.push({address:third,last_attempt:"2026-10-22T11:00:00.000Z"});expect(attentionTraderRequest(queue,at,attempts)?.address).toBe(third);
 attempts[2]!.last_attempt=attempts[0]!.last_attempt;expect(attentionTraderRequest(queue,at,attempts)?.address).toBe(address);
});
it("reserves one fixed trader request per hour and cache reads do not add votes, IO, proofs or scores",async()=>{
 const{db,sqlite,settings}=await setup(),before=await readAttentionQueue(db,at),fetcher=vi.fn(async(url:string,init:RequestInit)=>{const target=new URL(url);expect(target.pathname).toBe("/v1/market/token_top_traders");expect(target.searchParams.get("chain")).toBe("sol");expect(target.searchParams.get("address")).toBe(address);expect(target.searchParams.get("limit")).toBe("100");expect(target.searchParams.get("orderby")).toBeNull();expect(target.searchParams.get("order_by")).toBe("buy_volume_cur");expect(target.searchParams.get("direction")).toBe("desc");expect(init.method).toBe("GET");return Response.json(traders);});
 expect(await collectAttentionTraders(settings,{reason:"Focused participation sample"},fetcher,()=>at)).toMatchObject({state:"retained",provider_requests:1,review:{sample:{returned_rows:4}}});
 expect(await collectAttentionTraders(settings,{reason:"Repeated sample"},fetcher,()=>at)).toMatchObject({reason:"traders_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 const queue=await readAttentionQueue(db,at);expect(queue.rows).toEqual(before.rows);expect(queue.snapshot_count).toBe(before.snapshot_count);expect(queue.trader_reviews).toHaveLength(1);expect(queue).toMatchObject({launch_enabled:false,scoring_effect:"none",provider_requests:0,database_writes:0});
 expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:3});for(const table of["tenx_candidates","tenx_proofs","tenx_score_cohorts"])expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
 sqlite.prepare("UPDATE tenx_source_reservations SET receipt_hash='tampered' WHERE id=?").run(id);expect((await readAttentionQueue(db,at)).trader_reviews).toEqual([]);
});
it("preserves key/authority, pause, budget, authentication and failed-hour backoff gates",async()=>{
 const{db,sqlite,settings}=await setup(),fetcher=vi.fn(async()=>Response.json({reset_at:at.getTime()/1000+300},{status:429}));
 for(const override of[{apiKey:undefined},{permissionReference:"unapproved"}])expect(await collectAttentionTraders({...settings,...override},{reason:"Configuration hold"},fetcher,()=>at)).toMatchObject({reason:"gmgn_configuration_required",provider_requests:0});
 sqlite.exec("UPDATE tenx_control SET paused=1");expect(await collectAttentionTraders(settings,{reason:"Paused sample"},fetcher,()=>at)).toMatchObject({provider_requests:0});sqlite.exec("UPDATE tenx_control SET paused=0");
 expect(await collectAttentionTraders({...settings,marketDailyLimit:2},{reason:"Exhausted budget"},fetcher,()=>at)).toMatchObject({provider_requests:0});expect(fetcher).not.toHaveBeenCalled();
 expect(await collectAttentionTraders(settings,{reason:"Failed sample"},fetcher,()=>at)).toMatchObject({state:"failed",provider_requests:1,review:null});expect(await collectAttentionTraders(settings,{reason:"Repeated failed sample"},fetcher,()=>at)).toMatchObject({reason:"traders_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 expect(sqlite.prepare("SELECT backoff_until FROM tenx_source_transport_control").get()).toEqual({backoff_until:"2026-10-22T14:05:00.000Z"});
 const response=await worker.fetch(new Request("http://localhost/api/10x/admin/discovery/attention/traders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:"Unauthorized"})}),{TENX_LOCAL_ONLY:"true",TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64)} as Parameters<typeof worker.fetch>[1]);expect(response.status).toBe(401);
});
it("charges empty and invalid responses without retry or passing missing participation",async()=>{
 for(const response of[{code:0,data:{list:[]}},{code:0,data:{list:[traders.data.list[0],traders.data.list[0]]}}]){
  const{settings}=await setup(),fetcher=vi.fn(async()=>Response.json(response));const result=await collectAttentionTraders(settings,{reason:"Empty or invalid sample"},fetcher,()=>at);
  expect(result.provider_requests).toBe(1);expect(await collectAttentionTraders(settings,{reason:"Repeat empty or invalid sample"},fetcher,()=>at)).toMatchObject({reason:"traders_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 }
});
it("uses spent failed attempts to inspect a different leader next hour",async()=>{
 const second=key(30),{settings}=await setup([second]);
 expect(await collectAttentionTraders(settings,{reason:"Failed leading token"},async()=>Response.json({reset_at:at.getTime()/1000+300},{status:429}),()=>at)).toMatchObject({state:"failed",provider_requests:1});
 const fetcher=vi.fn(async(url:string)=>{expect(new URL(url).searchParams.get("address")).toBe(second);return Response.json(traders);});
 expect(await collectAttentionTraders(settings,{reason:"Next hourly first inspection"},fetcher,()=>new Date(at.getTime()+3600000))).toMatchObject({state:"retained",provider_requests:1,review:{address:second}});expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds trader replay independently and excludes unrelated research reservations",async()=>{
 const{db,sqlite,settings}=await setup();await collectAttentionTraders(settings,{reason:"Synthetic replay cap"},async()=>Response.json(traders),()=>at);
 const seed=sqlite.prepare("SELECT * FROM tenx_source_reservations WHERE id=?").get(id)!;
 for(let n=0;n<10;n++)sqlite.prepare(`INSERT INTO tenx_source_reservations (${Object.keys(seed).join(",")}) VALUES (${Object.keys(seed).map(()=>"?").join(",")})`).run(...Object.values({...seed,id:n===9?"other-trader-research":`attention-traders-20261022${String(n).padStart(2,"0")}`,owner:`synthetic-trader-owner-${n}`,reserved_at:new Date(at.getTime()-n).toISOString()}) as (string|number|null)[]);
 const reader=vi.spyOn(db,"prepare"),queue=await readAttentionQueue(db,at);expect(queue.trader_reviews).toHaveLength(6);expect(queue.snapshot_count).toBe(2);expect(queue.history_truncated).toBe(true);expect(reader).toHaveBeenCalledTimes(9);
 reader.mockClear();const focused=await readAttentionQueue(db,at,"review");expect(focused.trader_reviews).toHaveLength(3);expect(focused.history_truncated).toBe(true);expect(reader).toHaveBeenCalledTimes(6);
});
it("retains all four evidence buckets within the existing 48-receipt and collecting-turn read bounds",async()=>{
 const{db,sqlite,settings}=await setup();await collectAttentionTraders(settings,{reason:"Synthetic saturated trader replay"},async()=>Response.json(traders),()=>at);
 const later=new Date(at.getTime()+20000);await collectAttentionCandles(settings,{reason:"Synthetic saturated candle replay"},async()=>Response.json({code:0,data:[]}),()=>later);
 for(const[prefix,count]of[["attention-gmgn",28],["attention-review",8],["attention-candles",6],["attention-traders",6]] as const){
  const seed=sqlite.prepare("SELECT * FROM tenx_source_reservations WHERE id LIKE ? LIMIT 1").get(`${prefix}-%`)!;
  for(let n=0;n<count;n++)sqlite.prepare(`INSERT INTO tenx_source_reservations (${Object.keys(seed).join(",")}) VALUES (${Object.keys(seed).map(()=>"?").join(",")})`).run(...Object.values({...seed,id:`${prefix}-20261021${String(n).padStart(2,"0")}`,owner:`synthetic-${prefix}-${n}`,reserved_at:new Date(later.getTime()-n-1).toISOString()}) as (string|number|null)[]);
 }
 const reader=vi.spyOn(db,"prepare"),queue=await readAttentionQueue(db,later);expect(reader).toHaveBeenCalledTimes(45);expect(queue.snapshot_count).toBe(32);expect(queue.candle_reviews).toHaveLength(6);expect(queue.trader_reviews).toHaveLength(6);expect(queue.history_truncated).toBe(true);
 reader.mockClear();const focused=await readAttentionQueue(db,later,"review");expect(reader).toHaveBeenCalledTimes(19);expect(focused.snapshot_count).toBe(12);expect(focused.candle_reviews).toHaveLength(3);expect(focused.trader_reviews).toHaveLength(3);
});
