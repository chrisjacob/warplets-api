import { afterEach,expect,it,vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key,signature } from "./wallet-fixtures.test-helper";
import { collectAttention,collectAttentionCandles,collectAttentionTraders,readAttentionQueue,reviewAttention } from "./attention-queue";
import { attentionActivityId,attentionActivitySource,collectAttentionActivity } from "./attention-activity-collection";
import { gmgnActivityTarget,gmgnPublicSummary,gmgnSavedReview,runGmgnReview } from "./gmgn";
import { readSourceReceiptWithRequest } from "./source-collection-transport";
import { normalizeAttentionActivity } from "./attention-activity";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { hashJson } from "./solana";
import worker from "./worker";

const at=new Date("2026-10-22T14:00:00.000Z"),later=new Date(at.getTime()+20000),address=key(20),wallet=key(21),sourceId="attention-traders-2026102214",opened:DatabaseSync[]=[];
const rows=[{address:wallet,addr_type:0,buy_volume_cur:200,sell_volume_cur:100},{address:key(22),addr_type:0,buy_volume_cur:10,sell_volume_cur:10},{address:key(23),addr_type:2,buy_volume_cur:9000,sell_volume_cur:9000}];
const event=(n=1,side="buy")=>({tx_hash:signature(n),token:{address},event_type:side,timestamp:at.getTime()/1000-30,token_amount:10,cost_usd:2});
const events={code:0,data:{activities:[event(),event(1,"sell"),event(2)],next:"opaque"}};
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
async function setup(extra:string[]=[]){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
 const db=sqliteD1(sqlite),settings={db,apiKey:"synthetic-activity-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 await collectAttention(settings,{source:"gmgn",reason:"Synthetic attention list"},async()=>Response.json({code:0,data:[{chain:"sol",interval:"24h",tokens:[address,...extra].map((mint,i)=>({address:mint,rank:i+1,visiting_count:100-i,is_wash_trading:false,renounced_mint:1,renounced_freeze_account:1}))}]}),()=>new Date(at.getTime()-60000));
 await reviewAttention(settings,{reason:"Synthetic market sample"},async()=>Response.json([address,...extra].map(mint=>({chainId:"solana",baseToken:{address:mint},liquidity:{usd:30000}}))),()=>new Date(at.getTime()-30000));
 await collectAttentionTraders(settings,{reason:"Synthetic trader sample"},async()=>Response.json({code:0,data:{list:rows}}),()=>at);return{db,sqlite,settings};}

it("reuses deterministic source selection and keeps hourly IDs stable across concurrent callers",async()=>{
 const{db}=await setup(),queue=await readAttentionQueue(db,later),target=await gmgnActivityTarget(db,sourceId,later);
 expect(attentionActivitySource(queue,later)).toBe(sourceId);expect(target).toMatchObject({state:"ready",request:{address,wallet,selection_id:sourceId}});
 expect(await attentionActivityId(later)).toBe(await attentionActivityId(new Date(later.getTime()+1000)));expect(await attentionActivityId(later)).not.toBe(await attentionActivityId(new Date(later.getTime()+3600000)));
 queue.rows[0]!.checks="adverse";expect(attentionActivitySource(queue,later)).toBeNull();queue.rows[0]!.checks="review";queue.rows[0]!.market_crosschecked=false;expect(attentionActivitySource(queue,later)).toBeNull();
 queue.rows[0]!.market_crosschecked=true;expect(attentionActivitySource(queue,new Date(at.getTime()+7200001))).toBeNull();
});
it("meters one token-filtered twenty-event page per hour and replays source plus events without votes or proof writes",async()=>{
 const{db,sqlite,settings}=await setup(),before=await readAttentionQueue(db,later),fetcher=vi.fn(async(url:string)=>{expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({chain:"sol",wallet_address:wallet,token_address:address,limit:"20"});return Response.json(events);});
 const result=await collectAttentionActivity(settings,{reason:"Focused event review"},fetcher,()=>later);expect(result).toMatchObject({state:"retained",provider_requests:1,review:{response_identity:"token_echo_wallet_request_context",activity:{returned_events:3,buy_events:2,sell_events:1,two_sided_transactions:1,repeated_same_side_token_size_events:2,independent_transaction_verification:false,organic_volume_usd:null,wash_trading_verdict:"not_established"}}});
 expect(await collectAttentionActivity(settings,{reason:"Repeated event review"},fetcher,()=>later)).toMatchObject({reason:"activity_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 const queue=await readAttentionQueue(db,later);expect(queue.activity_reviews).toHaveLength(1);expect(queue.rows).toEqual(before.rows);expect(queue.snapshot_count).toBe(before.snapshot_count);expect(attentionActivitySource(queue,later)).toBeNull();expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:4});
 for(const table of["tenx_candidates","tenx_proofs","tenx_score_cohorts"])expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
 expect(JSON.stringify(queue.activity_reviews)).not.toContain(wallet);expect(JSON.stringify(queue.activity_reviews)).not.toContain(signature(1));
 const id=await attentionActivityId(later),saved=(await readSourceReceiptWithRequest(db,id))!,source=(await readSourceReceiptWithRequest(db,sourceId))!;
 const forged=structuredClone(saved);forged.request.wallet=key(22);forged.receipt.request_hash=await hashJson(forged.request);await expect(normalizeAttentionActivity(id,forged,source)).rejects.toThrow("selection_mismatch");
 sqlite.prepare("UPDATE tenx_source_reservations SET receipt_hash='tampered' WHERE id=?").run(sourceId);const tampered=await readAttentionQueue(db,later);expect(tampered.activity_reviews).toEqual([]);expect(tampered.gaps).toContain("receipt_replay_or_schema_failed");
});
it("preserves old UUID selection behavior and reads hourly trader/candle receipts on token details",async()=>{
 const{db,settings}=await setup();expect(await gmgnSavedReview(db,sourceId)).toMatchObject({observation:{kind:"gmgn_token_traders"}});
 await collectAttentionCandles(settings,{reason:"Synthetic candle compatibility"},async()=>Response.json({code:0,data:[]}),()=>later);
 expect(await gmgnPublicSummary(db,address,later)).toMatchObject({trader_sample:{returned_rows:3},candle_count:0});
 for(const bad of["attention-gmgn-2026102214","attention-traders-force","../../vars"]){await expect(gmgnSavedReview(db,bad)).rejects.toThrow();await expect(gmgnActivityTarget(db,bad,later)).rejects.toThrow();}
 const target=await gmgnActivityTarget(db,sourceId,later);if(target.state!=="ready")throw Error("Expected target");const network=vi.fn(async()=>Response.json(events));
 expect(await runGmgnReview(settings,{reason:"Changed selection",request_id:crypto.randomUUID(),mode:"retained_research",request:{...target.request,wallet:key(22)}},network,()=>later)).toMatchObject({state:"held",provider_requests:0});expect(network).not.toHaveBeenCalled();
});
it("preserves authentication, configuration, pause, budget, failed-hour and provider backoff gates",async()=>{
 const{db,sqlite,settings}=await setup(),fetcher=vi.fn(async()=>Response.json({reset_at:later.getTime()/1000+300},{status:429}));
 expect(await collectAttentionActivity({...settings,apiKey:undefined},{reason:"Missing configuration"},fetcher,()=>later)).toMatchObject({provider_requests:0});
 sqlite.exec("UPDATE tenx_control SET paused=1");expect(await collectAttentionActivity(settings,{reason:"Paused review"},fetcher,()=>later)).toMatchObject({provider_requests:0});sqlite.exec("UPDATE tenx_control SET paused=0");
 expect(await collectAttentionActivity({...settings,marketDailyLimit:3},{reason:"Exhausted budget"},fetcher,()=>later)).toMatchObject({provider_requests:0});expect(fetcher).not.toHaveBeenCalled();
 expect(await collectAttentionActivity(settings,{reason:"Failed review"},fetcher,()=>later)).toMatchObject({state:"failed",provider_requests:1,review:null});expect(await collectAttentionActivity(settings,{reason:"Failed hour stays spent"},fetcher,()=>later)).toMatchObject({reason:"activity_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 expect(sqlite.prepare("SELECT backoff_until FROM tenx_source_transport_control").get()).toEqual({backoff_until:"2026-10-22T14:05:20.000Z"});
 expect((await readAttentionQueue(db,later)).activity_issues).toMatchObject([{address,error:"source_collection_http_error",http_status:429,fields:[]}]);
 const response=await worker.fetch(new Request("http://localhost/api/10x/admin/discovery/attention/activity",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:"Unauthorized"})}),{TENX_LOCAL_ONLY:"true",TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64)} as Parameters<typeof worker.fetch>[1]);expect(response.status).toBe(401);
});
it("does not turn an empty or rejected page into a passing sample or a retry allowance",async()=>{
 for(const response of[{code:0,data:{activities:[],next:null}},{code:0,data:{activities:[{...event(),token:{address:key(90)}}]}}]){
  const{settings}=await setup(),fetcher=vi.fn(async()=>Response.json(response));const result=await collectAttentionActivity(settings,{reason:"Empty or invalid event page"},fetcher,()=>later);expect(result.provider_requests).toBe(1);
  expect(await collectAttentionActivity(settings,{reason:"Repeated empty or invalid page"},fetcher,()=>later)).toMatchObject({reason:"activity_hour_already_reserved",provider_requests:0});expect(fetcher).toHaveBeenCalledTimes(1);
 }
});
it("continues to a different fresh trader source after a failed leading-wallet review",async()=>{
 const second=key(32),{settings}=await setup([second]);await collectAttentionActivity(settings,{reason:"Failed first wallet"},async()=>Response.json({reset_at:later.getTime()/1000+300},{status:429}),()=>later);
 const hour=new Date(at.getTime()+3600000);await collectAttentionTraders(settings,{reason:"Next leading trader sample"},async()=>Response.json({code:0,data:{list:rows}}),()=>hour);
 const next=new Date(hour.getTime()+20000),fetcher=vi.fn(async(url:string)=>{expect(new URL(url).searchParams.get("token_address")).toBe(second);return Response.json({code:0,data:{activities:[{...event(),token:{address:second}}]}});});
 expect(await collectAttentionActivity(settings,{reason:"Fair first wallet follow-up"},fetcher,()=>next)).toMatchObject({state:"retained",provider_requests:1,review:{address:second}});
});
it("counts activity selection receipts inside the 48-receipt and collecting-turn bounds",async()=>{
 const{db,sqlite,settings}=await setup();await collectAttentionActivity(settings,{reason:"Synthetic bounded activity replay"},async()=>Response.json(events),()=>later);
 const id=await attentionActivityId(later),seed=sqlite.prepare("SELECT * FROM tenx_source_reservations WHERE id=?").get(id)!;
 for(let n=0;n<3;n++)sqlite.prepare(`INSERT INTO tenx_source_reservations (${Object.keys(seed).join(",")}) VALUES (${Object.keys(seed).map(()=>"?").join(",")})`).run(...Object.values({...seed,id:crypto.randomUUID(),owner:`synthetic-activity-owner-${n}`,reserved_at:new Date(later.getTime()-n-1).toISOString()}) as (string|number|null)[]);
 const reader=vi.spyOn(db,"prepare"),queue=await readAttentionQueue(db,later);expect(queue.activity_reviews).toHaveLength(2);expect(queue.snapshot_count).toBe(2);expect(queue.history_truncated).toBe(true);expect(reader).toHaveBeenCalledTimes(8);
 reader.mockClear();expect((await readAttentionQueue(db,later,"review")).activity_reviews).toHaveLength(1);expect(reader).toHaveBeenCalledTimes(6);
});
it("keeps saturated five-bucket display and collector reads within the original total envelope",async()=>{
 const{db,sqlite,settings}=await setup();await collectAttentionActivity(settings,{reason:"Saturated event sample"},async()=>Response.json(events),()=>later);
 const end=new Date(at.getTime()+40000);await collectAttentionCandles(settings,{reason:"Saturated candle sample"},async()=>Response.json({code:0,data:[]}),()=>end);
 for(const[prefix,count]of[["attention-gmgn",24],["attention-review",8],["attention-candles",6],["attention-traders",6],["activity",2]] as const){
  const seed=prefix==="activity"?sqlite.prepare("SELECT * FROM tenx_source_reservations WHERE id=?").get(await attentionActivityId(later))!:sqlite.prepare("SELECT * FROM tenx_source_reservations WHERE id LIKE ? LIMIT 1").get(`${prefix}-%`)!;
  for(let n=0;n<count;n++)sqlite.prepare(`INSERT INTO tenx_source_reservations (${Object.keys(seed).join(",")}) VALUES (${Object.keys(seed).map(()=>"?").join(",")})`).run(...Object.values({...seed,id:prefix==="activity"?crypto.randomUUID():`${prefix}-20261021${String(n).padStart(2,"0")}`,owner:`synthetic-${prefix}-${n}`,reserved_at:new Date(end.getTime()-n-1).toISOString()}) as (string|number|null)[]);
 }
 const reader=vi.spyOn(db,"prepare"),queue=await readAttentionQueue(db,end);expect(reader).toHaveBeenCalledTimes(49);expect(queue.snapshot_count).toBe(32);expect(queue.candle_reviews).toHaveLength(6);expect(queue.trader_reviews).toHaveLength(6);expect(queue.activity_reviews).toHaveLength(2);expect(queue.history_truncated).toBe(true);
 reader.mockClear();const focused=await readAttentionQueue(db,end,"review");expect(reader).toHaveBeenCalledTimes(21);expect(focused.snapshot_count).toBe(12);expect(focused.activity_reviews).toHaveLength(1);
 // Selection bytes count even if that source is also read by the trader bucket.
 sqlite.prepare("UPDATE tenx_source_reservations SET bytes=1900000 WHERE json_extract(request,'$.kind') IN ('gmgn_token_traders','gmgn_wallet_activity')").run();
 const bounded=await readAttentionQueue(db,end);expect(bounded.activity_reviews).toEqual([]);expect(bounded.gaps).toContain("receipt_read_byte_bound");
});
