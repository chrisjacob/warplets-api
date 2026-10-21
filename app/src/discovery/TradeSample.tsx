import type { TradeSample } from "../../../discovery/src/trade-sample-model";
import { readableReason } from "./client";

export function nativeQuote(raw: string | null): string {
  if (raw === null) return "Unknown";
  const value = BigInt(raw), whole = value / 1000000000n, fraction = (value % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""} SOL`;
}
const date = (at: string) => new Date(at).toLocaleString(undefined, { timeZoneName: "short" });
export function TradeSampleCell({ report, minutes }: { report: TradeSample | undefined; minutes: 5 | 60 | 360 }) {
  const period = report?.periods.find(p => p.minutes === minutes), m = period?.metrics;
  if (!report || !period) return <><strong>Unknown</strong><small>{report?.state === "simulation" ? "Simulation · no live transaction sample" : report?.state === "rejected" ? "Saved transaction evidence rejected" : "Replayed wallet sample unavailable"}</small></>;
  return <><strong>{m ? `${m.buyers} buyers / ${m.sellers} sellers · sample` : "Unknown · held"}</strong>
    {m && <><small>{m.buys} buy / {m.sells} sell instructions</small><small>Sampled buy quote: {nativeQuote(m.buy_quote_raw)}</small><small>Sampled sell quote: {nativeQuote(m.sell_quote_raw)}</small>
      <small>{m.sized_buyers ?? "Unknown"} buyers with a single sampled buy ≥0.01 SOL</small><small>{m.buy_sell_wallets} wallets sampled on both sides</small>
      <small>Largest equal known quote group: {m.largest_known_equal_quote_trades} trades / {m.largest_known_equal_quote_wallets} wallets</small></>}
    <small>{date(period.start_at)} → {date(period.end_at)}{period.clipped_to_creation ? " · since verified creation" : ""}</small>
    <small>{report.freshness} · {period.finalized_trades} matched finalized / {period.candidate_trades} sampled instructions</small>
    <details><summary>Trade sample & limitations</summary><p>Only saved certified trade instructions matched to finalized history are measured. Windows end at the saved wallet observation, not the current time. Young-token windows can be shorter than the requested period. A zero sample count does not mean zero market activity.</p>
      <p>SOL/WSOL protocol quote transfers exclude unknown wallet costs and fee basis. Unknown quotes withhold the direction’s total and sized-buyer count. Equal order sizes and the same wallet buying/selling can occur in ordinary trading; they do not prove wash trading. These wallets are not verified independent participants.</p>
      {m && <p>Unknown quote instructions: {m.unknown_buy_quote_trades} buys / {m.unknown_sell_quote_trades} sells.</p>}
      <ul>{[...new Set([...period.gaps, ...report.gaps])].map(g => <li key={g}>{readableReason(g)}</li>)}</ul>
      <p>Source: {report.source_records} saved transaction records / {report.source_trades} analyzed instructions. No population or continuous-window coverage, organic USD volume, wash verdict or score credit.</p>
      <p>Policy: {report.policy}</p><p className="tenx-address">Policy checksum: {report.policy_hash}<br/>Wallet receipt: {report.wallet_hash}<br/>Input checksum: {report.input_hash}<br/>Report checksum: {report.report_hash}</p>
    </details></>;
}
