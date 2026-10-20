import type { TradingFees } from "../../../discovery/src/trading-fee-model";
import { readableReason } from "./client";

export const feeSol=(raw:string|null)=>raw===null?"Unavailable":`${BigInt(raw)/1000000000n}.${(BigInt(raw)%1000000000n).toString().padStart(9,"0")} SOL`;
export function TradingFeesPanel({fees}:{fees:TradingFees}) {
  return <section id="protocol-fees" aria-label="Pump and PumpSwap trading fees"><h3>Pump / PumpSwap trading fees</h3>
    <p>{fees.verified_trades} / {fees.sampled_trades} sampled swaps have reconciled fee components. {fees.status==="verified_sample"?"The supported sample is fully reconciled.":fees.status==="partial"?"Coverage is partial; known amounts below exclude unverified swaps and extensions.":"No trading fees can be verified from this saved sample yet."}</p>
    <dl><dt>Protocol fees · gross, including buyback</dt><dd>{feeSol(fees.protocol_gross_raw)}</dd><dt>Creator-vault fees paid</dt><dd>{feeSol(fees.creator_raw)}</dd><dt>LP fees retained in pool</dt><dd>{feeSol(fees.lp_raw)}</dd><dt>Total reconciled fee components</dt><dd>{feeSol(fees.total_fee_raw)}</dd></dl>
    <p>Buyback is part of the protocol fee and is counted once. Pump fees are paid in SOL; PumpSwap fees use WSOL, shown in SOL units. These are bounded swap samples, not 24-hour fee totals or proof of organic trading. Creator or LP fees may accrue to related wallets. LP fees retained in reserves are not a verified claimable payout.</p>
    <details><summary>Fee breakdown, proof paths & gaps</summary><dl><dt>Protocol fees after buyback split</dt><dd>{feeSol(fees.protocol_net_raw)}</dd><dt>Buyback portion of protocol fees</dt><dd>{feeSol(fees.buyback_raw)}</dd><dt>Covered gross quote amount</dt><dd>{feeSol(fees.quote_volume_raw)}</dd></dl>
      {fees.gaps.length>0 && <ul>{fees.gaps.map(g=><li key={g}>{readableReason(g)}</li>)}</ul>}
      {fees.rows.map(row=><details key={`${row.signature}:${row.instruction_index}`}><summary>{row.program==="pump"?"Pump":"PumpSwap"} {row.side} · {feeSol(row.total_fee_raw)} · {new Date(row.block_time).toLocaleString()}</summary>
        <dl><dt>Swap / event instruction</dt><dd>{row.instruction_index} / {row.event_instruction_index}</dd><dt>Protocol gross</dt><dd>{feeSol(row.protocol_gross_raw)}</dd><dt>Creator vault</dt><dd>{feeSol(row.creator_raw)}</dd><dt>LP retained</dt><dd>{feeSol(row.lp_raw)}</dd></dl>
        <a href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noopener noreferrer">View finalized transaction ↗</a>
        <div className="tenx-table-scroll"><table><thead><tr><th>Payment</th><th>Instruction</th><th>Amount</th><th>Recipient</th></tr></thead><tbody>{row.transfers.map(t=><tr key={t.instruction_index}><td>{t.component}</td><td>{t.instruction_index}</td><td>{feeSol(t.amount_raw)}</td><td className="tenx-address">{t.to}</td></tr>)}</tbody></table></div>
        <p>LP amount is verified through the program event, fee arithmetic and quote flow. The quote payment shown above is the swap transfer; it is not added to fee totals.</p>
        <p className="tenx-address">Transaction hash: {row.transaction_hash}<br/>Event hash: {row.event_hash}</p>
        {row.gaps.length>0 && <ul>{row.gaps.map(g=><li key={g}>{readableReason(g)}</li>)}</ul>}
      </details>)}
      {fees.unverified.map(row=><p key={`${row.signature}:${row.instruction_index}`}>Swap {row.instruction_index}: {readableReason(row.reason)}. <a href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noopener noreferrer">Transaction ↗</a></p>)}
      <p>Fee evidence uses saved finalized RPC data and pinned program definitions. Raw payments and hashes are available in the cached activity evidence below.</p>
    </details>
  </section>;
}
