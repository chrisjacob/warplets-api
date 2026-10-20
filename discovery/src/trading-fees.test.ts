import { describe, expect, it } from "vitest";
import recorded from "../fixtures/recorded/trading-fees.json";
import buy from "../fixtures/recorded/temporary-wsol-trade.json";
import descriptor from "../protocol/fee-schema.json";
import { AMM, instructions, TOKEN } from "./pump";
import { fromBase58, hashJson, Reader, toBase58 } from "./solana";
import { WalletTransactionSchema, type WalletTransaction } from "./wallet-rpc";
import { decodeFeeEvent, tradingFeesForTransaction, tradingFeeSummary } from "./trading-fees";
import { verifiedTrades } from "./wallet-trades";
import { MAINNET_GENESIS } from "./rpc";
import { WalletEvidenceSchema } from "./wallet-analysis";

const build=()=>WalletTransactionSchema.parse(structuredClone(buy.transaction));
const verify=(tx:WalletTransaction)=>tradingFeesForTransaction(tx,buy.mint,buy.pool);
function eventData(tx:WalletTransaction) {
  const all=instructions(tx),event=all.find(i=>i.program===AMM && descriptor.event_cpi_tag.every((b,n)=>i.data[n]===b))!;
  const raw=tx.meta!.innerInstructions!.find(g=>g.index===event.top)!.instructions[event.inner!]!;
  return {event,raw,all};
}
function fieldOffset(tx:WalletTransaction,name:string) {
  const {event}=eventData(tx),layout=descriptor.events.find(e=>e.program===AMM && e.discriminator.every((b,n)=>event.data[n+8]===b))!,r=new Reader(event.data,16);
  for(const f of layout.fields) {
    if(f.name===name)return r.offset;
    if(f.type==="string")r.take(r.u32());
    else if(f.type==="pubkey")r.take(32);
    else if(f.type==="bool")r.take(1);
    else if(f.type==="i128")r.take(16);
    else r.take(8);
  }
  throw Error("test_field_missing");
}
function mutateAmount(tx:WalletTransaction,name:string,amount:bigint) {
  const {raw}=eventData(tx),bytes=fromBase58(raw.data),offset=fieldOffset(tx,name);new DataView(bytes.buffer).setBigUint64(offset,amount,true);raw.data=toBase58(bytes);
}
describe("event and execution reconciled trading fees",()=>{
  it("replays independent recorded Pump buy and PumpSwap sell amounts, excluding rent and double-counted buyback",async()=>{
    for(const sample of recorded.samples) {
      const tx=WalletTransactionSchema.parse(sample.transaction);expect(await hashJson(tx)).toBe(sample.transaction_hash);
      const result=await tradingFeesForTransaction(tx,recorded.mint,recorded.pool);
      expect(result.unverified).toEqual([]);expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject(sample.expected);
      const row=result.rows[0]!;expect(BigInt(row.protocol_gross_raw)).toBe(BigInt(row.protocol_net_raw)+BigInt(row.buyback_raw));
      expect(BigInt(row.total_fee_raw)).toBe(BigInt(row.protocol_gross_raw)+BigInt(row.creator_raw)+BigInt(row.lp_raw));
    }
  });
  it("verifies real PumpSwap buy LP retention, protocol split, creator payment and unknown trailing event fields",async()=>{
    const result=await verify(build());expect(result.unverified).toEqual([]);
    expect(result.rows[0]).toMatchObject({protocol_gross_raw:"111591",protocol_net_raw:"55796",buyback_raw:"55795",creator_raw:"111591",lp_raw:"446362",total_fee_raw:"669544",quote_amount_raw:"223180524",gaps:["fee_event_extension_uninterpreted"]});
  });
  it("fails closed when event arithmetic, amounts, identity, timestamp or fee rates are altered",async()=>{
    for(const name of ["lp_fee","protocol_fee","coin_creator_fee","quote_amount_in","user_quote_amount_in","buyback_fee","protocol_fee_basis_points","timestamp"]) {
      const tx=build(),{event}=eventData(tx),value=decodeFeeEvent(event).fields[name] as bigint;mutateAmount(tx,name,value+1n);
      expect((await verify(tx)).rows, name).toEqual([]);
    }
    for(const name of ["user","pool","protocol_fee_recipient","user_quote_token_account"]) {
      const tx=build(),{raw}=eventData(tx),bytes=fromBase58(raw.data);bytes[fieldOffset(tx,name)]!^=1;raw.data=toBase58(bytes);expect((await verify(tx)).rows,name).toEqual([]);
    }
  });
  it("does not substitute a different recipient, token mint, amount or arbitrary same-value payment",async()=>{
    for(const mutation of ["recipient","mint","amount","unchecked"]) {
      const tx=build(),payment=tx.meta!.innerInstructions!.find(g=>g.index===6)!.instructions[3]!;
      if(mutation==="recipient")payment.accounts[2]=0;
      if(mutation==="mint")payment.accounts[1]=0;
      if(mutation==="amount"){const data=fromBase58(payment.data);data[1]!^=1;payment.data=toBase58(data);}
      if(mutation==="unchecked"){const data=fromBase58(payment.data);payment.data=toBase58(Uint8Array.from([3,...data.slice(1,9)]));payment.accounts.splice(1,1);}
      expect((await verify(tx)).rows,mutation).toEqual([]);
    }
  });
  it("requires the exact self-CPI authority, tag, single event and direct call ancestry",async()=>{
    for(const mutation of ["authority","tag","duplicate","stack","unrelated"]) {
      const tx=build(),{raw,event}=eventData(tx),group=tx.meta!.innerInstructions!.find(g=>g.index===event.top)!;
      if(mutation==="authority")raw.accounts[0]=0;
      if(mutation==="tag"){const b=fromBase58(raw.data);b[0]!^=1;raw.data=toBase58(b);}
      if(mutation==="duplicate")group.instructions.push(structuredClone(raw));
      if(mutation==="stack")raw.stackHeight=3;
      if(mutation==="unrelated"){group.instructions.splice(event.inner!,1);tx.meta!.innerInstructions!.push({index:0,instructions:[raw]});}
      expect((await verify(tx)).rows,mutation).toEqual([]);
    }
  });
  it("does not claim LP retention across an additional quote-vault debit or unchecked quote transfer",async()=>{
    for(const unchecked of [false,true]) {
      const tx=build(),group=tx.meta!.innerInstructions!.find(g=>g.index===6)!,extra=structuredClone(group.instructions[3]!);
      extra.accounts[0]=tx.transaction.message.instructions[6]!.accounts[8]!;
      extra.accounts[3]=tx.transaction.message.instructions[6]!.accounts[0]!;
      if(unchecked){const data=fromBase58(extra.data);extra.data=toBase58(Uint8Array.from([3,...data.slice(1,9)]));extra.accounts.splice(1,1);}
      group.instructions.splice(6,0,extra);
      expect((await verify(tx)).unverified[0]?.reason).toBe("fee_quote_flow_unreconciled");
    }
  });
  it("keeps cashback/holder-reward routes, missing fields and unsupported versions unverified",async()=>{
    for(const name of ["cashback","holder_rewards"]) {
      const tx=build();mutateAmount(tx,name,1n);expect((await verify(tx)).unverified[0]?.reason).toBe("fee_special_routing_unsupported");
    }
    const tx=build(),{raw}=eventData(tx);raw.data=toBase58(fromBase58(raw.data).slice(0,100));expect((await verify(tx)).rows).toEqual([]);
    const failed=build();failed.meta!.err={InstructionError:[6,"failed"]};await expect(verify(failed)).rejects.toThrow();
  });
  it("preserves exact integers above Number.MAX_SAFE_INTEGER when decoding",()=>{
    const tx=build();mutateAmount(tx,"protocol_fee",9007199254740993n);
    expect(decodeFeeEvent(eventData(tx).event).fields.protocol_fee).toBe(9007199254740993n);
  });
  it("attributes multiple swaps in one transaction to their own events and counts each fee once",async()=>{
    // Synthetic repetition of a recorded execution, never served as live data.
    const tx=build(),group=tx.meta!.innerInstructions!.find(g=>g.index===6)!;
    tx.transaction.message.instructions.splice(7,0,structuredClone(tx.transaction.message.instructions[6]!));
    for(const g of tx.meta!.innerInstructions!)if(g.index>=7)g.index++;
    tx.meta!.innerInstructions!.push({index:7,instructions:structuredClone(group.instructions)});
    const result=await verify(tx);expect(result.rows).toHaveLength(2);expect(result.rows.map(r=>r.event_instruction_index)).toEqual(["6.6","7.6"]);
    const at=new Date(tx.blockTime!*1000+60000).toISOString();
    const input=WalletEvidenceSchema.parse({version:"wallet-input-v4",cluster:MAINNET_GENESIS,observed_at:at,asset:{address:buy.mint,pool:buy.pool,token_program:TOKEN,creation:null,graduation:null},records:[{signature:tx.transaction.signatures[0],fetched_at:at,status:"available",purposes:["recent"],transaction:tx}],funding_scans:[],second_hop_scans:[],histories:[],holders:null,prior_losses:[],gaps:[]});
    const summary=await tradingFeeSummary(input,(await verifiedTrades(tx,buy.mint,buy.pool,{temporaryWsol:true})).trades);
    expect(summary).toMatchObject({verified_trades:2,sampled_trades:2,total_fee_raw:"1339088",protocol_gross_raw:"223182",buyback_raw:"111590",status:"partial"});
  });
  it("does not turn an unavailable sample into zero fees or organic-trading approval",async()=>{
    expect(await tradingFeeSummary(null,[])).toMatchObject({status:"unavailable",verified_trades:0,total_fee_raw:null,lp_raw:null,protocol_gross_raw:null});
  });
});
