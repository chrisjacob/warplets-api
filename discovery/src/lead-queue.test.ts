import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { dueLeads } from "./lead-queue";
const opened:DatabaseSync[]=[];afterEach(()=>opened.splice(0).forEach(d=>d.close()));
it("inspects real market-floor leads before unknown/failed leads and skips old migrations",async()=>{
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));const db=sqliteD1(sqlite),at="2026-10-20T00:00:00.000Z";
  for(const[address,cap,liquidity,time]of[["cold",null,null,1792450799],["low",100,100,1792450799],["hot",200000,50000,1792450799],["old",900000,90000,1792000000]]as const){
    await db.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES(?1,'pool',?2,'signature',?3)").bind(address,JSON.stringify({blockTime:time}),at).run();
    if(cap!==null)await db.prepare("INSERT INTO tenx_lead_markets(address,pool,payload,attempted_at) VALUES(?1,'pool',?2,?3)").bind(address,JSON.stringify({market_cap_usd:cap,liquidity_usd:liquidity}),at).run();
  }
  expect((await dueLeads(db,at)).map(l=>l.address)).toEqual(["hot","cold"]);
});
