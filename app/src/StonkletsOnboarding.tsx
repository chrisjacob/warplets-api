import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { AppViewport } from "./AppViewport";
import { STONKLETS_CATALOG } from "../shared/stonkletsCatalog";
import { hapticPrimaryTap, hapticSelectionChanged, hapticTap } from "./haptics";
import { ARROW_SCENARIO, HOOD_SCENARIO, scenarioValue } from "./stonkletsOnboardingState";
import { MARSCOIN_MILESTONES, MARSCOIN_POOL, historicalReturn, formatHistoricalReturn } from "./stonkletsOnboardingHistory";
import "./stonkletsOnboarding.css";

const pair = STONKLETS_CATALOG.find((entry) => entry.id === "robinhood")!;
const slides = [
  { title: "Your turn to be early", lines: ["Familiar stocks. A new meme market.", "Stonklets create a new starting point around the companies and stories you already know."] },
  { title: "Memes meet stocks", lines: ["Stonklets are memecoins paired with bStocks, which provide tokenized exposure to real-world assets.", "The meme token has its own price discovery.", "ARROW trades against HOODB. Its dollar price reflects both its price in HOODB and HOODB’s dollar value, while ARROW’s own buying and selling drives its relative performance."] },
  { title: "Designed for the long term", lines: ["3% buy / 3% sell tax. Trading activity funds rewards for qualifying holders, deeper liquidity for larger buyers, and ongoing growth.", "MarsCoin also uses a 3% trading tax. Here’s where its story went."] },
  { title: "From meme to mainstream", lines: ["One meme. One stock pairing. A major exchange listing.", "Stonklets takes that idea across a whole market.", "Could an entire meme market write its own version of that story?"] },
  { title: "Can a meme market outperform the real market?", lines: ["Bigger moves. Bigger swings. Could a whole meme market outperform?"] },
];
const allocations = [
  { name: "Funds", share: 33, color: "rgb(124 90 255)", purpose: "Development, community growth, and expansion" },
  { name: "Dividends", share: 34, color: "rgb(208 255 0)", purpose: "Rewards for qualifying long-term holders" },
  { name: "Liquidity", share: 33, color: "rgb(22 217 217)", purpose: "Deeper liquidity for larger trades, including whales" },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function Artwork({ src, alt, pan = false }: { src: string; alt: string; pan?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className="stonk-onboard-art">{failed ? <div className="stonk-onboard-art-fallback">{alt}</div> : <img src={src} alt={alt} className={pan ? "stonk-onboard-pan" : undefined} onError={() => setFailed(true)} />}</div>;
}
function PairIdentity({ stock = false }: { stock?: boolean }) {
  return <div className="stonk-onboard-identity"><img src={stock ? pair.stock.logo : pair.stonklet.image} alt="" /><b>{stock ? "HOODB" : "ARROW10X"}</b><span>{stock ? "Robinhood bStock" : "Independent meme token"}</span></div>;
}
function TaxVisual() {
  return <div className="stonk-onboard-tax">
    <div className="stonk-onboard-tax-source">3% trading tax</div>
    <svg viewBox="0 0 360 70" aria-hidden="true">{allocations.map((item, index) => <path key={item.name} d={`M180 0 V20 Q180 30 ${60 + index * 120} 40 V70`} fill="none" stroke={item.color} strokeWidth="2" className="stonk-onboard-flow" />)}</svg>
    <div className="stonk-onboard-allocations">{allocations.map((item, index) => <div key={item.name} style={{ "--allocation-color": item.color, "--reveal-delay": `${index * 250}ms` } as CSSProperties}><b>{item.share}%</b><strong>{item.name}</strong><p>{item.purpose}</p></div>)}</div>
    <p className="stonk-onboard-caption">Allocation of tax revenue</p>
  </div>;
}
function Scenario({ reduced }: { reduced: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const clipId = useId().replace(/:/g, "");
  const progress = reduced ? 1 : Math.min(1, elapsed / 8000);
  useEffect(() => {
    if (reduced) return;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => { setElapsed(Math.min(8000, now - started)); if (now - started < 8000) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  const y = (value: number) => 205 - ((value + 100) / 1200) * 180;
  const points = (series: number[]) => series.map((value, index) => `${48 + index / (series.length - 1) * 292},${y(value)}`).join(" ");
  const percent = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value).toLocaleString("en-US")}%`;
  return <div className="stonk-onboard-scenario">
    <p className="stonk-onboard-caption">Illustrative scenario—not historical performance or a forecast</p>
    <div className="stonk-onboard-chart-legend">{[false, true].map((stock) => <div key={String(stock)}><PairIdentity stock={stock} /><strong style={{ color: stock ? "#16d9d9" : "#d0ff00" }} aria-hidden="true">{percent(scenarioValue(stock ? HOOD_SCENARIO : ARROW_SCENARIO, progress))}</strong></div>)}</div>
    <svg viewBox="0 0 360 240" role="img" aria-label="Hypothetical percentage returns: volatile ARROW10X ends at plus 1,000 percent; steadier HOODB ends at plus 100 percent.">
      <defs><clipPath id={clipId}><rect x="47" y="0" width={294 * progress} height="220" /></clipPath></defs>
      {[-100, 0, 500, 1000].map((value) => <g key={value}><line x1="48" x2="340" y1={y(value)} y2={y(value)} stroke="#163516" /><text x="42" y={y(value) + 4} textAnchor="end" fill="#8bbf8b" fontSize="10">{value}%</text></g>)}
      <g clipPath={`url(#${clipId})`}><polyline points={points(HOOD_SCENARIO)} fill="none" stroke="#16d9d9" strokeWidth="2.5" /><polyline points={points(ARROW_SCENARIO)} fill="none" stroke="#d0ff00" strokeWidth="2.5" strokeLinejoin="round" /></g>
      <text x="48" y="232" fill="#8bbf8b" fontSize="11">Start</text><text x="340" y="232" fill="#8bbf8b" fontSize="11" textAnchor="end">Over time →</text>
    </svg>
    <p className="stonk-onboard-result" style={{ opacity: progress === 1 ? 1 : 0 }}>10× the percentage gain</p>
  </div>;
}

function Visual({ index, reduced }: { index: number; reduced: boolean }) {
  if (index === 0) return <Artwork src="/stonklets/stonklets.jpg" alt="Stonklets: a new meme market" pan />;
  if (index === 1) return <div className="stonk-onboard-pair"><PairIdentity /><span className="stonk-onboard-pair-link" aria-label="paired with">⇄</span><PairIdentity stock /></div>;
  if (index === 2) return <TaxVisual />;
  if (index === 3) return <><Artwork src="/stonklets/marscoin.jpeg" alt="MarsCoin" />
    <div className="stonk-onboard-milestones"><span>Launch</span><span>Alpha</span><span>Spot</span></div>
    <table className="stonk-onboard-history"><caption>Historical USD price gains · 2026</caption><thead><tr><th scope="col">Milestone</th><th scope="col">MarsCoin</th><th scope="col">SPCXB</th></tr></thead><tbody>{MARSCOIN_MILESTONES.map((point) => <tr key={point.id}><th scope="row">{point.label}<small>{point.date}</small></th><td>{formatHistoricalReturn(historicalReturn(point.mars, MARSCOIN_MILESTONES[0].mars))}</td><td>{formatHistoricalReturn(historicalReturn(point.spcxb, MARSCOIN_MILESTONES[0].spcxb))}</td></tr>)}</tbody></table>
    <p className="stonk-onboard-caption">SPCXB is the SpaceX-linked bStock. Baseline: close of the first full hourly pool candle. Matching hourly USD closes; before taxes, fees, slippage, and rewards. Historical results, not a forecast.</p>
    <div className="stonk-onboard-sources"><a className="stonk-onboard-source" href="https://www.binance.com/en/support/announcement/detail/c2eaa763831745b2b1701dab45e20225" target="_blank" rel="noreferrer">Binance listing ↗</a><a className="stonk-onboard-source" href={`https://www.geckoterminal.com/bsc/pools/${MARSCOIN_POOL}`} target="_blank" rel="noreferrer">GeckoTerminal prices ↗</a></div></>;
  return <Scenario reduced={reduced} />;
}

export default function StonkletsOnboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [characters, setCharacters] = useState(0);
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const slide = slides[index]!;
  const total = slide.title.length + slide.lines.join("").length;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focus = (event: FocusEvent) => { if (!panel.current?.contains(event.target as Node)) heading.current?.focus(); };
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("focusin", focus);
      document.body.style.overflow = overflow;
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
        else {
          // The account menu is unmounted during replay. Restore focus to the
          // destination only if no following notice/notification gate is open.
          const destination = document.querySelector<HTMLElement>(".stonklets-main");
          if (destination) { destination.setAttribute("tabindex", "-1"); destination.focus({ preventScroll: true }); }
        }
      });
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    body.current?.scrollTo({ top: 0 });
    setCharacters(0);
    if (reduced) return;
    let frame = 0;
    const start = performance.now() + (index === 0 ? 1500 : 0);
    const tick = (now: number) => {
      const next = Math.max(0, Math.min(total, Math.floor((now - start) / 38)));
      setCharacters(next);
      if (next < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index, total, reduced]);
  const typed = (text: string, offset: number) => <span className="stonk-onboard-typed"><span className="sr-only">{text}</span><span className="stonk-onboard-reserved" aria-hidden="true">{text}</span><span className="stonk-onboard-visible" aria-hidden="true">{text.slice(0, reduced ? text.length : Math.max(0, characters - offset))}{index === 0 && offset === 0 && characters === 0 && !reduced && <span className="onboarding-terminal-cursor" />}</span></span>;
  const navigate = (next: number) => { void hapticSelectionChanged(); setIndex(next); };
  return <AppViewport className="app-modal-viewport stonk-onboard fixed inset-0 z-[210] flex items-end justify-center bg-black/80 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="stonk-onboard-title" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
    if (event.key !== "Tab") return;
    const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') ?? []);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div ref={panel} className="app-modal-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
      <header className="app-modal-header border-b border-[#00FF00]/20 px-4 py-3"><h2 id="stonk-onboard-title" ref={heading} tabIndex={-1} className="text-base font-bold text-[#00FF00] outline-none">{typed(slide.title, 0)}</h2></header>
      <div ref={body} className="app-modal-scroll-body min-h-0 flex-1 overflow-y-auto p-4"><div key={index}><Visual index={index} reduced={reduced} /></div><div className="mt-3 space-y-2">{slide.lines.map((line, lineIndex) => <p key={line} className="rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-2 text-sm leading-relaxed text-[#8bbf8b]">{typed(line, slide.title.length + slide.lines.slice(0, lineIndex).join("").length)}</p>)}</div></div>
      <footer className="app-modal-footer border-t border-[#00FF00]/20 p-4"><nav className="mb-4 flex justify-center gap-1.5" aria-label="Onboarding slides">{slides.map((item, i) => <button key={item.title} type="button" aria-label={`Go to onboarding slide ${i + 1}`} aria-current={i === index ? "step" : undefined} onClick={() => navigate(i)} className="stonk-onboard-dot"><span className={i === index ? "is-active" : ""} /></button>)}</nav><div className="flex gap-3">{index > 0 && <button type="button" className="stonk-onboard-back" onClick={() => { void hapticTap(); setIndex(index - 1); }}>Back</button>}<button type="button" className="stonk-onboard-next" onClick={() => { void hapticPrimaryTap(); if (index === slides.length - 1) onDone(); else setIndex(index + 1); }}>{index === slides.length - 1 ? "Explore the market" : "Next"}</button></div></footer>
    </div>
  </AppViewport>;
}
