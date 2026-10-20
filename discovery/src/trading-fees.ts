import descriptor from "../protocol/fee-schema.json";
import tradeSchema from "../protocol/trade-schema.json";
import { AMM, ATA, instructions, PUMP, TOKEN, WSOL } from "./pump";
import { bytesEqual, findPda, hashBytes, publicKey, Reader, seed } from "./solana";
import { verifiedTrades } from "./wallet-trades";
import type { WalletTransaction } from "./wallet-rpc";
import type { WalletEvidence } from "./wallet-analysis";
import type { VerifiedTrade } from "./wallet-model";
import { TradingFeeRowSchema, TradingFeesSchema, type TradingFeeRow } from "./trading-fee-model";

const SYSTEM="11111111111111111111111111111111";
type Ix=ReturnType<typeof instructions>[number];
type Field={name:string;type:unknown};
type Value=bigint|string|boolean|Value[]|{[key:string]:Value};
function decodeValue(r:Reader,type:unknown):Value {
  if(type==="u64")return r.u64();
  if(type==="i64")return new DataView(r.take(8).buffer).getBigInt64(0,true);
  if(type==="i128") { const bytes=r.take(16),v=new DataView(bytes.buffer);return (v.getBigInt64(8,true)<<64n)|v.getBigUint64(0,true); }
  if(type==="pubkey")return r.key();
  if(type==="bool")return r.bool();
  if(type==="u16")return BigInt(r.u16());
  if(type==="string") {
    const length=r.u32();if(length>64)throw new Error("fee_event_string_limit");
    const text=new TextDecoder("utf-8",{fatal:true}).decode(r.take(length));
    if(!/^[a-z0-9_]+$/.test(text))throw new Error("fee_event_invalid_instruction_name");return text;
  }
  if(type && typeof type==="object" && "vec" in type) {
    const element=(type as {vec:unknown}).vec;
    if(!element || typeof element!=="object" || !("defined" in element) || (element as {defined:{name:string}}).defined.name!=="Shareholder")throw new Error("fee_event_type_unsupported");
    const count=r.u32();if(count>16)throw new Error("fee_event_shareholder_limit");
    return Array.from({length:count},()=>Object.fromEntries(descriptor.shareholder.map(f=>[f.name,decodeValue(r,f.type)])));
  }
  throw new Error("fee_event_type_unsupported");
}
export function decodeFeeEvent(ix:Ix) {
  if(!bytesEqual(ix.data,descriptor.event_cpi_tag))throw new Error("fee_event_tag_mismatch");
  const event=descriptor.events.find(e=>e.program===ix.program && bytesEqual(ix.data.slice(8),e.discriminator));
  if(!event)throw new Error("fee_event_layout_unsupported");
  const reader=new Reader(ix.data,16),fields:Record<string,Value>={};
  for(const field of event.fields as Field[])fields[field.name]=decodeValue(reader,field.type);
  // Appended bytes never become invented zero-valued fields. Known components
  // can still reconcile to execution; the row retains an extension gap.
  return {name:event.name,fields,trailing:ix.data.length-reader.offset};
}
function directChildren(tx:WalletTransaction,parent:Ix,all:Ix[]):Ix[] {
  const groups=tx.meta!.innerInstructions?.filter(g=>g.index===parent.top)??[];
  if(groups.length!==1)throw new Error("fee_call_stack_unavailable");
  const top=all.find(i=>i.top===parent.top && i.inner===null)!;
  const stack=[{ix:top,depth:1}],children:Ix[]=[];
  for(const ix of all.filter(i=>i.top===parent.top && i.inner!==null)) {
    if(ix.stack===null || ix.stack<2)throw new Error("fee_call_stack_unavailable");
    while(stack.length && stack.at(-1)!.depth>=ix.stack)stack.pop();
    if(stack.at(-1)?.depth!==ix.stack-1)throw new Error("fee_call_stack_invalid");
    if(stack.at(-1)!.ix.path===parent.path)children.push(ix);
    stack.push({ix,depth:ix.stack});
  }
  return children;
}
function big(fields:Record<string,Value>,key:string):bigint {const n=fields[key];if(typeof n!=="bigint" || n<0n)throw new Error("fee_event_numeric_field_invalid");return n;}
function key(fields:Record<string,Value>,name:string):string {const k=fields[name];if(typeof k!=="string")throw new Error("fee_event_key_invalid");return k;}
function equal(actual:unknown,expected:unknown) {if(actual!==expected)throw new Error("fee_event_execution_mismatch");}
function rate(amount:bigint,bps:bigint,fee:bigint) {if(bps>10000n || fee!==(amount*bps+9999n)/10000n)throw new Error("fee_arithmetic_mismatch");}
const ata=(owner:string)=>findPda(ATA,[publicKey(owner),publicKey(TOKEN),publicKey(WSOL)]);
type Payment={ix:Ix;from:string;to:string;amount:bigint};
function payments(children:Ix[],native:boolean):Payment[] {
  const result:Payment[]=[];
  for(const ix of children) {
    const r=new Reader(ix.data);
    if(native && ix.program===SYSTEM && ix.data.length===12 && r.u32()===2 && ix.accounts.length===2)result.push({ix,from:ix.accounts[0]!,to:ix.accounts[1]!,amount:r.u64()});
    // Only checked WSOL transfers establish fee denomination independently of
    // a recipient's metadata. Unchecked transfers remain unsupported here.
    if(!native && ix.program===TOKEN && ix.data.length===10 && r.u8()===12 && ix.accounts.length===4 && ix.accounts[1]===WSOL) {
      const amount=r.u64();if(r.u8()!==9)throw new Error("fee_quote_decimals_mismatch");
      result.push({ix,from:ix.accounts[0]!,to:ix.accounts[2]!,amount});
    }
  }
  return result;
}
async function feeForTrade(tx:WalletTransaction,trade:VerifiedTrade,all:Ix[]):Promise<TradingFeeRow> {
  const parent=all.find(i=>i.path===trade.instruction_index && i.program===trade.program);
  if(!parent)throw new Error("fee_trade_instruction_missing");
  const layout=tradeSchema.instructions.find(d=>d.program===parent.program && bytesEqual(parent.data,d.discriminator));
  if(!layout || parent.accounts.length<layout.accounts.length)throw new Error("fee_instruction_layout_unsupported");
  const a=Object.fromEntries(layout.accounts.map((name,i)=>[name,parent.accounts[i]!]));
  const children=directChildren(tx,parent,all),authority=await findPda(parent.program,[seed("__event_authority")]);
  equal(a.event_authority,authority);equal(a.program,parent.program);equal(a.system_program,SYSTEM);
  const events=children.filter(i=>i.program===parent.program && bytesEqual(i.data,descriptor.event_cpi_tag));
  const candidates=events.filter(i=>descriptor.events.some(e=>e.program===parent.program && bytesEqual(i.data.slice(8),e.discriminator)));
  if(candidates.length!==1)throw new Error(candidates.length?"fee_event_ambiguous":"fee_event_missing_or_unsupported");
  const event=candidates[0]!;if(event.accounts.length!==1 || event.accounts[0]!==authority)throw new Error("fee_event_authority_mismatch");
  const decoded=decodeFeeEvent(event),f=decoded.fields,native=parent.program===PUMP;
  equal(key(f,"user"),trade.wallet);equal(big(f,"timestamp"),BigInt(tx.blockTime!));
  const gaps:string[]=decoded.trailing?["fee_event_extension_uninterpreted"]:[];
  if(events.length>candidates.length)gaps.push("fee_other_program_events_uninterpreted");
  if(big(f,"cashback")!==0n || big(f,"cashback_fee_basis_points")!==0n || big(f,"holder_rewards")!==0n || big(f,"holder_rewards_bps")!==0n || Array.isArray(f.shareholders) && f.shareholders.length)throw new Error("fee_special_routing_unsupported");
  let quote:bigint,protocol:bigint,creator:bigint,lp=0n,source:string,quoteTarget:string,quoteTransfer:bigint,creatorTarget:string;
  const buyback=big(f,"buyback_fee"),buybackBps=big(f,"buyback_fee_basis_points");
  const protocolOwner=key(f,native?"fee_recipient":"protocol_fee_recipient");
  let protocolTarget:string;
  if(native) {
    if(trade.side!=="buy")throw new Error("fee_native_sell_balance_attribution_unsupported");
    equal(decoded.name,"TradeEvent");equal(f.is_buy,true);equal(key(f,"mint"),a.mint??a.base_mint);
    if(![SYSTEM,WSOL].includes(key(f,"quote_mint")))throw new Error("fee_quote_asset_unsupported");
    equal(a.global,await findPda(PUMP,[seed("global")]));
    quote=big(f,"sol_amount");equal(big(f,"quote_amount"),quote);equal(big(f,"token_amount").toString(),trade.base_amount_raw);
    protocol=big(f,"fee");creator=big(f,"creator_fee");rate(quote,big(f,"fee_basis_points"),protocol);rate(quote,big(f,"creator_fee_basis_points"),creator);
    equal(a.fee_recipient,protocolOwner);protocolTarget=protocolOwner;
    creatorTarget=await findPda(PUMP,[seed("creator-vault"),publicKey(key(f,"creator"))]);equal(a.creator_vault,creatorTarget);
    source=trade.wallet;quoteTarget=a.bonding_curve!;quoteTransfer=quote;
  } else {
    if(!a.protocol_fee_recipient || !a.coin_creator_vault_authority)throw new Error("fee_instruction_layout_unsupported");
    equal(decoded.name,trade.side==="buy"?"BuyEvent":"SellEvent");equal(key(f,"pool"),a.pool);
    equal(a.global_config,await findPda(AMM,[seed("global_config")]));equal(a.quote_mint,WSOL);equal(a.quote_token_program,TOKEN);
    for(const name of ["user_base_token_account","user_quote_token_account","protocol_fee_recipient","protocol_fee_recipient_token_account"])equal(key(f,name),a[name]);
    protocolTarget=await ata(protocolOwner);equal(a.protocol_fee_recipient_token_account,protocolTarget);
    const creatorAuthority=await findPda(AMM,[seed("creator_vault"),publicKey(key(f,"coin_creator"))]);equal(a.coin_creator_vault_authority,creatorAuthority);
    creatorTarget=await ata(creatorAuthority);equal(a.coin_creator_vault_ata,creatorTarget);
    quote=big(f,trade.side==="buy"?"quote_amount_in":"quote_amount_out");
    equal(big(f,trade.side==="buy"?"base_amount_out":"base_amount_in").toString(),trade.base_amount_raw);
    protocol=big(f,"protocol_fee");creator=big(f,"coin_creator_fee");lp=big(f,"lp_fee");
    rate(quote,big(f,"protocol_fee_basis_points"),protocol);rate(quote,big(f,"coin_creator_fee_basis_points"),creator);rate(quote,big(f,"lp_fee_basis_points"),lp);
    if(trade.side==="buy") {
      quoteTransfer=quote+lp;equal(big(f,"quote_amount_in_with_lp_fee"),quoteTransfer);equal(big(f,"user_quote_amount_in"),quoteTransfer+protocol+creator);
      source=a.user_quote_token_account!;quoteTarget=a.pool_quote_token_account!;
    } else {
      if(quote<lp+protocol+creator)throw new Error("fee_arithmetic_mismatch");
      equal(big(f,"quote_amount_out_without_lp_fee"),quote-lp);quoteTransfer=quote-lp-protocol-creator;equal(big(f,"user_quote_amount_out"),quoteTransfer);
      source=a.pool_quote_token_account!;quoteTarget=a.user_quote_token_account!;
    }
  }
  if(quote<=0n || buybackBps>10000n || buyback!==protocol*buybackBps/10000n || buyback>protocol)throw new Error("fee_arithmetic_mismatch");
  equal(trade.quote_amount_raw,quoteTransfer.toString());
  const protocolNet=protocol-buyback,flows=payments(children,native),used=new Set<string>(),proof:TradingFeeRow["transfers"]=[];
  function receipt(component:TradingFeeRow["transfers"][number]["component"],to:string,amount:bigint) {
    if(!amount)return;
    const matches=flows.filter(p=>p.from===source && p.to===to && p.amount===amount && !used.has(p.ix.path));
    if(matches.length!==1)throw new Error("fee_transfer_missing_or_ambiguous");
    const payment=matches[0]!;used.add(payment.ix.path);proof.push({component,instruction_index:payment.ix.path,from:source,to,amount_raw:amount.toString()});
  }
  if(new Set([source,quoteTarget,protocolTarget,creatorTarget]).size!==4)throw new Error("fee_recipient_alias");
  receipt("quote",quoteTarget,quoteTransfer);receipt("protocol",protocolTarget,protocolNet);receipt("creator",creatorTarget,creator);
  if(buyback) {
    // Old instructions carry buyback accounts as remaining accounts. Bind the
    // unique residual payment to the emitted split and an instruction account;
    // newer named recipients additionally constrain the exact destination.
    const remaining=flows.filter(p=>p.from===source && p.amount===buyback && !used.has(p.ix.path) && ![source,quoteTarget,protocolTarget,creatorTarget].includes(p.to) && parent.accounts.includes(p.to));
    if(remaining.length!==1)throw new Error("fee_buyback_transfer_missing_or_ambiguous");
    const target=remaining[0]!.to;
    if(a.buyback_fee_recipient)equal(target,native?a.buyback_fee_recipient:await ata(a.buyback_fee_recipient));
    receipt("buyback",target,buyback);
  }
  const additional=flows.some(p=>!used.has(p.ix.path) && p.amount>0n);
  if(!native && (additional || children.some(i=>i.program===TOKEN && i.data[0]===3)))throw new Error("fee_quote_flow_unreconciled");
  if(additional)gaps.push("fee_additional_transfers_unclassified");
  return TradingFeeRowSchema.parse({signature:trade.signature,instruction_index:trade.instruction_index,event_instruction_index:event.path,program:native?"pump":"pumpswap",side:trade.side,slot:trade.slot,block_time:trade.block_time,wallet:trade.wallet,quote_amount_raw:quote.toString(),protocol_gross_raw:protocol.toString(),protocol_net_raw:protocolNet.toString(),buyback_raw:buyback.toString(),creator_raw:creator.toString(),lp_raw:lp.toString(),total_fee_raw:(protocol+creator+lp).toString(),verification:"event_and_execution_reconciled",transaction_hash:trade.transaction_hash,event_hash:await hashBytes(event.data),transfers:proof,gaps});
}
export async function tradingFeesForTransaction(tx:WalletTransaction,mint:string,pool:string) {
  const certified=await verifiedTrades(tx,mint,pool,{temporaryWsol:true}),all=instructions(tx),rows:TradingFeeRow[]=[],unverified:{signature:string;instruction_index:string;reason:string}[]=[];
  for(const trade of certified.trades) {
    try { rows.push(await feeForTrade(tx,trade,all)); }
    catch(error) { unverified.push({signature:trade.signature,instruction_index:trade.instruction_index,reason:error instanceof Error && /^fee_[a-z_]+$/.test(error.message)?error.message:"fee_event_or_execution_invalid"}); }
  }
  return {rows,unverified};
}
export async function tradingFeeSummary(input:WalletEvidence|null,trades:VerifiedTrade[]) {
  const rows:TradingFeeRow[]=[],unverified:{signature:string;instruction_index:string;reason:string}[]=[];
  if(input) for(const record of input.records.filter(r=>r.status==="available" && r.transaction && trades.some(t=>t.signature===r.signature))) {
    const result=await tradingFeesForTransaction(record.transaction!,input.asset.address,input.asset.pool);
    for(const trade of trades.filter(t=>t.signature===record.signature)) {
      const row=result.rows.find(r=>r.instruction_index===trade.instruction_index);
      if(row)rows.push(row);else unverified.push(result.unverified.find(r=>r.instruction_index===trade.instruction_index)??{signature:trade.signature,instruction_index:trade.instruction_index,reason:"fee_trade_not_certified"});
    }
  }
  for(const trade of trades)if(!rows.some(r=>r.signature===trade.signature && r.instruction_index===trade.instruction_index) && !unverified.some(r=>r.signature===trade.signature && r.instruction_index===trade.instruction_index))unverified.push({signature:trade.signature,instruction_index:trade.instruction_index,reason:"fee_transaction_missing"});
  const sum=(field:"protocol_gross_raw"|"protocol_net_raw"|"buyback_raw"|"creator_raw"|"lp_raw"|"total_fee_raw"|"quote_amount_raw")=>rows.length?rows.reduce((total,row)=>total+BigInt(row[field]),0n).toString():null;
  const gaps=[...new Set([...rows.flatMap(r=>r.gaps),...unverified.map(r=>r.reason),...(!trades.length?["fee_verified_trade_sample_unavailable"]:[])])].slice(0,20);
  return TradingFeesSchema.parse({version:"pump-fees-v1",descriptor_revision:descriptor.revision,status:!rows.length?"unavailable":rows.length===trades.length && !gaps.length?"verified_sample":"partial",scope:"verified_swap_sample_not_24h_totals",quote_mint:WSOL,quote_decimals:9,sampled_trades:trades.length,verified_trades:rows.length,unverified_trades:trades.length-rows.length,protocol_gross_raw:sum("protocol_gross_raw"),protocol_net_raw:sum("protocol_net_raw"),buyback_raw:sum("buyback_raw"),creator_raw:sum("creator_raw"),lp_raw:sum("lp_raw"),total_fee_raw:sum("total_fee_raw"),quote_volume_raw:sum("quote_amount_raw"),rows,unverified,gaps});
}
