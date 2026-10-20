import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import tradeSchema from "../discovery/protocol/trade-schema.json";

type Field = {name:string;type:string|{vec:{defined:{name:string}}}};
type Idl = {address:string;events:{name:string;discriminator:number[]}[];types:{name:string;type:{fields:Field[]}}[]};
const events:{program:string;name:string;discriminator:number[];fields:Field[]}[]=[];
let shareholder:Field[]=[];
for (const name of ["pump","pump_amm"] as const) {
  const url=`https://raw.githubusercontent.com/pump-fun/pump-public-docs/${tradeSchema.revision}/idl/${name}.json`;
  // Optional local IDLs support offline regeneration; their bytes must match
  // the exact official revision already certified for trade instructions.
  const directory=process.argv[2];
  const response=directory?null:await fetch(url,{signal:AbortSignal.timeout(15000),redirect:"error"});
  if (response && !response.ok) throw new Error(`IDL HTTP ${response.status}`);
  const body=directory?readFileSync(`${directory}/${name}.json`,"utf8"):await response!.text();
  const expected=name==="pump"?tradeSchema.pump_sha256:tradeSchema.amm_sha256;
  if (createHash("sha256").update(body).digest("hex")!==expected) throw new Error("Pinned IDL hash mismatch");
  const idl=JSON.parse(body) as Idl;
  for(const event of idl.events.filter(e=>(name==="pump"?["TradeEvent"]:["BuyEvent","SellEvent"]).includes(e.name))) {
    const type=idl.types.find(t=>t.name===event.name);if(!type)throw new Error("Event type missing");
    events.push({program:idl.address,...event,fields:type.type.fields});
  }
  if(name==="pump")shareholder=idl.types.find(t=>t.name==="Shareholder")!.type.fields;
}
writeFileSync(new URL("../discovery/protocol/fee-schema.json",import.meta.url),JSON.stringify({revision:tradeSchema.revision,pump_sha256:tradeSchema.pump_sha256,amm_sha256:tradeSchema.amm_sha256,event_cpi_tag:[228,69,165,46,81,203,154,29],events,shareholder},null,2)+"\n");
console.log("Generated pinned fee event descriptor (no RPC calls).");
