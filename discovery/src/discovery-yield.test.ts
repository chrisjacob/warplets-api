import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {discoveryYield} from "./discovery-yield";
import {DiscoveryYield} from "./discovery-yield-model";
import {handle,type LocalEnv} from "./worker";
const at=new Date("2026-10-22T10:00:00.000Z"),mint="CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump",other="ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump";
const instances:DatabaseSync[]=[];
afterEach(()=>{instances.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
function fixture(){const db=new DatabaseSync(":memory:");instances.push(db);db.exec(readFileSync(new URL('../migrations/0001_discovery.sql',import.meta.url),'utf8'));db.exec('CREATE TABLE tenx_candidate_expiry(address TEXT PRIMARY KEY)');return {db,d1:sqliteD1(db)};}
function candidate(db:DatabaseSync,address:string,patch:Record<string,unknown>={}){const payload={address,chain:'solana',mode:'live',creation:{block_time:'2026-10-22T09:00:00.000Z'},graduation:{block_time:'2026-10-22T09:30:00.000Z'},market:{fetched_at:'2026-10-22T09:59:00.000Z',volume_24h_usd:123},...patch};db.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,'live')").run(address,address,JSON.stringify(payload),at.toISOString());}
it("separates creation and graduation windows, unknown creation, current/retained freshness and unchecked leads in one read batch",async()=>{
  const {db,d1}=fixture();candidate(db,mint,{creation:null});candidate(db,other,{creation:{block_time:'2026-10-20T09:00:00.000Z'}});db.prepare('INSERT INTO tenx_candidate_expiry(address) VALUES(?)').run(other);
  for(const [i,checked,seconds] of [['one',null,at.getTime()/1000-60],['two',at.toISOString(),at.getTime()/1000-100],['old',null,at.getTime()/1000-90000]] as const)db.prepare('INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at,checked_at) VALUES(?,?,?,?,?,?)').run(i,i,JSON.stringify({blockTime:seconds}),i,at.toISOString(),checked);
  db.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at) VALUES('pending',1,?)").run(at.toISOString());
  const changes=db.prepare('SELECT total_changes() n').get()!.n,provider=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('provider_forbidden')),r=await discoveryYield(d1,at);
  expect(r.candidates).toMatchObject({retained:2,active:1,active_creation_unknown:1,created_24h:0,graduated_24h:2,graduated_24h_creation_unknown:1,fresh_market:2,active_fresh_market:1,active_fresh_reported_volume:1});
  expect(r.leads).toMatchObject({observed:3,unchecked:2,graduated_24h:2,unchecked_graduated_24h:1});expect(r.signatures.pending).toBe(1);expect(r.harvest.checkpoint).toBe('migration_required');expect(r.market_recall).toBe('not_measured');expect(r.receipt_payloads_replayed).toBe(false);expect(provider).not.toHaveBeenCalled();expect(db.prepare('SELECT total_changes() n').get()!.n).toBe(changes);
});
it("retains malformed and identity-mismatched records in denominators while excluding future/stale market windows",async()=>{
  const {db,d1}=fixture();candidate(db,mint,{market:{fetched_at:'2026-10-22T10:00:01.000Z',volume_24h_usd:100}});candidate(db,other,{market:{fetched_at:'2026-10-22T09:59:00.000Z',observed_at:'2026-10-22T10:00:01.000Z',volume_24h_usd:100}});
  for(const [address,payload] of [['bad','{'],['mismatch',JSON.stringify({address:mint,chain:'solana',mode:'live',market:{fetched_at:at.toISOString()}})]])db.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?, 'live')").run(address,address,payload,at.toISOString());
  db.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES('bad','bad','{','bad',?)").run(at.toISOString());
  const r=await discoveryYield(d1,at);expect(r.candidates).toMatchObject({retained:4,invalid_cached_identity:2,fresh_market:0,fresh_reported_volume:0});expect(r.leads).toMatchObject({observed:1,unchecked:1,graduated_24h:0,invalid_cached_json:1});
  const foreign={...r,candidates:{...r.candidates,active_fresh_market:5}};expect(DiscoveryYield.safeParse(foreign).success).toBe(false);
});
it("keeps diagnostic counts available above the rank inventory limit without ranking or admitting those rows",async()=>{
  const {db,d1}=fixture();for(let i=0;i<501;i++)db.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?, 'live')").run(String(i),String(i),'{}',at.toISOString());
  const r=await discoveryYield(d1,at);expect(r.candidates).toMatchObject({retained:501,active:501,invalid_cached_identity:501});expect(r.qualified_attention_in_rank).toBe(false);expect(r.provider_requests).toBe(0);
});
it("serves only a local cached aggregate and never exposes mints, signatures, quota permits or provider authority",async()=>{
  const {db,d1}=fixture();candidate(db,mint);const env={TENX_DB:d1,TENX_LOCAL_ONLY:'true'} as LocalEnv,provider=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('provider_forbidden'));
  const response=await handle(new Request('http://127.0.0.1:8794/api/10x/discovery/yield'),env),body=await response.text();expect(response.status).toBe(200);expect(DiscoveryYield.safeParse(JSON.parse(body)).success).toBe(true);expect(body).not.toContain(mint);expect(body).not.toContain('migration_cursor');expect(body).not.toContain('lease_owner');expect(provider).not.toHaveBeenCalled();
  expect((await handle(new Request('https://external.example/api/10x/discovery/yield'),env)).status).toBe(503);
});
