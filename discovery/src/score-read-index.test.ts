import {describe,expect,it} from "vitest";
import {ScoreReadEntrySchema,PackedScoreInventorySchema,packScoreInventory,unpackScoreInventory} from "./score-read-index";
import {toBase58} from "./solana";

const entry=ScoreReadEntrySchema.parse({address:toBase58(new Uint8Array(32).fill(7)),name:"Same",symbol:"Same",eligibility:"provisional",creation_at:null,
  score:0,coverage:100,liquidity:null,freshness:"missing",card_hash:"a".repeat(64),body_hash:"b".repeat(64),score_page:0});
const clone=()=>packScoreInventory([entry]);
describe("lossless verified score inventory",()=>{
  it("round trips empty, boundary and 500 distinct Unicode/escaped identities without normalization",()=>{
    expect(unpackScoreInventory(PackedScoreInventorySchema.parse(packScoreInventory([])))).toEqual([]);
    const entries=Array.from({length:500},(_,i)=>{const b=new Uint8Array(32).fill(7);new DataView(b.buffer).setUint32(0,i);return ScoreReadEntrySchema.parse({...entry,address:toBase58(b),
      name:(i%2?"\u0000\ud800漢🙂":" e\u0301É\"\\\n").repeat(4)+i,symbol:i%3?"__proto__":"constructor",score:i/5,coverage:(500-i)/5,
      liquidity:i%3?null:i*1e5,freshness:i%3===0?"fresh":i%3===1?"stale":"missing",eligibility:i%3===0?"eligible":i%3===1?"provisional":"excluded",
      creation_at:i%2?null:"2026-10-22T00:00:00.000Z",score_page:Math.floor(i/25)});});
    expect(JSON.stringify(unpackScoreInventory(PackedScoreInventorySchema.parse(packScoreInventory(entries))))).toBe(JSON.stringify(entries));
    const maximum=ScoreReadEntrySchema.parse({...entry,name:"\u0000".repeat(100),symbol:"\u0001".repeat(32)});
    expect(unpackScoreInventory(PackedScoreInventorySchema.parse(packScoreInventory([maximum])))).toEqual([maximum]);
  });
  it("interns exact identity text in first-use order, including empty strings and prototype-like keys",()=>{
    const entries=[entry,{...entry,name:"",symbol:"__proto__"},{...entry,name:"Same",symbol:""}];
    expect(packScoreInventory(entries).text).toEqual(["Same","","__proto__"]);
    expect(unpackScoreInventory(PackedScoreInventorySchema.parse(packScoreInventory(entries)))).toEqual(entries);
  });
  it("rejects dangling, fractional, negative, duplicate, unused and out-of-order dictionary references",()=>{
    const bad:((v:ReturnType<typeof clone>)=>void)[]=[v=>{v.rows[0]![1]=1;},v=>{v.rows[0]![1]=-1;},v=>{v.rows[0]![1]=0.5;},v=>{v.rows[0]![2]=1000;},
      v=>{v.text.push("Same");v.rows[0]![2]=1;},v=>{v.text.push("Unused");},v=>{v.text=["Symbol","Name"];v.rows[0]![1]=1;v.rows[0]![2]=0;}];
    for(const mutate of bad){const value=clone();mutate(value);expect(PackedScoreInventorySchema.safeParse(value).success).toBe(false);}
  });
  it("retains every original field constraint and rejects tuple extensions/omissions or unknown keys",()=>{
    const invalid:Record<number,unknown[]>={0:["bad"],3:["unknown"],4:["2026-99-99"],5:[-1,101,NaN,Infinity],6:[-1,101],7:[-1,Infinity],8:["organic"],9:["a".repeat(63)],10:["g".repeat(64)],11:[-1,20,0.5]};
    for(const [field,values] of Object.entries(invalid))for(const value of values){const packed=clone();(packed.rows[0] as unknown[])[Number(field)]=value;expect(PackedScoreInventorySchema.safeParse(packed).success).toBe(false);}
    for(const value of [{...clone(),extra:true},{...clone(),text:["x".repeat(101)]},{...clone(),text:["x".repeat(33)]},
      {...clone(),rows:[[...clone().rows[0]!,"extra"]]},{...clone(),rows:[clone().rows[0]!.slice(0,-1)]},
      {...clone(),rows:Array.from({length:501},()=>clone().rows[0])},{...clone(),text:Array.from({length:1001},()=>"") }])expect(PackedScoreInventorySchema.safeParse(value).success).toBe(false);
  });
});
