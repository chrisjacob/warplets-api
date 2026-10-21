// Synthetic, isolated read study. No app bindings, live files, credentials or provider IO.
// Run from repo root: pnpm exec tsx scripts/discovery-read-index-study.ts .tmp/read-index-study.json
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {resolve,sep} from "node:path";
import {performance} from "node:perf_hooks";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {buildScoreReadPages,readScoreReadPages} from "../discovery/src/score-read-pages";
import {PackedScoreInventorySchema,unpackScoreInventory} from "../discovery/src/score-read-index";
import {rankedDiscovery} from "../discovery/src/discovery-score-store";
import {candidateCard} from "../discovery/src/candidate-card";
import {hashJson,toBase58} from "../discovery/src/solana";
import type {Candidate} from "../discovery/src/model";

const output=resolve(process.argv[2]??""),privateRoot=resolve(".tmp")+sep;
if(!output.startsWith(privateRoot)||!output.endsWith(".json"))throw Error("new_private_json_output_required");
const at=new Date("2026-10-22T01:00:00.000Z"),fixtures=await fixtureCandidates(at),studies=[];
for(const shape of ["shared_wide","distinct_wide","maximum_scatter"] as const){
  const sqlite=new DatabaseSync(":memory:");
  try {
    for(const f of readdirSync("discovery/migrations").filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync("discovery/migrations/"+f,"utf8"));
    const items:Candidate[]=Array.from({length:500},(_,i)=>{const b=new Uint8Array(32).fill(7);new DataView(b.buffer).setUint32(0,20000+i);
      const suffix=shape==="shared_wide"?"\u0000".repeat(5):String(i).padStart(5,"0");
      return {...fixtures[i%fixtures.length]!,mode:"live",address:toBase58(b),name:"\u0000".repeat(95)+suffix,symbol:"\u0001".repeat(27)+(shape==="shared_wide"?"\u0001".repeat(5):suffix)};});
    const insert=sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)");
    for(const c of items)insert.run(c.address,c.pool,JSON.stringify(c),c.checked_at);
    const db=sqliteD1(sqlite);let built=await buildScoreReadPages(db,at);if(built.state!=="built")throw Error(built.reason);
    if(shape==="maximum_scatter"){
      const manifest=JSON.parse((sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get() as {payload:string}).payload);
      const selected=new Set(unpackScoreInventory(PackedScoreInventorySchema.parse(manifest.inventory)).filter((_,i)=>i%25<5).map(e=>e.address));
      const update=sqlite.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?");
      for(const c of items){if(selected.has(c.address))c.name="\u0002"+c.name.slice(1);update.run(JSON.stringify(c),c.address);}
      built=await buildScoreReadPages(db,at);if(built.state!=="built")throw Error(built.reason);
    }
    const queries=shape==="maximum_scatter"?[{limit:100,q:"\u0002",browse:"inventory"}]:[{limit:25,sort:"score"},{limit:25,sort:"liquidity"},{limit:100,sort:"liquidity"},{limit:1,q:items[450]!.address}];
    const before=sqlite.prepare("SELECT total_changes() n").get(),cases=[];
    for(const query of queries){
      const prepare=db.prepare.bind(db);let pages:number[]=[];
      db.prepare=sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...args)=>{if(sql.startsWith("SELECT s.page,"))pages=JSON.parse(args[0] as string);return bind(...args);};return statement;};
      const initial=await readScoreReadPages(db,query,at);db.prepare=prepare;if(initial.state!=="available")throw Error(initial.reason);
      const expected=(await rankedDiscovery(db,items,at,("sort" in query?query.sort:"score") as "score"|"liquidity","all",{search:query.q,maximum:500})).rows.slice(0,query.limit).map(candidateCard);
      if(await hashJson(initial.data.candidates)!==await hashJson(expected))throw Error("full_evaluator_parity_failed");
      if(shape==="maximum_scatter"&&pages.length!==20)throw Error("maximum_scatter_not_exercised");
      for(let i=0;i<5;i++)await readScoreReadPages(db,query,at);
      const cpu=process.cpuUsage(),samples=[];let responseBytes=0;
      for(let i=0;i<40;i++){const start=performance.now(),result=await readScoreReadPages(db,query,at);if(result.state!=="available")throw Error(result.reason);responseBytes=Buffer.byteLength(JSON.stringify(result));samples.push(performance.now()-start);}
      const used=process.cpuUsage(cpu);samples.sort((a,b)=>a-b);
      cases.push({query,requests:40,summary_pages:pages.length,full_evaluator_parity:true,response_bytes:responseBytes,wall_p50_ms:samples[19],wall_p95_ms:samples[37],mean_process_cpu_ms:(used.user+used.system)/40000});
    }
    studies.push({shape,built,cases,no_read_writes:JSON.stringify(before)===JSON.stringify(sqlite.prepare("SELECT total_changes() n").get())});
  } finally {sqlite.close();}
}
const result={version:"compact-score-inventory-study-v1",cutoff:at.toISOString(),studies,
  limits:"Synthetic 500-mint fixtures, maximum-length identity text; not all-schema worst case. Local Node/SQLite warm reads plus serialization, not Workers CPU, cold isolates, deployed D1 metering, concurrency or Free acceptance. No provider/live database IO."};
writeFileSync(output,JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(result));
