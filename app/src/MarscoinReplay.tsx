import { useEffect, useId, useState } from "react";
import data from "./marscoinReplayData.json";

export const MARS_LAUNCH_PRICE = 0.0000489098406985415;
export const marsLaunchGain = (price: number) => (price / MARS_LAUNCH_PRICE - 1) * 100;
export const marsAxisCeiling = (peak: number) => [10, 25, 50, 100, 150, 200, 300, 500, 1000].find(millions => millions * 1e6 >= peak * 1.08)! * 1e6;
const SUPPLY = 1_000_000_000;
const STEP_MS = 180;
const events = [
  { date: "2026-07-30", short: "Alpha", label: "Binance Alpha", detail: "30 July · MarsCoin joins Binance Alpha, three days after the original pool opened.", color: "#f0b90b" },
  { date: "2026-09-01", short: "Futures", label: "Binance Futures", detail: "1 September · MARSCOINUSDT perpetual trading opens at 09:45 UTC.", color: "#ba98ff" },
  { date: "2026-09-04", short: "Spot", label: "Binance Spot", detail: "4 September · Spot trading opens at 13:00 UTC in USDT, USDC and TRY pairs.", color: "#ff9a76" },
  { date: "2026-09-05", short: "ATH", label: "All-time high", detail: "5 September · CoinGecko records an intraday price high of $0.263444 at 18:14 UTC. This chart point shows that day’s pool close, not the intraday high.", color: "#16d9d9" },
];
const dateKey = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
const dateLabel = (time: number) => new Date(time * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
const first = data[0]!;
const last = data.at(-1)!;
const x = (time: number) => 46 + (time - first.time) / (last.time - first.time) * 298;

export default function MarscoinReplay({ reduced }: { reduced: boolean }) {
  const [step, setStep] = useState(reduced ? data.length - 1 : 0);
  const gradient = useId().replace(/:/g, "");
  const complete = step === data.length - 1;
  const visible = data.slice(0, step + 1);
  const targetAxis = marsAxisCeiling(Math.max(...visible.map(point => point.price * SUPPLY)));
  const [axis, setAxis] = useState(reduced ? targetAxis : 10_000_000);
  useEffect(() => {
    if (reduced) { setStep(data.length - 1); }
  }, [reduced]);
  useEffect(() => {
    if (reduced || complete) return;
    const timer = window.setInterval(() => setStep(previous => Math.min(data.length - 1, previous + 1)), STEP_MS);
    return () => window.clearInterval(timer);
  }, [reduced, complete]);
  useEffect(() => {
    if (reduced) { setAxis(targetAxis); return; }
    let frame = 0;
    const start = performance.now();
    // Functional updates ease the scale out while keeping it above the data.
    const tick = (now: number) => {
      setAxis(previous => now - start >= 160 ? targetAxis : previous + (targetAxis - previous) * .35);
      if (now - start < 160) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [targetAxis, reduced]);
  const y = (price: number) => 176 - Math.min(1, price * SUPPLY / axis) * 148;
  const point = data[step]!;
  const points = visible.map(row => `${x(row.time)},${y(row.price)}`).join(" ");
  const reached = events.map((event, index) => ({ ...event, index })).filter(event => event.date <= dateKey(point.time));
  const down = step > 0 && point.price < data[step - 1]!.price;
  const gain = marsLaunchGain(point.price);
  return <section className="mars-replay" aria-label="MarsCoin first 41 days">
    <header className="mars-replay-header">
      <img src="/stonklets/marscoin.jpeg" alt="MarsCoin logo" />
      <div><strong>$MarsCoin</strong></div>
    </header>
    <div className="mars-replay-value">
      <div className="mars-replay-numbers">
        <strong title="Market-cap estimate: daily pool price × 1 billion reported tokens." style={{ color: down ? "#ff8b8b" : "#00ff00" }}>{money(point.price * SUPPLY)}</strong>
        <div className="mars-replay-gain" title="Gross price gain from the first recorded pool opening price. Excludes taxes, fees, slippage and rewards; not an executable launch entry."><strong>{gain >= 0 ? "+" : ""}{Math.round(gain).toLocaleString("en-US")}%</strong><span>Since launch</span></div>
      </div>
      <time dateTime={new Date(point.time * 1000).toISOString()}>{dateLabel(point.time)} 2026 · Day {step + 1}</time>
    </div>
    <svg viewBox="0 0 360 200" preserveAspectRatio="none" role="group" aria-label={`Daily market-cap estimate: ${money(point.price * SUPPLY)}. Event summaries appear below the chart.`}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00ff00" stopOpacity=".24" /><stop offset="100%" stopColor="#00ff00" stopOpacity="0" /></linearGradient></defs>
      {[0, .5, 1].map(fraction => <g key={fraction}><line x1="46" x2="344" y1={176 - fraction * 148} y2={176 - fraction * 148} stroke="#1c3d28" strokeDasharray="3 5" /><text x="39" y={180 - fraction * 148} textAnchor="end" fill="#8bbf8b" fontSize="10">{money(axis * fraction)}</text></g>)}
      <polygon points={`${x(first.time)},176 ${points} ${x(point.time)},176`} fill={`url(#${gradient})`} />
      <polyline points={points} fill="none" stroke="#00ff00" strokeWidth="2.5" strokeLinejoin="round" />
      {reached.map(event => {
        const row = data.find(row => dateKey(row.time) === event.date)!;
        const px = x(row.time), py = y(row.price);
        const labelY = [py - 12, 70, 44, 18][event.index]!;
        const labelWidth = 100;
        return <g key={event.date}>
          <title>{event.label}</title><line x1={px} x2={px} y1={py} y2={labelY + 3} stroke={event.color} strokeOpacity=".5" strokeDasharray="3 4" />
          <circle cx={px} cy={py} r="12" fill="transparent" /><circle cx={px} cy={py} r="4" fill={event.color} stroke="#041204" strokeWidth="2" />
          <rect x={event.index === 0 ? px : px - labelWidth} y={labelY - 12} width={labelWidth} height="20" rx="4" fill="#041204" fillOpacity=".65" />
          <text x={px + (event.index === 0 ? 5 : -5)} y={labelY} textAnchor={event.index === 0 ? "start" : "end"} fill={event.color} fontSize="10">{event.label}</text>
        </g>;
      })}
      <circle cx={x(point.time)} cy={y(point.price)} r="4" fill={down ? "#ff8b8b" : "#00ff00"} pointerEvents="none" />
      <text x="46" y="194" fill="#8bbf8b" fontSize="10">27 Jul</text><text x="195" y="194" textAnchor="middle" fill="#8bbf8b" fontSize="10">16 Aug</text><text x="344" y="194" textAnchor="end" fill="#8bbf8b" fontSize="10">5 Sep</text>
    </svg>
    <div className="mars-replay-events">
      {events.map(event => {
        const day = data.findIndex(row => dateKey(row.time) === event.date) + 1;
        const marketCap = event.short === "ATH" ? 0.263444 * SUPPLY : data[day - 1]!.price * SUPPLY;
        return <div key={event.date} className="mars-replay-event" style={{ borderColor: event.color }} title={event.detail}>
          <strong style={{ color: event.color }}>{event.label}</strong>
          <p className="text-sm font-normal leading-relaxed text-[#8bbf8b]" title={event.short === "ATH" ? "Intraday price high × 1 billion reported tokens." : "Event-day pool close × 1 billion reported tokens."}>Day {day}: ${Math.round(marketCap / 1e6)}M MCap</p>
        </div>;
      })}
    </div>
  </section>;
}
