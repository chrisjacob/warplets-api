import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useOverlayScrollbars } from "overlayscrollbars-react";
import { AppViewport } from "./AppViewport";
import { STONKLETS_CATALOG } from "../shared/stonkletsCatalog";
import { hapticPrimaryTap, hapticSelectionChanged, hapticTap } from "./haptics";
import { ARROW_SCENARIO, HOOD_SCENARIO, scenarioValue, marketAgeDays } from "./stonkletsOnboardingState";
import MarscoinReplay from "./MarscoinReplay";
import "./stonkletsOnboarding.css";

const pair = STONKLETS_CATALOG.find((entry) => entry.id === "robinhood")!;
const baseSlides = [
  { title: "It's your turn to be early...", lines: [] },
  { title: "Memes 🤝 Stocks", lines: ["Stonklets are memecoins paired with Binance bStocks, providing exposure to real-world assets.", "$ARROW10X trades against $HOODB in a pair.", "If HOOD price goes up it can cause ARROW to go up.", "Stonklets also have their own buy/sell price discovery."] },
  { title: "Designed for long term growth", lines: ["Trading activity funds rewards for holders, deeper liquidity for larger buyers, and ongoing growth.", "Hold Stonklets to earn bStock token rewards.", "MarsCoin uses a 3% tax. Here’s how its story went..."] },
  { title: "From meme to mainstream", lines: ["One meme. One stock pair. Binance exchange listing.", "Could an entire meme market follow?"] },
  { title: "High Risk, High Reward", lines: ["Bigger moves. Bigger opportunity.", "Can a meme market outperform the real market?"] },
];
const allocations = [
  { name: "Growth", share: 1, color: "rgb(124 90 255)", purpose: "Development, community growth, and expansion" },
  { name: "Rewards", share: 1, color: "rgb(208 255 0)", purpose: "Rewards wallets for holding more than 10,000 tokens" },
  { name: "Liquidity", share: 1, color: "rgb(22 217 217)", purpose: "Deeper liquidity for larger trades & more volume" },
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

function Artwork({ src, alt, fullWidth = false }: { src: string; alt: string; fullWidth?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className="stonk-onboard-art">{failed ? <div className="stonk-onboard-art-fallback">{alt}</div> : <img src={src} alt={alt} className={fullWidth ? "stonk-onboard-art-full" : undefined} onError={() => setFailed(true)} />}</div>;
}
function PairIdentity({ stock = false, showDescription = true }: { stock?: boolean; showDescription?: boolean }) {
  return <div className={`stonk-onboard-identity${stock ? " stonk-onboard-identity--stock" : ""}`}><img src={stock ? pair.stock.logo : pair.stonklet.image} alt="" /><b>{stock ? "$HOODB" : "$ARROW10X"}</b>{showDescription && <span>{stock ? "Robinhood bStock" : "Stonklet Memecoin"}</span>}</div>;
}
function TaxVisual() {
  return <div className="stonk-onboard-tax">
    <div className="stonk-onboard-tax-source">3% trading tax</div>
    <svg viewBox="0 0 360 70" aria-hidden="true">{allocations.map((item, index) => <path key={item.name} d={`M180 0 V20 Q180 30 ${60 + index * 120} 40 V70`} fill="none" stroke={item.color} strokeWidth="3" vectorEffect="non-scaling-stroke" className="stonk-onboard-flow" />)}</svg>
    <div className="stonk-onboard-allocations">{allocations.map((item, index) => <div key={item.name} style={{ "--allocation-color": item.color, "--reveal-delay": `${index * 250}ms` } as CSSProperties}><b>{item.share}%</b><strong>{item.name}</strong><p>{item.purpose}</p></div>)}</div>
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
    <div className="stonk-onboard-chart-legend">{[false, true].map((stock) => <div key={String(stock)}><PairIdentity stock={stock} showDescription={false} /><strong style={{ color: stock ? "#f0a82b" : "#00ff00" }} aria-hidden="true">{percent(scenarioValue(stock ? HOOD_SCENARIO : ARROW_SCENARIO, progress))}</strong></div>)}</div>
    <svg viewBox="0 0 360 240" role="img" aria-label="Hypothetical percentage returns: volatile ARROW10X ends at plus 1,000 percent; steadier HOODB ends at plus 100 percent.">
      <defs><clipPath id={clipId}><rect x="47" y="0" width={294 * progress} height="220" /></clipPath></defs>
      {[-100, 0, 500, 1000].map((value) => <g key={value}><line x1="48" x2="340" y1={y(value)} y2={y(value)} stroke="#163516" /><text x="42" y={y(value) + 4} textAnchor="end" fill="#8bbf8b" fontSize="10">{value}%</text></g>)}
      <g clipPath={`url(#${clipId})`}><polyline points={points(HOOD_SCENARIO)} fill="none" stroke="#f0a82b" strokeWidth="2.5" /><polyline points={points(ARROW_SCENARIO)} fill="none" stroke="#00ff00" strokeWidth="2.5" strokeLinejoin="round" /></g>
      <text x="48" y="232" fill="#8bbf8b" fontSize="11">Start</text><text x="340" y="232" fill="#8bbf8b" fontSize="11" textAnchor="end">Over time →</text>
    </svg>
    <p className="stonk-onboard-caption">Illustrative scenario—not historical performance or a forecast</p>
  </div>;
}

function Visual({ index, reduced }: { index: number; reduced: boolean }) {
  if (index === 0) return <Artwork src="/stonklets/stonklets.jpg" alt="Stonklets: a new meme market" fullWidth />;
  if (index === 1) return <div className="stonk-onboard-pair"><PairIdentity /><span className="stonk-onboard-pair-link" aria-label="paired with">⇄</span><PairIdentity stock /></div>;
  if (index === 2) return <TaxVisual />;
  if (index === 3) return <MarscoinReplay reduced={reduced} />;
  return <Scenario reduced={reduced} />;
}

export default function StonkletsOnboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [characters, setCharacters] = useState(0);
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [initializeScrollbars, getScrollbars] = useOverlayScrollbars({
    options: {
      scrollbars: { theme: "os-theme-10x", autoHide: "scroll", clickScroll: true },
    },
    defer: true,
  });
  useEffect(() => {
    const target = body.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeScrollbars(target);
    return () => { target.removeAttribute("data-overlayscrollbars-initialize"); };
  }, [initializeScrollbars]);
  const heading = useRef<HTMLHeadingElement>(null);
  const today = new Date();
  const slides = [{ ...baseSlides[0]!, lines: [
    `The U.S. stock market is ${marketAgeDays("1792-05-17", today).toLocaleString("en-US")} days old.`,
    `The Stonklets meme market is ${marketAgeDays("2026-09-06", today).toLocaleString("en-US")} days old.`,
    "A new starting point. Anyone can be early.",
  ] }, ...baseSlides.slice(1)];
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
    (getScrollbars()?.elements().viewport ?? body.current)?.scrollTo({ top: 0 });
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
  }, [index, total, reduced, getScrollbars]);
  const emphasiseAge = (text: string, visible = text.length) => {
    const match = /[\d,]+ days old/.exec(text);
    if (!match) return text.slice(0, visible);
    const start = match.index, end = start + match[0].length;
    return <>{text.slice(0, Math.min(start, visible))}<strong>{text.slice(start, Math.max(start, Math.min(end, visible)))}</strong>{text.slice(end, Math.max(end, visible))}</>;
  };
  const typed = (text: string, offset: number) => <span className="stonk-onboard-typed"><span className="sr-only">{text}</span><span className="stonk-onboard-reserved" aria-hidden="true">{emphasiseAge(text)}</span><span className="stonk-onboard-visible" aria-hidden="true">{emphasiseAge(text, reduced ? text.length : Math.max(0, characters - offset))}{index === 0 && offset === 0 && characters === 0 && !reduced && <span className="onboarding-terminal-cursor" />}</span></span>;
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
      <div ref={body} className="app-modal-scroll-body min-h-0 flex-1 overflow-y-auto p-4">
        {/* OverlayScrollbars reparents this stable wrapper; React owns its changing children. */}
        <div>
          <div key={index}><Visual index={index} reduced={reduced} /></div>
          <div className="mt-3 space-y-2">{slide.lines.map((line, lineIndex) => <p key={line} className="rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-2 text-sm leading-relaxed text-[#8bbf8b]">{typed(line, slide.title.length + slide.lines.slice(0, lineIndex).join("").length)}</p>)}</div>
        </div>
      </div>
      <footer className="app-modal-footer border-t border-[#00FF00]/20 p-4"><nav className="mb-4 flex justify-center gap-1.5" aria-label="Onboarding slides">{slides.map((item, i) => <button key={item.title} type="button" aria-label={`Go to onboarding slide ${i + 1}`} aria-current={i === index ? "step" : undefined} onClick={() => navigate(i)} className="stonk-onboard-dot"><span className={i === index ? "is-active" : ""} /></button>)}</nav><div className="stonk-onboard-actions">{index > 0 && <button type="button" className="secondary-trade-cta flex-1 cursor-pointer rounded-[20px] border bg-black px-4 py-3 text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px]" onClick={() => { void hapticTap(); setIndex(index - 1); }}>Back</button>}<button type="button" className="stonk-onboard-next" onClick={() => { void hapticPrimaryTap(); if (index === slides.length - 1) onDone(); else setIndex(index + 1); }}>{index === slides.length - 1 ? "Explore the market" : "Next"}</button></div></footer>
    </div>
  </AppViewport>;
}
