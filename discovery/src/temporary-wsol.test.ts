import { describe, expect, it } from "vitest";
import recorded from "../fixtures/recorded/temporary-wsol-trade.json";
import { verifiedTrades } from "./wallet-trades";
import { WalletTransactionSchema, keys } from "./wallet-rpc";
import { AMM, instructions, TOKEN, WSOL } from "./pump";
import { fromBase58, hashJson, publicKey, toBase58 } from "./solana";
const build=()=>WalletTransactionSchema.parse(structuredClone(recorded.transaction));
function lifecycle(tx:ReturnType<typeof build>){
  const all=instructions(tx), init=all.find(i=>i.program===TOKEN&&i.data[0]===18)!, close=all.find(i=>i.program===TOKEN&&i.data[0]===9)!, trade=all.find(i=>i.program===AMM)!;
  const raw=(ix:typeof init)=>ix.inner===null?tx.transaction.message.instructions[ix.top]!:tx.meta!.innerInstructions!.find(g=>g.index===ix.top)!.instructions[ix.inner]!;
  return{init,close,trade,raw,all};
}
const verify=(tx:ReturnType<typeof build>)=>verifiedTrades(tx,recorded.mint,recorded.pool,{temporaryWsol:true});
describe("temporary wrapped-SOL ownership evidence",()=>{
  it("replays the real initialization/trade/closure and leaves legacy results unchanged",async()=>{
    const tx=build();expect(await hashJson(tx)).toBe(recorded.transaction_hash);
    expect(await verifiedTrades(tx,recorded.mint,recorded.pool)).toEqual(recorded.legacy);
    expect(await verify(tx)).toEqual(recorded.expected);
    expect(recorded.expected.trades[0]).toMatchObject({side:"buy",quote_account_proof:"temporary_wsol_lifecycle"});
  });
  it("rejects unknown or changed ownership even with zero pre/post balances",async()=>{
    const tx=build(),l=lifecycle(tx),data=fromBase58(l.raw(l.init).data);data.set(publicKey(WSOL),1);l.raw(l.init).data=toBase58(data);
    expect((await verify(tx)).trades).toEqual([]);
    const changed=build(),c=lifecycle(changed);changed.transaction.message.instructions.push({programIdIndex:keys(changed).indexOf(TOKEN),accounts:[keys(changed).indexOf(c.init.accounts[0]!)],data:toBase58(new Uint8Array([6]))});
    expect((await verify(changed)).trades).toEqual([]);
  });
  it("requires a single initializer for the exact native mint before the swap",async()=>{
    for(const change of ["missing","mint","late","duplicate"]){
      const tx=build(),l=lifecycle(tx);
      if(change==="missing")l.raw(l.init).data=toBase58(new Uint8Array([17]));
      if(change==="mint")l.raw(l.init).accounts[1]=keys(tx).indexOf(recorded.mint);
      if(change==="late")tx.meta!.innerInstructions!.find(g=>g.index===l.init.top)!.index=l.trade.top+1;
      if(change==="duplicate")tx.meta!.innerInstructions!.find(g=>g.index===l.init.top)!.instructions.push(structuredClone(l.raw(l.init)));
      expect((await verify(tx)).trades,change).toEqual([]);
    }
  });
  it("requires a later close authorized by and refunded to the same signer",async()=>{
    const missing=build(),m=lifecycle(missing);m.raw(m.close).data=toBase58(new Uint8Array([17]));expect((await verify(missing)).trades).toEqual([]);
    const refund=build(),r=lifecycle(refund);r.raw(r.close).accounts[1]=keys(refund).indexOf(TOKEN);expect((await verify(refund)).trades).toEqual([]);
    const authority=build(),a=lifecycle(authority);a.raw(a.close).accounts[2]=keys(authority).indexOf(TOKEN);expect((await verify(authority)).trades).toEqual([]);
  });
  it("cannot override contradictory recorded balances or failed transactions",async()=>{
    const tx=build(),l=lifecycle(tx),index=keys(tx).indexOf(l.init.accounts[0]!);tx.meta!.preBalances[index]=1;expect((await verify(tx)).trades).toEqual([]);
    const failed=build();failed.meta!.err={InstructionError:[0,"failed"]};await expect(verify(failed)).rejects.toThrow("unsuccessful_or_unsupported_wallet_transaction");
  });
});
