import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key } from "./wallet-fixtures.test-helper";
import { attentionDescriptor, AttentionRequest, normalizeAttention } from "./attention-feed-contract";
import { attentionReviewRequest, buildAttentionQueue, collectAttention, readAttentionQueue, reviewAttention } from "./attention-queue";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { runShortlistQuery } from "./shortlist-query";
import worker from "./worker";

const at=new Date("2026-10-22T14:00:00.000Z"), mint=key(10), evm="0xAbCd000000000000000000000000000000001234", opened:DatabaseSync[]=[];
const request={kind:"gmgn_hot_searches",chains:["solana","base","bsc","robinhood"],intervals:["24h","1h"],limit:20};
const data=(address=mint,chain="sol",interval="24h")=>({chain,interval,tokens:[{address,chain,symbol:"SAME",name:"Same name",rank:1,visiting_count:300,liquidity:40000,market_cap:200000,volume:100000,renounced_mint:1,renounced_freeze_account:1,is_wash_trading:false,open_timestamp:at.getTime()/1000-864000}]});
const body={code:0,data:[data(),data(evm,"base"),data(evm,"bsc"),data(evm,"robinhood")]};
const snapshot=()=>normalizeAttention(request,body,at.toISOString());
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));return{sqlite,db:sqliteD1(sqlite)};}
it("builds one bounded POST across chains/windows with chain-specific filters and no age ceiling",()=>{
 const descriptor=attentionDescriptor(request),parsed=JSON.parse(descriptor.body!);expect(descriptor.method).toBe("POST");expect(parsed.params).toHaveLength(8);
 expect(parsed.params.find((p:{chain:string})=>p.chain==="sol").filters).toEqual(["renounced","frozen"]);
 expect(parsed.params.find((p:{chain:string})=>p.chain==="base").filters).toEqual(["not_honeypot","verified","renounced"]);expect(JSON.stringify(parsed)).not.toContain("max_created");
 for(const bad of[{...request,chains:["solana","solana"]},{...request,chains:["unsupported"]},{...request,limit:500},{...request,url:"https://evil.test"},{kind:"attention_dex_crosscheck",chain:"base",addresses:[mint]},{kind:"attention_dex_crosscheck",chain:"base",addresses:[evm,evm.toLowerCase()]}])expect(()=>AttentionRequest.parse(bad)).toThrow();
});
it("keeps same names and equal EVM addresses on different chains distinct, preserving unknown safety",()=>{
 const result=snapshot();expect(result.rows).toHaveLength(4);expect(result.rows[1]).toMatchObject({chain:"base",address:evm.toLowerCase(),honeypot:null,mint_disabled:null,search_interest:300});
 expect(buildAttentionQueue([result],at).rows).toHaveLength(4);expect(result.rows[0]?.reported_open_seconds).toBe(at.getTime()/1000-864000);
});
it("validates nested business envelopes, requested scope, duplicates, bounds, identities and future times",()=>{
 expect(normalizeAttention(request,{code:0,data:body},at.toISOString()).rows).toHaveLength(4);
 for(const raw of[{code:403,data:[]},{code:0,data:{code:403,data:[]}},{code:0,data:[data(mint,"eth")]},{code:0,data:[data(),data()]},{code:0,data:[{...data(),tokens:Array(21).fill(data().tokens[0])}]}])expect(()=>normalizeAttention(request,raw,at.toISOString())).toThrow();
 const rejected=normalizeAttention(request,{code:0,data:[{...data(),tokens:[{address:"invalid"},{address:mint,open_timestamp:at.getTime()/1000+1},{address:mint,chain:"base"}]}]},at.toISOString());expect(rejected.rows).toEqual([]);expect(rejected.rejected).toHaveLength(3);
});
it("binds global Gecko token identity to network, keeps FDV separate and does not call unsupported chains clean",()=>{
 const raw={data:[{id:`base_${evm}`,attributes:{address:evm,fdv_usd:"100000",reserve_in_usd:"30000"},relationships:{network:{data:{id:"base"}},base_token:{data:{id:`base_${evm}`}}}},{relationships:{network:{data:{id:"unsupported"}}}}],included:[{id:`base_${evm}`,attributes:{name:"Old token",image_url:"https://localhost/private"}}]};
 const result=normalizeAttention({kind:"geckoterminal_global_trending"},raw,at.toISOString());expect(result.rows[0]).toMatchObject({chain:"base",address:evm.toLowerCase(),market_cap_usd:null,fdv_usd:100000,image_url:null,wash_flag:null});expect(result.rejected[0]?.reason).toBe("unsupported_chain");
 raw.data[0]!.relationships!.base_token={data:{id:`bsc_${evm}`}};expect(normalizeAttention({kind:"geckoterminal_global_trending"},raw,at.toISOString()).rows).toHaveLength(0);
});
it("counts provider families once, consolidates pools, and excludes only exact completed-launch identities",()=>{
 const first=snapshot(),second=normalizeAttention(request,{code:0,data:[data(mint,"sol","1h")]},at.toISOString());
 const gecko={...first,provider:"geckoterminal" as const,rows:[first.rows[0]!,first.rows[0]!]},result=buildAttentionQueue([first,second,gecko],at,[{chain:"base",address:evm}]);
 expect(result.rows.find(r=>r.chain==="solana")).toMatchObject({attention_families:2,observed_hours:1,checks:"review",volume_1h_usd:100000,recent_volume_source:"gmgn"});expect(result.excluded_launched).toBe(1);expect(result.rows.filter(r=>r.address===evm.toLowerCase())).toHaveLength(2);
 expect(()=>buildAttentionQueue([first],at,[{chain:"base",address:mint}])).toThrow();
});
it("stale or future observations cannot create fresh corroboration; persistence uses distinct sampled hours",()=>{
 const first=snapshot(),older={...first,received_at:new Date(at.getTime()-10800000).toISOString()},future={...first,received_at:new Date(at.getTime()+1).toISOString()};
 const stale=buildAttentionQueue([older,future],at).rows[0]!;expect(stale.attention_families).toBe(0);expect(stale.reasons).toContain("attention_observations_stale");
 const compared=buildAttentionQueue([first,older],at).rows[0]!;expect(compared.observed_hours).toBe(2);expect(compared.sources[0]?.previous_rank).toBe(1);
});
it("keeps adverse flags explicit and concentrated winners in review without calling them safe",()=>{
 const first=snapshot();first.rows[0]!.wash_flag=true;first.rows[1]!.top10_ratio=.8;
 const result=buildAttentionQueue([first],at);expect(result.rows.find(r=>r.chain==="solana")?.checks).toBe("adverse");expect(result.rows.find(r=>r.chain==="base")?.reasons).toContain("concentration_requires_review");expect(result.launch_enabled).toBe(false);
});
it("charges a read-only POST once per hour, replays receipts on cache reads and does not write candidates or scores",async()=>{
 const{db,sqlite}=setup(),fetcher=vi.fn(async(_url:string,init:RequestInit)=>{expect(init.method).toBe("POST");expect(JSON.parse(String(init.body)).params).toHaveLength(8);return Response.json(body);}),settings={db,apiKey:"synthetic-attention-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 const collect={source:"gmgn",reason:"Explicit hourly comparison"};expect(await collectAttention(settings,collect,fetcher,()=>at)).toMatchObject({state:"retained",provider_requests:1});
 expect(await collectAttention(settings,collect,fetcher,()=>new Date(at.getTime()+60000))).toMatchObject({state:"held",provider_requests:0});
 const saved=await readAttentionQueue(db,new Date(at.getTime()+60000));expect(saved.rows).toHaveLength(4);expect(saved.provider_requests).toBe(0);expect(saved.launch_history_connected).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:1});for(const table of["tenx_candidates","tenx_proofs","tenx_score_cohorts"])expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
 sqlite.exec("UPDATE tenx_source_reservations SET receipt_hash='tampered'");expect((await readAttentionQueue(db,at)).gaps).toContain("receipt_replay_or_schema_failed");
});
it("preserves pause, failed-request charges, upstream reset backoff and unauthenticated rejection",async()=>{
 const{db,sqlite}=setup(),settings={db,apiKey:"synthetic-attention-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600},fetcher=vi.fn(async()=>Response.json({reset_at:at.getTime()/1000+300},{status:429}));
 sqlite.exec("UPDATE tenx_control SET paused=1");expect(await collectAttention(settings,{source:"gmgn",reason:"Explicit comparison"},fetcher,()=>at)).toMatchObject({provider_requests:0});sqlite.exec("UPDATE tenx_control SET paused=0");
 expect(await collectAttention(settings,{source:"gmgn",reason:"Explicit comparison"},fetcher,()=>at)).toMatchObject({state:"failed",provider_requests:1});expect(sqlite.prepare("SELECT backoff_until FROM tenx_source_transport_control").get()).toEqual({backoff_until:"2026-10-22T14:05:00.000Z"});
 const response=await worker.fetch(new Request("http://localhost/api/10x/admin/discovery/attention/collect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({source:"gmgn",reason:"Unauthorized"})}),{TENX_LOCAL_ONLY:"true",TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64)} as Parameters<typeof worker.fetch>[1]);expect(response.status).toBe(401);
});
it("cross-checks only requested chain/contract and preserves the most liquid returned pool",async()=>{
 const{db}=setup(),input={request_id:crypto.randomUUID(),reason:"Explicit market crosscheck",request:{kind:"attention_dex_crosscheck",chain:"base",addresses:[evm]}};
 const response=[{chainId:"base",baseToken:{address:evm},liquidity:{usd:5000},pairAddress:"0x0000000000000000000000000000000000000011"},{chainId:"base",baseToken:{address:evm},liquidity:{usd:50000},pairAddress:"0x0000000000000000000000000000000000000012"},{chainId:"bsc",baseToken:{address:evm}}];
 const result=await runShortlistQuery({db,marketDailyLimit:600},input,async()=>Response.json(response),()=>at);expect(result).toMatchObject({state:"retained"});
 const queue=await readAttentionQueue(db,at);expect(queue.rows).toHaveLength(0);
 const market=normalizeAttention(input.request,response,at.toISOString()),report=buildAttentionQueue([snapshot(),market],at);expect(report.rows.find(r=>r.chain==="base")).toMatchObject({market_crosschecked:true,liquidity_usd:50000});expect(market.rejected).toHaveLength(1);
});
it("batches at most twenty fresh non-adverse tokens from one chain without hiding later rows",()=>{
 const first=snapshot();first.rows=Array.from({length:30},(_,n)=>({...first.rows[0]!,address:key(30+n),provider_rank:n+1,search_interest:100-n}));
 const queue=buildAttentionQueue([first],at),plan=attentionReviewRequest(queue);
 expect(plan).toMatchObject({kind:"attention_dex_crosscheck",chain:"solana"});expect(plan?.kind==="attention_dex_crosscheck"&&plan.addresses).toHaveLength(20);
 queue.rows.slice(0,20).forEach(r=>r.market_crosschecked=true);const remainder=attentionReviewRequest(queue);expect(remainder?.kind==="attention_dex_crosscheck"&&remainder.addresses).toHaveLength(10);
 queue.rows.forEach(r=>r.market_crosschecked=true);expect(attentionReviewRequest(queue)).toBeNull();
 expect(attentionReviewRequest(buildAttentionQueue([{...first,received_at:new Date(at.getTime()-7200001).toISOString()}],at))).toBeNull();
 first.rows.forEach(r=>r.wash_flag=true);expect(attentionReviewRequest(buildAttentionQueue([first],at))).toBeNull();
});
it("runs one charged focused batch per hour, including empty results, without granting evidence or launch readiness",async()=>{
 const{db,sqlite}=setup(),settings={db,apiKey:"synthetic-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 await collectAttention(settings,{source:"gmgn",reason:"Synthetic source sample"},async()=>Response.json(body),()=>new Date(at.getTime()-60000));
 const fetcher=vi.fn(async(url:string)=>{expect(url).toContain("https://api.dexscreener.com/tokens/v1/base/");return Response.json([]);});
 expect(await reviewAttention(settings,{reason:"Focused market follow-up"},fetcher,()=>at)).toMatchObject({state:"retained",provider_requests:1});
 expect(await reviewAttention(settings,{reason:"Duplicate timer"},fetcher,()=>at)).toMatchObject({state:"held",reason:"review_hour_already_reserved",provider_requests:0});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:2});
 const queue=await readAttentionQueue(db,at);expect(queue.launch_enabled).toBe(false);expect(queue.rows.every(r=>!r.market_crosschecked)).toBe(true);
 for(const table of["tenx_candidates","tenx_proofs","tenx_score_cohorts"])expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
});
it("holds focused follow-up under shared pause/backoff and tampered source history",async()=>{
 const{db,sqlite}=setup(),settings={db,apiKey:"synthetic-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600},fetcher=vi.fn(async()=>Response.json([]));
 await collectAttention(settings,{source:"gmgn",reason:"Synthetic source sample"},async()=>Response.json(body),()=>new Date(at.getTime()-60000));
 sqlite.exec("UPDATE tenx_control SET paused=1");expect(await reviewAttention(settings,{reason:"Paused follow-up"},fetcher,()=>at)).toMatchObject({provider_requests:0});
 sqlite.exec("UPDATE tenx_control SET paused=0; UPDATE tenx_source_transport_control SET backoff_until='2026-10-22T15:00:00.000Z'");expect(await reviewAttention(settings,{reason:"Backoff follow-up"},fetcher,()=>at)).toMatchObject({provider_requests:0});
 sqlite.exec("UPDATE tenx_source_reservations SET receipt_hash='tampered'");expect(await reviewAttention(settings,{reason:"Invalid history follow-up"},fetcher,()=>at)).toMatchObject({reason:"no_fresh_shortlist_needing_crosscheck",provider_requests:0});expect(fetcher).not.toHaveBeenCalled();
 const response=await worker.fetch(new Request("http://localhost/api/10x/admin/discovery/attention/review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:"Unauthorized"})}),{TENX_LOCAL_ONLY:"true",TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64)} as Parameters<typeof worker.fetch>[1]);expect(response.status).toBe(401);
});
it("retains attention history under a flood of market receipts, and discloses the unchanged replay bound",async()=>{
 const{db,sqlite}=setup(),settings={db,apiKey:"synthetic-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 await collectAttention(settings,{source:"gmgn",reason:"Synthetic source sample"},async()=>Response.json(body),()=>new Date(at.getTime()-60000));
 await runShortlistQuery(settings,{request_id:crypto.randomUUID(),reason:"Synthetic market sample",request:{kind:"attention_dex_crosscheck",chain:"base",addresses:[evm]}},async()=>Response.json([]),()=>new Date(at.getTime()-30000));
 const seed=sqlite.prepare("SELECT * FROM tenx_source_reservations WHERE json_extract(request,'$.kind')='attention_dex_crosscheck'").get()!;
 for(let n=0;n<50;n++)sqlite.prepare(`INSERT INTO tenx_source_reservations (${Object.keys(seed).join(",")}) VALUES (${Object.keys(seed).map(()=>"?").join(",")})`).run(...Object.values({...seed,id:`duplicate-market-${n}`,owner:`duplicate-owner-${n}`,reserved_at:new Date(at.getTime()-n).toISOString()}) as (string|number|null)[]);
 const read=vi.spyOn(db,"prepare"),queue=await readAttentionQueue(db,at);expect(queue.rows).toHaveLength(4);expect(queue.history_truncated).toBe(true);expect(queue.snapshot_count).toBe(9);expect(read).toHaveBeenCalledTimes(10);
 read.mockClear();const focused=await readAttentionQueue(db,at,"review");expect(focused.history_truncated).toBe(true);expect(focused.snapshot_count).toBe(5);expect(read).toHaveBeenCalledTimes(6);
});
it("flags fresh two-fold source differences, keeps trading provenance consistent, and leaves stale differences unasserted",()=>{
 const first=snapshot(),market=normalizeAttention({kind:"attention_dex_crosscheck",chain:"solana",addresses:[mint]},[{chainId:"solana",baseToken:{address:mint},marketCap:800000,liquidity:{usd:10000},txns:{h24:{buys:50,sells:40}}}],at.toISOString());
 const row=buildAttentionQueue([first,market],at).rows.find(r=>r.chain==="solana")!;
 expect(row).toMatchObject({market_source:"dexscreener",buys:50,sells:40,checks:"review"});expect(row.reasons).toContain("market_cap_usd_source_disagreement");expect(row.reasons).toContain("liquidity_usd_source_disagreement");expect(row.reasons).not.toContain("two_sided_trading_unresolved");
 market.received_at=new Date(at.getTime()-7200001).toISOString();expect(buildAttentionQueue([first,market],at).rows.find(r=>r.chain==="solana")!.reasons).not.toContain("market_cap_usd_source_disagreement");
});
it("does not let a different GMGN window conceal explicit adverse flags or fresh security coverage",()=>{
 const old=snapshot(),fresh=normalizeAttention(request,{code:0,data:[data(mint,"sol","1h")]},at.toISOString());old.received_at=new Date(at.getTime()-7200001).toISOString();
 const row=buildAttentionQueue([old,fresh],at).rows.find(r=>r.chain==="solana")!;expect(row.reasons).not.toContain("security_observation_missing_or_stale");
 old.rows[0]!.wash_flag=true;expect(buildAttentionQueue([old,fresh],at).rows.find(r=>r.chain==="solana")?.checks).toBe("adverse");
});
it("keeps a failed review spent for its hour and honors the existing shared market ceiling",async()=>{
 const{db,sqlite}=setup(),settings={db,apiKey:"synthetic-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 await collectAttention(settings,{source:"gmgn",reason:"Synthetic source sample"},async()=>Response.json(body),()=>new Date(at.getTime()-60000));
 const fetcher=vi.fn(async()=>Response.json({error:"limited"},{status:429}));
 expect(await reviewAttention({...settings,marketDailyLimit:1},{reason:"Exhausted market budget"},fetcher,()=>at)).toMatchObject({provider_requests:0});expect(fetcher).not.toHaveBeenCalled();
 expect(await reviewAttention(settings,{reason:"Rate-limited market review"},fetcher,()=>at)).toMatchObject({state:"failed",provider_requests:1});
 expect(await reviewAttention(settings,{reason:"Repeated failed hourly review"},fetcher,()=>at)).toMatchObject({reason:"review_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:2});
});
