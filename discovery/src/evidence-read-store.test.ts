import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {holderAcquisitionFixture} from "./holder-acquisition-fixtures.test-helper";
import {fixtureCandidates} from "./fixtures";
import {analyzeHolders,HolderEvidenceSchema} from "./holders";
import {analyzeWalletEvidence,WalletEvidenceSchema} from "./wallet-analysis";
import {saveCandidate} from "./store";
import {activitySummary} from "./activity";
import worker,{type LocalEnv} from "./worker";
const databases:DatabaseSync[]=[];
afterEach(()=>{databases.splice(0).forEach(d=>d.close());vi.useRealTimers();vi.restoreAllMocks();});
async function setup(){
  const sqlite=new DatabaseSync(":memory:");databases.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL("../migrations/"+f,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite),input=await holderAcquisitionFixture(),wallet=WalletEvidenceSchema.parse(input.wallet!.evidence),meta=input.history.index[0]!,holder=HolderEvidenceSchema.parse(input.history.samples[0]!.evidence),at=new Date(input.history.cutoff_at);
  const candidate={...(await fixtureCandidates(at))[0]!,mode:"live" as const,address:input.history.address,pool:wallet.asset.pool,creation:wallet.asset.creation,graduation:wallet.asset.graduation,holders:await analyzeHolders(holder,meta.observed_at),wallet_analysis:await analyzeWalletEvidence(wallet)};
  await saveCandidate(db,candidate);sqlite.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(meta.payload_hash,meta.address,meta.slot,JSON.stringify(holder),meta.observed_at);const wm=input.wallet_index[0]!;sqlite.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(wm.evidence_hash,wm.address,JSON.stringify(wallet),wm.observed_at);
  return{sqlite,db,input,wallet,holder,meta,wm,candidate,at,env:{TENX_DB:db,TENX_LOCAL_ONLY:"true"} as LocalEnv};
}
it("raw holder/wallet routes retain the exact legacy data shape, error status and no-store headers",async()=>{
  const f=await setup(),changes=f.sqlite.prepare("SELECT total_changes() AS n").get()!.n,network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No provider calls"));
  const holder=await worker.fetch(new Request("http://localhost/api/10x/holder-evidence/"+f.meta.payload_hash),f.env),wallet=await worker.fetch(new Request("http://localhost/api/10x/wallet-evidence/"+f.wm.evidence_hash),f.env);
  expect(holder.status).toBe(200);expect(wallet.status).toBe(200);
  expect(JSON.stringify((await holder.json() as {data:unknown}).data)).toBe(JSON.stringify({address:f.meta.address,slot:f.meta.slot,payload:f.holder,observed_at:f.meta.observed_at,payload_hash:f.meta.payload_hash}));
  expect(JSON.stringify((await wallet.json() as {data:unknown}).data)).toBe(JSON.stringify({address:f.wm.address,payload_hash:f.wm.evidence_hash,observed_at:f.wm.observed_at,payload:f.wallet}));
  expect(holder.headers.get("cache-control")).toBe("no-store");expect(wallet.headers.get("cache-control")).toBe("no-store");
  for(const path of ["holder-evidence","wallet-evidence"]){const missing=await worker.fetch(new Request("http://localhost/api/10x/"+path+"/"+"0".repeat(64)),f.env);expect(missing.status).toBe(404);expect(await missing.json()).toEqual({error:"evidence_not_found"});}
  expect(network).not.toHaveBeenCalled();expect(f.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(changes);
});
it("activity route retains the original summary and keeps missing wallets unknown without provider work",async()=>{
  const f=await setup();vi.useFakeTimers();vi.setSystemTime(f.at);const changes=f.sqlite.prepare("SELECT total_changes() AS n").get()!.n,network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No provider calls"));
  const response=await worker.fetch(new Request("http://localhost/api/10x/activity/solana/"+f.candidate.address),f.env);expect(response.status).toBe(200);
  const points=(await f.db.prepare("SELECT payload FROM tenx_market_history WHERE address=?1 ORDER BY fetched_at DESC LIMIT 1000").bind(f.candidate.address).all<{payload:string}>()).results.map(r=>JSON.parse(r.payload));
  expect((await response.json() as {data:unknown}).data).toEqual(await activitySummary(f.candidate,f.wallet,points,f.at));
  expect(network).not.toHaveBeenCalled();expect(f.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(changes);
  f.sqlite.exec("DELETE FROM tenx_wallet_evidence");const missing=await worker.fetch(new Request("http://localhost/api/10x/activity/solana/"+f.candidate.address),f.env);expect(missing.status).toBe(200);expect((await missing.json() as {data:{gaps:string[]}}).data.gaps).toContain("wallet_evidence_unavailable");
});
