import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {historyDirectory} from "./history-directory";
import {HistoryDirectory} from "./history-directory-model";
import {hashJson,toBase58} from "./solana";
import {candidateExpiry} from "./candidate-expiry";
import {candidateScorecard,scoreInventoryCandidates} from "./discovery-score-store";
import {replayAnyDiscoveryScore} from "./discovery-score-replay";
import {CardListResponse} from "../../app/src/discovery/client";
import worker,{handle,type LocalEnv} from "./worker";

const at=new Date("2026-10-21T09:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
function address(i:number){const b=new Uint8Array(32);new DataView(b.buffer).setUint32(0,i);b[31]=1;return toBase58(b);}
async function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite),base={...(await fixtureCandidates(at))[0]!,mode:"live" as const,address:address(7000)};
  const put=(mint:string,payload:unknown,mode="live")=>sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?,?,?,?,?)").run(mode,mint,base.pool,typeof payload==="string"?payload:JSON.stringify(payload),base.checked_at);
  return {sqlite,db,base,put,env:{TENX_DB:db,TENX_LOCAL_ONLY:"true"} as LocalEnv};}

describe("bounded current evaluation and indexed retained history",()=>{
  it.each([501,1000,5000])("browses %i retained identities while scoring only the current inventory, preserving old payloads and expiry receipts",async total=>{
    const {sqlite,db,base,put,env}=await setup();put(base.address,base);
    const original=await candidateScorecard(db,base.address,"live",at);
    const insertProof=sqlite.prepare("INSERT INTO tenx_proofs(address,kind,signature,instruction_index,slot,payload_hash,payload) VALUES(?,'creation',?,?,?,?,?)");
    const insertExpiry=sqlite.prepare("INSERT INTO tenx_candidate_expiry(address,created_at,expired_at,proof_hash,receipt_hash,receipt) VALUES(?,?,?,?,?,?)");
    sqlite.exec("BEGIN");
    for(let i=1;i<total;i++){
      const signatureBytes=new Uint8Array(64);new DataView(signatureBytes.buffer).setUint32(0,i);signatureBytes[63]=1;
      const proof={...base.creation!,block_time:"2026-10-19T08:00:00.000Z",signature:toBase58(signatureBytes)};
      const mint=address(i),old={...base,address:mint,name:`Historical ${i}`,creation:proof};put(mint,old);
      insertProof.run(mint,proof.signature,proof.instruction_index,proof.slot,proof.payload_hash,JSON.stringify(proof));
      const receipt={version:"verified-creation-expiry-v1",address:mint,creation:proof,expired_at:at.toISOString()};
      insertExpiry.run(mint,proof.block_time,at.toISOString(),proof.payload_hash,await hashJson(receipt),JSON.stringify(receipt));
    }sqlite.exec("COMMIT");
    const before=sqlite.prepare("SELECT total_changes() n").get(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden"));
    const oldPayload=sqlite.prepare("SELECT payload FROM tenx_candidates WHERE address=?").get(address(1));
    vi.useFakeTimers();vi.setSystemTime(at);
    const current=CardListResponse.parse(await(await handle(new Request("http://localhost/api/10x/candidates?view=cards&age=all&inventory=current&browse=inventory"),env)).json());
    expect(current.data.scope).toMatchObject({inventory:"current_evaluation",stored:1,retained_total:total,ranked:1,maximum:500});expect(current.data.candidates.map((c:{address:string})=>c.address)).toEqual([base.address]);
    await expect(scoreInventoryCandidates(db,"live",true)).rejects.toThrow(/inventory_limit/);
    const seen:string[]=[];let cursor:string|undefined;
    do{const page=await historyDirectory(db,{mode:"live",limit:100,...cursor?{cursor}:{}},at);expect(page.total_retained).toBe(total);expect(page.rows.length).toBeLessThanOrEqual(100);seen.push(...page.rows.map(r=>r.address));cursor=page.next_cursor??undefined;}while(cursor);
    expect(seen).toEqual([...seen].sort());expect(new Set(seen).size).toBe(total);
    const exact=await historyDirectory(db,{mint:address(1)},at);expect(exact.rows.map(r=>r.address)).toEqual([address(1)]);expect(exact.next_cursor).toBeNull();
    expect(await candidateExpiry(db,address(1))).toMatchObject({address:address(1),creation:{block_time:"2026-10-19T08:00:00.000Z"}});
    expect(sqlite.prepare("SELECT payload FROM tenx_candidates WHERE address=?").get(address(1))).toEqual(oldPayload);
    expect(await replayAnyDiscoveryScore(original!)).toEqual({status:"verified",provider_requests:0});
    expect((await candidateScorecard(db,base.address,"live",at))!.record_hash).toBe(original!.record_hash);
    expect((await candidateScorecard(db,address(1),"live",at))!.inputs.candidate.address).toBe(address(1));
    expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);expect(network).not.toHaveBeenCalled();
  },30000);
  it("retains invalid/oversize metadata as held identities and never returns private payload fields",async()=>{
    const {db,base,put}=await setup();
    put(address(1),"{");put(address(2),{...base,address:address(2),name:"a".repeat(101),private_token:"not-for-directory"});
    put(address(3),{...base,address:address(4)});put(address(4),{...base,address:address(4),padding:" ".repeat(16001)});put(address(5),{...base,address:address(5),private_token:"not-for-directory"});
    const page=await historyDirectory(db,{},at);
    expect(page.rows.filter(r=>r.metadata_status==="held")).toHaveLength(4);expect(page.rows.find(r=>r.address===address(5))!.metadata_status).toBe("available");
    expect(JSON.stringify(page)).not.toContain("not-for-directory");expect(JSON.stringify(page)).not.toContain("private_token");
  });
  it("binds cursors to mode/mint and bounds input rather than accepting offset or arbitrary filters",async()=>{
    const {db,base,put}=await setup();for(let i=1;i<=3;i++)put(address(i),{...base,address:address(i)});
    const first=await historyDirectory(db,{limit:1},at);
    await expect(historyDirectory(db,{mode:"fixture",cursor:first.next_cursor!},at)).rejects.toThrow(/cursor_invalid/);
    await expect(historyDirectory(db,{mint:address(2),cursor:first.next_cursor!},at)).rejects.toThrow(/cursor_invalid/);
    for(const query of [{limit:101},{offset:3},{cursor:"bad"},{mint:"invalid"},{q:"name"}])await expect(historyDirectory(db,query,at)).rejects.toThrow();
    expect((await historyDirectory(db,{mint:address(9)},at)).rows).toEqual([]);
  });
  it("uses live keysets honestly: inserts before a cursor require refresh, later identities are reachable without duplicates",async()=>{
    const {db,base,put}=await setup();for(const i of [10,20,30])put(address(i),{...base,address:address(i)});
    const sorted=(await historyDirectory(db,{},at)).rows.map(r=>r.address),first=await historyDirectory(db,{limit:1},at);
    const extra=Array.from({length:40},(_,i)=>address(i+1)).find(a=>a<sorted[0]!)!;put(extra,{...base,address:extra});
    const second=await historyDirectory(db,{cursor:first.next_cursor!},at);expect(second.pagination).toBe("live_keyset_not_snapshot");expect(second.rows.map(r=>r.address)).toEqual(sorted.slice(1));
    expect((await historyDirectory(db,{},at)).rows.map(r=>r.address)).toContain(extra);
  });
  it("keeps active overflow and current cursor scope held without inventing a smaller cohort",async()=>{
    const {db,base,put,env}=await setup();for(let i=1;i<=501;i++)put(address(i),{...base,address:address(i)});
    await expect(handle(new Request("http://localhost/api/10x/candidates?inventory=current"),env)).rejects.toThrow(/inventory_limit/);
    expect((await historyDirectory(db,{limit:1},at)).total_retained).toBe(501);
    const result=await worker.fetch(new Request("http://localhost/api/10x/history?mint=bad"),env);expect(result.status).toBe(400);
    expect(HistoryDirectory.safeParse({...await historyDirectory(db,{},at),ranked:true}).success).toBe(false);
  });
  it("uses the existing mode/address range index and binds current-view cursors separately",async()=>{
    const {db,sqlite,base,put,env}=await setup();for(let i=1;i<=3;i++)put(address(i),{...base,address:address(i)});
    const statements:string[]=[],prepare=db.prepare.bind(db);vi.spyOn(db,"prepare").mockImplementation(sql=>{statements.push(sql);return prepare(sql);});
    await historyDirectory(db,{},at);expect(statements).toHaveLength(2);
    const query=statements.find(sql=>sql.includes("AS metadata"))!;
    const plan=sqlite.prepare("EXPLAIN QUERY PLAN "+query).all("live","",101).map(r=>r.detail).join(" ");
    expect(plan).toMatch(/SEARCH tenx_candidates USING INDEX .*\(mode=\? AND address>\?\)/);expect(plan).not.toContain("TEMP B-TREE");
    vi.useFakeTimers();vi.setSystemTime(at);
    const url="http://localhost/api/10x/candidates?view=cards&age=all&inventory=current&limit=1";
    const first=CardListResponse.parse(await(await handle(new Request(url),env)).json());expect(first.next_cursor).not.toBeNull();
    expect((await handle(new Request(url+`&cursor=${encodeURIComponent(first.next_cursor!)}`),env)).status).toBe(200);
    expect((await handle(new Request(url.replace("inventory=current","inventory=retained")+`&cursor=${encodeURIComponent(first.next_cursor!)}`),env)).status).toBe(409);
  });
});
